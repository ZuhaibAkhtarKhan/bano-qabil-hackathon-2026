# 1-Apply — Phased AWS Deployment Plan (revised)

Constraints driving this revision: **~$60 in AWS credits**, app is **still mid-build**, and you're **pushing to GitHub daily**. That changes the right starting point — production-grade infra (ECS, ALB, NAT Gateway) solves problems you don't have yet and would burn the whole credit balance in under a month. Start at Phase 0.

**Phase order:** 0 (single EC2, now) → 1 (ECS Fargate, once you have real users) → 2 (full AWS data-plane migration, optional) → 3 (headless form-filler, separate product initiative).

---

## Phase 0 — Single EC2 instance, deploy-on-push (do this now)

**Goal:** cheapest possible always-on hosting that survives a crashed process, with a deploy flow that matches how you actually work (push to `main`, it goes live). No ALB, no ECS, no NAT Gateway — none of that is worth paying for pre-launch.

### 0.1 Components

| Component | Choice | Why |
|---|---|---|
| Compute | 1× EC2 `t4g.small` (Graviton, 2 vCPU / 2GB) | Runs both `apps/web` and the worker process side by side via PM2 |
| Process manager | PM2 | Two processes: `web` (Next.js) and `worker` (wraps `workers/ai-jobs`); auto-restarts either on crash |
| Reverse proxy / TLS | Caddy | Auto-provisions Let's Encrypt certs on the instance — no ACM/ALB needed |
| Secrets | SSM Parameter Store (`SecureString` type) | Free at this volume, unlike Secrets Manager's per-secret charge |
| Deploy | GitHub Actions → SSH → `git pull && npm ci && npm run build && pm2 restart all` | Fires on every push to `main`, matching your daily-push cadence |
| Scheduler | Cron on the box (or PM2's built-in cron restart) calling the sweep logic directly | No EventBridge needed for one box |
| Data plane | Supabase, unchanged | Same as original plan |

### 0.2 Required code changes (same as before — these aren't optional)

1. Worker entrypoint wrapping `workers/ai-jobs` as a long-running poller (DB-poll pattern: claim queued jobs, process, mark complete/failed with backoff).
2. Replace `after()` / fire-and-forget calls with `jobs` table inserts only, so the worker — not the web request — does the work.
3. Update extension `APP_BASE_URL` to the new public domain/IP once it exists (can point at a placeholder Elastic IP early, swap to the real domain later — doesn't have to be the last step).

### 0.3 Cost estimate (us-east-1, monthly)

| Item | Sizing | Est. cost |
|---|---|---|
| EC2 `t4g.small` on-demand | 2 vCPU, 2GB, 730 hrs | ~$12.10 |
| EBS gp3 volume | 20GB | ~$1.60 |
| Route 53 hosted zone | 1 zone | ~$0.50 |
| SSM Parameter Store | standard params, low volume | $0 |
| Data transfer out | light, early stage | ~$1–3 |
| **Total** | | **~$14–17/mo** |

Against **$60 in credits**, that's roughly **3.5–4 months of runway**. Two ways to stretch it further:
- If this AWS account is new/unused, the free tier may cover a `t3.micro`/`t2.micro` (1 vCPU/1GB) for 12 months — check the Billing console before paying for `t4g.small`. 1GB is tight for running both processes plus the Next.js build, but workable if you build on CI rather than on the box.
- Stop the instance (not terminate) when you're not actively testing — EC2 only bills for running hours, so a stopped box overnight costs nothing beyond the ~$1.60/mo EBS storage.

This is a planning estimate — actual free-tier eligibility and exact pricing depend on your account and region; verify in the AWS console before budgeting against it.

### 0.4 What this deliberately skips

Multi-AZ, load balancer, autoscaling, a staging environment, zero-downtime deploys (a PM2 restart causes a few seconds of downtime per deploy — acceptable pre-launch, not once you have paying users mid-session). Move to Phase 1 (ECS) when that tradeoff stops being acceptable.

---

---

## Phase 1 — ECS Fargate: AWS compute, Supabase data plane (once you have real users)

**Goal:** `apps/web` and a durable worker run on AWS; Supabase stays as Postgres/Auth/Storage. This closes the job-execution gap (Section 5C of the brief) which is the actual blocker to "background automation," not the database location.

### 1.1 Components to deploy

| Component | Service | Notes |
|---|---|---|
| Web app | ECS Fargate service (2 tasks, behind ALB) | Next.js SSR, `apps/web` |
| Worker | ECS Fargate service (1 task, no ALB) | Wires `workers/ai-jobs` as a long-running poller |
| Scheduler | EventBridge Scheduler | Triggers `runUserAutomationSweep` + `deadline_monitor` on a cron |
| Secrets | Secrets Manager | All server-only env vars from Section 10 |
| TLS/DNS | ACM + Route 53 | `app.1apply.com` |
| CDN | CloudFront (optional in MVP) | Static asset caching in front of ALB — skip initially if you want fewer moving parts |
| Container registry | ECR | Two repos: `1apply-web`, `1apply-worker` |
| Data plane | Supabase (unchanged) | Postgres+pgvector, Auth, Storage |

Why ECS Fargate over Amplify Hosting for the web tier: Amplify's SSR compute is designed around short-lived request/response and will kill `after()`-style fire-and-forget work exactly like Section 5C warns — you'd need the worker either way, so you gain nothing by keeping Amplify and lose control over container lifecycle. Fargate for both web and worker keeps the ops model uniform.

### 1.2 Required code changes before deploy

These aren't optional — without them the worker deployment is cosmetic and jobs still silently rely on request-scoped execution:

1. **Write a Dockerfile** (none exists). Multi-stage: `npm ci` → `npm run build -w @1apply/web` → slim runtime image (`node:22-slim`), `npm run start -w @1apply/web`.
2. **Write a worker entrypoint** that wraps `workers/ai-jobs` as a long-running process: poll loop over `jobs where state='queued' and next_attempt_at <= now()`, using the service-role Supabase client. This library has tests but "is not wired as a production runner" per Section 5C — that wiring is the critical path.
3. **Replace `after()` and fire-and-forget calls** (`scheduleDocumentVersionProcessing`, `scheduleRefreshOpenApplicationsFromKit`, `runOwnedJob`'s synchronous execution) with `INSERT INTO jobs (...)` only. The web app should never again run job work in its own process after this change — it enqueues, the worker executes.
4. **Update extension `APP_BASE_URL`** from localhost to the production domain and republish to Chrome Web Store.

### 1.3 ECS task definitions

**Web service** (`1apply-web-task.json`):

```json
{
  "family": "1apply-web",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::<account>:role/1apply-ecs-execution-role",
  "taskRoleArn": "arn:aws:iam::<account>:role/1apply-web-task-role",
  "containerDefinitions": [
    {
      "name": "web",
      "image": "<account>.dkr.ecr.<region>.amazonaws.com/1apply-web:latest",
      "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
      "essential": true,
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 30
      },
      "environment": [
        { "name": "NEXT_PUBLIC_APP_URL", "value": "https://app.1apply.com" },
        { "name": "NEXT_PUBLIC_SUPABASE_URL", "value": "https://<project>.supabase.co" },
        { "name": "NEXT_PUBLIC_EXTENSION_ORIGIN", "value": "chrome-extension://<id>" }
      ],
      "secrets": [
        { "name": "SUPABASE_SERVICE_ROLE_KEY", "valueFrom": "arn:aws:secretsmanager:...:1apply/service-role-key" },
        { "name": "OPENAI_API_KEY", "valueFrom": "arn:aws:secretsmanager:...:1apply/openai-key" },
        { "name": "OPENAI_BASE_URL", "valueFrom": "arn:aws:secretsmanager:...:1apply/openai-base-url" },
        { "name": "TOKEN_ENCRYPTION_KEY", "valueFrom": "arn:aws:secretsmanager:...:1apply/token-key" },
        { "name": "GOOGLE_OAUTH_CLIENT_ID", "valueFrom": "arn:aws:secretsmanager:...:1apply/google-client-id" },
        { "name": "GOOGLE_OAUTH_CLIENT_SECRET", "valueFrom": "arn:aws:secretsmanager:...:1apply/google-client-secret" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/1apply-web",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "web"
        }
      }
    }
  ]
}
```

- **Note on `SUPABASE_SERVICE_ROLE_KEY` in the web task:** per Section 4's own rule ("service role is for workers/admin only"), this should *not* actually live in the web container's environment for normal request paths — only in the worker task. Keep it out of the web task definition unless a specific admin-only route needs it, and if it does, scope that route tightly. I included it above only to show the secrets-injection pattern; drop it for the web service in your real task def.

**Worker service** (`1apply-worker-task.json`):

```json
{
  "family": "1apply-worker",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::<account>:role/1apply-ecs-execution-role",
  "taskRoleArn": "arn:aws:iam::<account>:role/1apply-worker-task-role",
  "containerDefinitions": [
    {
      "name": "worker",
      "image": "<account>.dkr.ecr.<region>.amazonaws.com/1apply-worker:latest",
      "essential": true,
      "environment": [
        { "name": "WORKER_POLL_INTERVAL_MS", "value": "5000" },
        { "name": "WORKER_JOB_TYPES", "value": "document_extract,embedding_index,opportunity_analyze,eligibility_evaluate,answer_draft,resume_match,deadline_monitor" }
      ],
      "secrets": [
        { "name": "SUPABASE_SERVICE_ROLE_KEY", "valueFrom": "arn:aws:secretsmanager:...:1apply/service-role-key" },
        { "name": "OPENAI_API_KEY", "valueFrom": "arn:aws:secretsmanager:...:1apply/openai-key" },
        { "name": "OPENAI_BASE_URL", "valueFrom": "arn:aws:secretsmanager:...:1apply/openai-base-url" },
        { "name": "EMBEDDING_MODEL", "valueFrom": "arn:aws:secretsmanager:...:1apply/embedding-model" },
        { "name": "GROQ_API_KEY", "valueFrom": "arn:aws:secretsmanager:...:1apply/groq-key" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/1apply-worker",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "worker"
        }
      }
    }
  ]
}
```

Worker runs as an ECS **Service** with `desiredCount: 1` (not a one-off task) so it restarts automatically on crash — this is your durability guarantee, separate from job durability in Postgres.

### 1.4 Worker wiring detail

Two viable patterns; pick one:

**A. DB-poll (simplest, matches existing `jobs` table design)**
- Worker container runs an infinite loop: `SELECT ... FROM jobs WHERE state='queued' AND next_attempt_at <= now() ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED`, claim → process → mark `completed`/`failed` with backoff on `next_attempt_at`.
- No new AWS infra beyond the ECS service itself.
- Good enough at your current scale; revisit if poll latency (default every 5s) becomes a UX problem.

**B. SQS-backed (durable, event-driven, more infra)**
- Web app enqueues to SQS *and* inserts the `jobs` row (row = source of truth/audit trail, SQS = dispatch).
- Worker uses long-polling `ReceiveMessage`, processes, deletes message on success; SQS visibility timeout + redrive policy to a DLQ (`1apply-jobs-dlq`) handles retries/poison messages automatically instead of hand-rolled backoff logic.
- Better for volume/failure isolation, but it's genuinely more moving parts than your current job volume needs on day one.

**Recommendation:** ship with A. It directly wires the existing `workers/ai-jobs` library against the existing schema, with zero new AWS services. Move to B only if a single-poller becomes a bottleneck or you want per-job-type isolation.

**EventBridge Scheduler** — two rules, both invoking the worker via a lightweight "enqueue sweep" Lambda (or an ECS `RunTask` with a `--mode=sweep` flag) that just inserts `automation_sweep` / `deadline_monitor` job rows for active users:

```
Rule: 1apply-automation-sweep   | rate(15 minutes) | inserts runUserAutomationSweep jobs
Rule: 1apply-deadline-monitor   | rate(1 hour)      | inserts deadline_monitor jobs
```

Keep the sweep itself dumb (just enqueue) — let the existing worker loop do the actual work, so you have one execution path to reason about instead of two.

### 1.5 Networking

- One VPC, 2 AZs, public subnets for ALB, private subnets for ECS tasks.
- **Skip NAT Gateway if possible** — it's the single most-forgotten line item in Fargate cost estimates (~$32/mo + per-GB processing, *per AZ*). Since Supabase, Gemini, and Google OAuth are all internet endpoints, tasks in private subnets need egress; use a NAT Gateway only in one AZ to start (accept the reduced HA), or route tasks to public subnets with `assignPublicIp: ENABLED` and tight security groups if you want to avoid NAT entirely during MVP. Revisit for HA once revenue justifies it.
- Security group: ALB → web tasks on 3000 only; worker tasks have no inbound rule at all (egress-only).

### 1.6 Phase 1 cost estimate (us-east-1, monthly, on-demand pricing)

| Item | Sizing | Est. cost |
|---|---|---|
| ECS Fargate — web (2 tasks × 0.5 vCPU/1GB, ~50% avg utilization) | 2 × 0.5 vCPU, 1GB, 730 hrs | ~$30 |
| ECS Fargate — worker (1 task × 0.25 vCPU/0.5GB) | 1 × 0.25 vCPU, 0.5GB, 730 hrs | ~$7 |
| Application Load Balancer | 1 ALB, low traffic | ~$18 + minor LCU |
| NAT Gateway (single AZ) | 1 NAT, low data | ~$33 + $0.045/GB processed |
| ECR storage | 2 small images | ~$1 |
| Secrets Manager | ~10 secrets | ~$4 |
| CloudWatch Logs | low volume, 7-day retention | ~$3–5 |
| EventBridge Scheduler | 2 rules, low invocations | ~$0 (free tier covers this) |
| Route 53 hosted zone | 1 zone | ~$0.50 |
| Data transfer out | light, early stage | ~$5–15 |
| **AWS subtotal** | | **~$100–120/mo** |
| Supabase (unchanged, separate bill) | Pro tier if not already | ~$25/mo |
| Gemini API (unchanged, separate bill) | usage-based | variable, not AWS |

**Against AWS credits:** at ~$100–120/mo AWS spend, a typical $1,000 startup credit grant covers roughly **8–10 months**; a $5,000 Activate credit covers **3–4 years** at this scale. If you drop the NAT Gateway (public-subnet tasks) you cut roughly $35–45/mo, worth doing early since it's pure savings with no durability tradeoff at this traffic level.

This is a planning estimate, not a quote — actual cost depends on request volume, log retention, and data transfer, and AWS pricing can change. Run it through the [AWS Pricing Calculator](https://calculator.aws) with your real traffic numbers before committing a budget, and I'm not able to see your actual credit balance or negotiated pricing, so treat the "months of runway" figures as illustrative only.

---

## Phase 2 — Full AWS migration (optional, only if needed)

**Goal:** Move the data plane off Supabase — RDS Postgres + pgvector, S3 for documents, Cognito or self-hosted auth. Only do this if you have a concrete driver (cost at scale, compliance, VPC-private DB requirement). Otherwise Phase 1 is a legitimate end state.

### 2.1 What changes

| From | To | Migration note |
|---|---|---|
| Supabase Postgres | RDS PostgreSQL 16 + `pgvector` extension | `pg_dump`/`pg_restore`; RDS supports pgvector natively since PG 15+ |
| Supabase Storage | S3 bucket `1apply-documents`, same key layout | `{userId}/{type}/{documentId}/{versionId}/{filename}` — copy via `aws s3 sync` from Supabase's S3-compatible endpoint if available, or a migration script |
| Supabase Auth | Keep Supabase Auth **or** migrate to Cognito | Migrating auth is the highest-risk step — user password hashes don't transfer cleanly. Realistic options: (a) keep Supabase Auth only, everything else on AWS — this is a fully legitimate hybrid; (b) force password reset flow for all users during Cognito migration. Don't attempt a silent hash migration. |
| Supabase Realtime (notifications) | API Gateway WebSocket or keep polling | Only needed if in-app notifications must survive full migration; can defer indefinitely |
| RLS policies | Re-implement as row-level checks in application code, or use RDS + Postgres RLS directly (RLS is a Postgres feature, not Supabase-specific — it ports) | RLS policies themselves are portable SQL; the app still needs to set the equivalent of `auth.uid()` per-connection (e.g. via `SET LOCAL` with a JWT claim) |

### 2.2 Networking additions

- RDS in private subnets, no public access, security group scoped to ECS task SG only.
- VPC endpoints for S3 and Secrets Manager (avoids NAT Gateway traffic for those calls specifically, cutting the per-GB NAT cost from Phase 1).

### 2.3 Phase 2 incremental cost (on top of Phase 1's ECS/ALB/Secrets line items, replacing Supabase's $25/mo)

| Item | Sizing | Est. cost |
|---|---|---|
| RDS PostgreSQL (Multi-AZ, `db.t4g.medium`) | 2 vCPU, 4GB, Multi-AZ | ~$140–160 |
| RDS storage | 50GB gp3 | ~$6 |
| S3 storage + requests | early-stage volume | ~$5–15 |
| VPC endpoints (S3, Secrets Manager) | 2 interface endpoints | ~$14 |
| **Phase 2 incremental subtotal** | | **~$165–195/mo** |
| **New AWS total (Phase 1 + Phase 2)** | | **~$265–315/mo** |

Single-AZ RDS (`db.t4g.medium`, no Multi-AZ) roughly halves the RDS line to ~$70–80/mo if you're comfortable with reduced availability pre-revenue — reasonable for a hackathon-stage product, not for anything handling paying users' data without a backup story.

---

## Phase 3 — Headless form-filler (optional, separate initiative)

Not a deployment task — a new product capability ("fill with tab closed"). Flagged here only because the brief calls it out as a deployment-adjacent gap:

- New ECS Fargate service running Playwright, triggered per `fillSessionId`
- Needs secure session-cookie storage (short-lived, encrypted, scoped) — this is a genuine security-sensitive build, not a config change
- CAPTCHA and login-wall handling is unsolved in the current codebase and will block this for many host sites regardless of infra
- Recommend treating this as its own product spec and security review, not something to bolt onto the AWS deployment plan

---

## Consolidated checklist (maps to brief's Section 15)

**Phase 0 (do now):**
- [ ] Launch `t4g.small` EC2 instance (or `t3.micro` if free-tier eligible), Elastic IP attached
- [ ] Point a domain (or subdomain) at the Elastic IP
- [ ] Install Node 22, PM2, Caddy on the instance
- [ ] Write worker entrypoint wrapping `workers/ai-jobs` (DB-poll pattern)
- [ ] Replace `after()`/fire-and-forget with `jobs` table inserts only
- [ ] `pm2 ecosystem.config.js` defining `web` + `worker` processes
- [ ] Caddyfile: reverse proxy `:443` → `localhost:3000`, auto-TLS
- [ ] Move all Section 10 server-only vars into SSM Parameter Store
- [ ] GitHub Actions workflow: SSH deploy on push to `main`
- [ ] Cron (or PM2 cron restart) for automation sweep + deadline monitor
- [ ] Update extension `APP_BASE_URL` to the new domain, republish to Chrome Web Store
- [ ] Update Google OAuth redirect URIs to the new domain
- [ ] Verify `GET /api/health` responds over HTTPS
- [ ] Confirm CORS allows extension origin on ingest + fill-plan APIs

**Phase 1 (once you have real users):**
- [ ] Write Dockerfile for `apps/web`
- [ ] Write worker entrypoint wrapping `workers/ai-jobs` (DB-poll pattern)
- [ ] Replace `after()`/fire-and-forget with `jobs` table inserts only
- [ ] Push both images to ECR
- [ ] Create VPC, subnets, security groups (skip NAT initially if acceptable)
- [ ] Deploy ECS cluster, web service (2 tasks) + worker service (1 task)
- [ ] ALB + ACM cert + Route 53 → `app.1apply.com`
- [ ] Secrets Manager: load all Section 10 server-only vars
- [ ] EventBridge Scheduler: automation sweep (15 min) + deadline monitor (1 hr)
- [ ] Update extension `APP_BASE_URL`, republish to Chrome Web Store
- [ ] Update Google OAuth redirect URIs to production domain
- [ ] Verify `GET /api/health` on ALB target group
- [ ] Confirm CORS allows extension origin on `/api/opportunities/ingest` and `/api/applications/{id}/fill-plan`
- [ ] Load test the worker poll loop before relying on it for real automation

**Phase 2 (only if a driver emerges):**
- [ ] `pg_dump`/`pg_restore` Supabase → RDS, verify pgvector data integrity
- [ ] Migrate Storage bucket to S3, verify path structure
- [ ] Decide Auth strategy (keep Supabase Auth vs Cognito) — do not silently migrate password hashes
- [ ] Re-verify RLS-equivalent enforcement end-to-end before cutover
- [ ] Cutover with a rollback plan (keep Supabase project live, read-only, for N days post-cutover)

**Phase 3 (separate initiative):**
- [ ] Security review for session-cookie storage before writing any Playwright code
