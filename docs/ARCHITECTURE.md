# 1-Apply architecture and stack

This document describes the **implemented** system: repository layout, runtime stack, layering, data model, request paths, AI, extension, security, and tests. Product intent lives in [PRD.md](./PRD.md). The original proposed design is [TRD.md](./TRD.md); where they disagree, this file is the source of truth for code.

**Product:** 1-Apply (also called ApplyOne). Tagline: *Create once. Apply everywhere.*

An evidence-grounded application operating system. A user builds one Application Memory from profile facts, documents, and verified evidence. They bring opportunities by URL, paste, manual entry, discovery, or Chrome extension. The server analyzes requirements, scores eligibility and Fit Index, ranks resumes, drafts answers only from verified evidence, prepares a fill plan, and freezes a submission snapshot. The user submits on the host site. 1-Apply never clicks submit, never bypasses CAPTCHA, and never invents experience.

---

## 1. Stack

| Layer | Choice | Versions (lockfile / package.json) |
|---|---|---|
| Runtime | Node.js | `>=22` |
| Package manager | npm workspaces | root `1-apply` |
| Web UI / server | Next.js App Router | `15.5.23` (Turbopack in `dev`) |
| UI library | React | `19.2.8` |
| Styling | Tailwind CSS | `4.1.12` |
| Icons | lucide-react | `0.542.0` |
| Language | TypeScript | `5.9.2` (`strict`) |
| Validation | Zod | `4.4.3` |
| Auth / DB / storage | Supabase | `@supabase/ssr` `0.12.4`, `@supabase/supabase-js` `2.112.3` |
| Database | PostgreSQL | via Supabase |
| Vectors | pgvector | `vector(1536)` embeddings; RPC `match_user_embeddings` |
| Files | Supabase Storage | private bucket `application-documents` (configurable) |
| AI | OpenAI-compatible HTTP | default model `gpt-4o-mini`, embeddings `text-embedding-3-small` |
| Extension | Chrome Manifest V3 | TypeScript + esbuild `0.25.5` |
| Unit / integration tests | Vitest | `3.2.4` |
| E2E | Playwright | `1.55.0` |
| Lint | ESLint + eslint-config-next | `9.35.0` / `15.5.23` |

There is no separate backend service. Browser and extension talk to the Next.js app. Domain rules do not import React, Next, or Supabase.

---

## 2. Repository layout

npm workspaces: `apps/*`, `packages/*`, `workers/*`.

```text
/
├── apps/
│   ├── web/                         @1apply/web — Next.js app (UI + server actions + API)
│   └── extension/                   @1apply/extension — MV3 popup, options, SW, content script
├── packages/
│   ├── contracts/                   @1apply/contracts — Zod enums, records, env schema, API envelopes
│   ├── domain/                      @1apply/domain — pure eligibility, fit, grounding, discovery, email
│   ├── form-engine/                 @1apply/form-engine — field inventory, mapping, CAPTCHA/submit safety
│   └── config/                      @1apply/config — shared tsconfig.base.json
├── workers/
│   └── ai-jobs/                     @1apply/ai-jobs — job processor *boundary* (not the production runner)
├── supabase/migrations/             ordered SQL (types, tables, RLS, RPCs, storage)
├── docs/                            PRD, TRD, FEATURES, this file
├── .env.example                     public placeholders only
└── package.json                     workspace scripts: dev, build, lint, typecheck, test, test:e2e
```

### Web app (`apps/web/src`)

| Path | Role |
|---|---|
| `app/` | App Router: marketing, auth, onboarding, workspace pages, `api/` route handlers |
| `components/` | UI primitives, workspace chrome, application workspace, marketing |
| `server/` | Server actions and use-case modules (memory, documents, opportunities, answers, integrations) |
| `services/` | Retrieval, embeddings, platform events — session-scoped, no React |
| `infra/` | AI provider, job runner, storage signed URLs, page fetch |
| `lib/` | env, Supabase clients, SSRF URL checks, upload validation, workflow helpers |
| `auth/` | `Actor` (`userId` + profile) |
| `config/` | `loadAppConfig()` |
| `tests/` | Vitest unit / integration / security; Playwright e2e |

### Layering rule

```text
UI (RSC / client components)
  → server actions or API route handlers
    → services / server modules
      → infra (Supabase session client, AiProvider, storage)
        → Postgres RLS + Storage
  → @1apply/domain  (pure functions, no I/O)
  → @1apply/contracts (Zod)
  → @1apply/form-engine (extension + fill-plan)
```

- The browser does not call the model.
- UI does not own SQL.
- Server uses the **user JWT** (cookie or `Authorization: Bearer`), not the service role, for normal product paths.
- `SUPABASE_SERVICE_ROLE_KEY` is for workers/admin only and must never be `NEXT_PUBLIC_*` or stored in the extension.

---

## 3. System context

```text
Applicant
  ├─ Web (Next.js) ── cookie session ──► Postgres + pgvector (RLS)
  │                         │
  │                         ├─► Private Storage (path = {userId}/…)
  │                         └─► OpenAI-compatible API (server only)
  │
  └─ Chrome extension
        activeTab + cookies + host permission for app origin
        website session (cookies / same-origin bridge) — no pasted tokens
        POST /api/opportunities/ingest
        GET  /api/extension/session
        GET  /api/extension/applications
        POST /api/applications/{id}/fill-plan
        content script fills approved fields only
        third-party form submit stays with the user
```

Trust boundaries:

- Third-party HTML and resume text are **untrusted data**, wrapped before any model call.
- The extension authenticates via the signed-in website session in the same browser profile (not a pasted `service_role` JWT).
- Integration OAuth tokens are AES-GCM ciphertext (`enc:v1:`) using `TOKEN_ENCRYPTION_KEY` (or Google client secret as fallback). Encrypt fails closed if no key.
- Page fetch for URL ingest is SSRF-checked (block localhost, link-local, private IPv4/IPv6, metadata hosts; DNS re-check).

---

## 4. Auth, consent, and routing

**Auth:** Supabase Auth (email magic-link / password flows on `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`). Callback: `/auth/callback`.

**Session refresh:** `apps/web/src/lib/supabase/middleware.ts` via Next middleware.

**Actor:** `{ userId, email, profile }` from `getCurrentUserAndProfile`. Workspace mutations use `requireWorkspace()` (redirect to sign-in). Extension/API mutations use `requireApiSession(request)` (website cookie session preferred; optional Bearer user JWT still accepted for legacy; rejects privileged JWTs; requires consent).

**Consent:** `terms_accepted_at` and `ai_processing_accepted_at` must be set before document processing. Migration `20260819160000_security_hardening.sql` makes those timestamps (and `onboarding_completed_at`) immutable.

**Onboarding steps** (`@1apply/contracts`): `consent` → `profile` → `documents` → `review` → `ready`. Middleware sends incomplete users to `onboardingHref(step)`. Documents can be skipped; extraction is optional if no AI key.

**Workspace nav:** Dashboard, Opportunities, Applications, Application Memory, Documents, Resumes, Notifications, Integrations, Settings.

---

## 5. HTTP surface

Most product mutations are **Next.js server actions** (form POST, not REST). JSON APIs exist for the extension, OAuth, jobs, health, and export.

### Route handlers (`apps/web/src/app/api`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | `{ ok: true }` only — no AI/DB flags |
| `POST` | `/api/opportunities/ingest` | Extension/web URL ingest; CORS for `chrome-extension://` |
| `POST` | `/api/opportunities/discover` | Discovery query → ranked catalog results |
| `GET` | `/api/jobs/{id}` | Owner-scoped job status |
| `GET` | `/api/extension/session` | `{ email, connected: true }` |
| `GET` | `/api/extension/applications` | Recent applications for the popup picker |
| `POST` | `/api/applications/{id}/fill-plan` | Map detected fields → memory/answers; persist `fill_sessions` + `field_mappings` |
| `GET` | `/api/integrations/callback` | Google OAuth return (HMAC state cookie) |
| `GET` | `/api/account/export` | JSON download of profile, evidence, applications, snapshots |

Envelope for JSON APIs: `{ data, error, requestId }` from `createApiEnvelopeSchema`.

### Server action modules (representative)

| Module | Responsibility |
|---|---|
| `server/onboarding/actions.ts` + `upload.ts` | Consent, profile, resume upload |
| `server/memory/actions.ts` | Evidence CRUD, verify/exclude, memory document upload |
| `server/documents/actions.ts` + `service.ts` | Vault, versions, signed read URLs, extract+embed |
| `server/opportunities/actions.ts` | Manual, paste, URL, save discovered listing |
| `server/opportunities/ingest.ts` + `analyze.ts` | Canonical URL, persist analysis, then intelligence |
| `server/intelligence/evaluate.ts` | Eligibility, Fit Index, resume ranking persistence |
| `server/answers/generate.ts` + `actions.ts` | Grounded draft, approve/edit/reject |
| `server/applications/actions.ts` | Fit refresh, attach documents, status, `markSubmitted` snapshot |
| `server/integrations/actions.ts` | Connect/disconnect Gmail & Calendar |
| `server/notifications/actions.ts` | Mark read; drafts from domain events |
| `server/automation/sweep.ts` | Deadline / completeness notices (no auto-submit) |
| `server/account/actions.ts` | Delete profile row (needs `profiles_delete_own` policy) |

### App routes

| Path | Page |
|---|---|
| `/` | Marketing |
| `/sign-in` `/sign-up` `/forgot-password` `/reset-password` | Auth |
| `/app/onboarding/*` | Consent, profile, documents, review, ready |
| `/app` | Dashboard |
| `/app/opportunities` `[id]` | Pipeline + detail |
| `/app/applications` `[id]` | List + workspace (analyze, eligibility, fit, answers, documents, review, autofill, tracking) |
| `/app/memory` | Application Memory |
| `/app/documents` `[id]` | Vault + version |
| `/app/resumes` | Resume variants |
| `/app/notifications` | In-app notifications |
| `/app/integrations` | Gmail / Calendar |
| `/app/settings` | Session, extension connect (website session), export, delete |
| `/app/profile` | Redirect/alias into memory/profile |

---

## 6. Packages

### `@1apply/contracts`

Shared Zod schemas and TypeScript types: application statuses, document types, opportunity categories/sources, eligibility states, job types, verification, onboarding, completeness, ingest payloads, API envelopes, `envSchema`.

Opportunity categories: `job`, `internship`, `scholarship`, `hackathon`, `grant`, `fellowship`, `university`, `accelerator`, `conference`, `ambassador`, `visa`, `other`.

### `@1apply/domain` (no I/O)

| Module | What it decides |
|---|---|
| `matching` / `eligibility` / `fit-index` | Requirement vs evidence; Fit Index factors; reconstructable score |
| `resume-matching` | Rank resume variants from labels/text |
| `grounding` | `finalizeGroundedDraft` (no evidence → empty text + `NO_EVIDENCE`); `freezeSubmissionManifest` |
| `answer-generation` | Prompt build, claim extract/validate, evidence rank, question classify |
| `memory` | Fact keys, conflict detection, ownership assert |
| `submission-guard` | Safe-to-snapshot checks; captcha/signature/payment blockers |
| `deadline-intelligence` | Urgency, reminders, auto-submit policy (**disabled**) |
| `discovery` | Parse query, normalize URLs, dedupe, rank |
| `discovery-catalog` | Static sourced listings (not live job boards) |
| `email-intelligence` | Classify mail, associate to applications, propose calendar events |
| `notifications` | Drafts from domain events |
| `automation` | What the sweep may notify vs never submit |
| `operating-loop` | Stage assessment for the Create→Track loop |

### `@1apply/form-engine`

Used by the content script and fill-plan API:

- Inventory fields (label, name, id, placeholder, aria, nearby text).
- Map to Application Memory / approved answers with confidence.
- Block submit, CAPTCHA, signature, payment, password, attestation.
- Sensitive fields (SSN, work auth, demographics, etc.) excluded by default.
- `assertFillActionAllowed("setValue")` — `submit` / `bypassCaptcha` throw.

### `@1apply/ai-jobs`

Selects queued jobs and dispatches processors. Production extract/analyze currently runs **inside the HTTP request** via `runOwnedJob` (`apps/web/src/infra/jobs/runner.ts`), which inserts a `jobs` row, runs the work, then marks completed/failed. A dropped request can lose in-flight work. The worker package is the intended long-running boundary, not the live runner.

---

## 7. Data model

User-owned tables include `user_id` (profiles use `id = auth.uid()`). RLS is deny-by-default. FKs cascade on profile delete.

### Core tables (init + architecture)

| Table | Purpose |
|---|---|
| `profiles` | Identity, contact, consent, onboarding, preferences |
| `profile_facts` | Typed facts with source, verification, `fact_key` |
| `profile_links` | LinkedIn / GitHub / portfolio |
| `experiences` | Structured experience rows |
| `evidence_items` | STAR-style evidence; `excluded_from_ai`; extraction status |
| `evidence_sources` / `evidence_skills` / `skills` | Provenance and skill graph |
| `documents` / `document_versions` / `document_chunks` | Logical doc, immutable versions, text chunks |
| `resumes` | Resume-typed documents for matching |
| `embeddings` | pgvector rows; search via `match_user_embeddings` (`where user_id = auth.uid()`) |
| `opportunities` | Source URL, category, analysis status, deadline, metadata |
| `requirements` | Hard/soft requirements with kind + confidence |
| `opportunity_questions` / `opportunity_documents` | Extracted prompts and required docs |
| `applications` | Workspace row: status, deadline, next_action, submitted_at |
| `application_questions` | Legacy per-application questions (workspace **reads** `opportunity_questions`) |
| `application_answers` | Current answer state, approved_text, evidence_ids, grounding_score |
| `answer_versions` | Immutable draft history |
| `application_documents` | Exact `document_version_id` attached to an application |
| `eligibility_results` / `fit_evaluations` / `resume_matches` | Intelligence outputs |
| `review_items` | Unclear / not-met items for the user |
| `submission_snapshots` | Frozen answer text + document version ids + opportunity/field manifests |
| `submission_attempts` | Idempotency / duplicate protection |
| `fill_sessions` / `field_mappings` | Extension preview persistence |
| `jobs` / `ai_runs` / `audit_events` | Async + telemetry (redacted metadata) |
| `notifications` | In-app notices |
| `integrations` / `integration_tokens` | Gmail / Calendar OAuth |
| `email_events` / `calendar_events` | Classified mail and proposed events |
| `contacts` / `reminders` | Follow-up (schema present; UI is thin) |
| `application_events` / `application_status_history` | Timeline |
| `discovery_requests` / `discovery_results` | Ranked catalog hits |
| `memory_conflicts` (memory migration) | Unresolved extracted vs existing facts |

### Application lifecycle (normalized)

`saved` → `analyzing` → `ready_to_apply` → `in_progress` → `review_required` → `submitted` → `under_review` | `interview` | `accepted` | `rejected` | `withdrawn` | `archived`

Legacy DB values (`draft`, `preparing`, `ready`, `offer`, `assessment`) map onto this set in `lib/application-workflow.ts`.

### Storage paths

`{userId}/{type-folder}/{documentId}/{versionId}/{sanitizedFileName}`

Signed read URLs refuse paths that do not start with the actor’s user id.

---

## 8. Migrations (apply in timestamp order)

Run in the Supabase SQL editor (this repo has no local migration runner).

| File | Adds |
|---|---|
| `20260818000000_init.sql` | Extensions, enums, core tables, RLS, private bucket |
| `20260818010000_phase3.sql` | Fit, resume matches, review items, notifications |
| `20260818020000_architecture.sql` | Skills, embeddings, fill sessions, integrations, `match_user_embeddings` |
| `20260818030000_grants_onboarding.sql` | Grants / onboarding fields |
| `20260818040000_memory.sql` | Fact keys, extraction status, conflicts |
| `20260818050000_documents_evidence.sql` | Version metadata, embedding grants |
| `20260818060000_opportunity_intelligence.sql` | Opportunity metadata, discovery_requests |
| `20260818070000_intelligence.sql` / `phase8_intelligence.sql` | Intelligence columns |
| `20260818080000_answer_generation.sql` | `application_answers` |
| `20260818100000_application_workflow.sql` | Workflow statuses |
| `20260818110000_submission_deadline_intelligence.sql` | Snapshot manifests, submission_attempts |
| `20260818120000_email_calendar_integration.sql` | `integration_tokens`, email/calendar columns |
| `20260819140000_opportunity_discovery.sql` | `discovery_results` |
| `20260819150000_notifications_automation.sql` | Notification / automation columns |
| `20260819160000_security_hardening.sql` | Consent immutability, audit RPC, token select |
| `20260819180000_account_deletion.sql` | `profiles_delete_own` |

---

## 9. Core data flows

### 9.1 Document → Application Memory

1. Upload validated (size ≤ 8 MB, MIME vs extension, magic bytes for PDF/DOCX).
2. Object stored under the user prefix; `documents` + `document_versions` rows created.
3. `extractDocumentText`: UTF-8 for text; PDF via the configured OpenAI-compatible document API (structured resume-style plain text); DOCX via mammoth / `word/document.xml`. Encrypted PDFs and unreadable scans return no text when AI is unavailable or extraction fails.
4. Chunks written; optional embeddings.
5. If AI is configured, structured extraction runs on `<untrusted_document_content>…`.
6. Facts/evidence persist as **unverified**. User verifies, rejects, or excludes from AI.
7. Generation and eligibility use **verified** and non-excluded evidence only.

### 9.2 Opportunity → workspace

1. **URL:** canonicalize, SSRF-safe fetch, wrap page as `<untrusted_page_content>`.
2. **Paste / manual / extension:** same persist path with different `opportunity_source`.
3. Duplicate canonical URL reopens the existing opportunity.
4. Structured extraction → requirements, questions, required documents, deadline.
5. `evaluateApplicationIntelligence` writes eligibility, Fit Index, resume matches.
6. Unclear / not-met requirements become `review_items`.

### 9.3 Evidence → answer → approval

1. Rank verified evidence for the question (lexical; optional vector merge in retrieval helpers).
2. Model receives instruction + untrusted JSON (question + evidence ids only).
3. Server runs `finalizeGroundedDraft`: unknown ids stripped; **no allowed evidence ⇒ empty text**.
4. User edits and **approves**. Autofill and snapshots use `approved_text`.

### 9.4 Fill plan → autofill ≠ submit

1. Content script inventories fields and hazards (CAPTCHA, account wall, canvas-only).
2. `POST /api/applications/{id}/fill-plan` maps fields against profile, verified facts, and approved answers.
3. Popup: user checks fields. Sensitive/blocked stay off unless explicitly approved (files stay blocked — cannot set `<input type=file>`).
4. Content script sets `value` / change events only. Submit controls are never inventoried as fill targets.

### 9.5 Snapshot

`markSubmitted` runs `evaluateSubmissionGuard`, records `submission_attempts`, freezes answer **text** + document **version ids** + opportunity excerpt + field manifest, sets status `submitted`. Changing Application Memory later does not rewrite that JSON. Duplicate identical attempts are rejected.

---

## 10. AI design

`AiProvider` (`infra/ai/provider.ts`) is the only model boundary:

- `completeStructured` / `generateStructured` — Zod-validated JSON
- `embed` — 1536-d vectors
- `tryGetAiProvider()` returns `null` if `OPENAI_API_KEY` is missing or a placeholder; the UI then asks the user to write from evidence

Safety:

- Host page and resume text go in `untrustedData`, never concatenated into the system instruction.
- Grounding score and claim flags stored on answers.
- `ai_runs` can meter calls; logs must not include document bodies, answers, or tokens (`lib/log.ts` + audit scrub).

Default models (overridable):

- Chat: `OPENAI_MODEL` / `gpt-4o-mini`
- Embeddings: `EMBEDDING_MODEL` / `text-embedding-3-small`
- Base URL: `OPENAI_BASE_URL` (OpenAI or compatible)

---

## 11. Chrome extension

**Manifest V3** (`apps/extension/manifest.json`):

- Permissions: `activeTab`, `storage`, `scripting`, `cookies`, `tabs`
- Optional host permissions: `http://*/*`, `https://*/*` (requested for the app origin on Connect)
- Popup, options page, module service worker, injected `content.js` (job pages) and `bridge.js` (1-Apply tabs)

**Build:** `node apps/extension/build.mjs` (esbuild).

**Auth:** App base URL is hardcoded (`APP_BASE_URL` in the extension, currently `http://localhost:3000`). Connect uses the website session cookies (direct fetch + Cookie header, with same-origin bridge fallback). No pasted tokens or Options URL field.

**Messages:** `SAVE_PAGE`, `SCAN_FORM`, `CREATE_FILL_PLAN`, `APPLY_SUGGESTIONS`, `SESSION`, `LIST_APPLICATIONS`, `CONNECT`. Fill writes top suggestions into fields automatically; a Grammarly-style chip appears on fields with alternate options. Never submits.

---

## 12. Integrations

Optional, off by default (`GMAIL_SYNC_ENABLED`, `CALENDAR_SYNC_ENABLED`).

- Google OAuth: `GOOGLE_OAUTH_CLIENT_ID` / `SECRET`
- State cookie `1apply_oauth_state`: payload HMAC-signed, httpOnly, 10 minute TTL, bound to user + kind (`gmail` | `google_calendar`)
- Tokens encrypted at rest; sync classifies mail and proposes calendar events; association is heuristic (org/title/domain)

Email **reminders** in the notification service are currently **logged**, not SMTP-delivered.

---

## 13. Security checklist (implemented)

| Control | Where |
|---|---|
| RLS owner policies | `supabase/migrations/*` |
| Vector isolation | `match_user_embeddings` `e.user_id = auth.uid()` |
| Private files | Storage policies + path prefix + signed URLs |
| SSRF | `lib/security/public-url.ts`, `server/ingest/fetch-page.ts` |
| Prompt isolation | `lib/opportunities/untrusted.ts` |
| No privileged JWT in extension | `lib/security/jwt.ts`, `apps/extension/src/shared/jwt.ts` |
| Consent immutability | `protect_profile_gates` |
| Audit RPC | `record_audit_event` (no client insert policy) |
| Token ciphertext | `server/integrations/token-crypto.ts` |
| Autofill ≠ submit | form-engine + content script |
| Auto-submit policy | `DEFAULT_AUTO_SUBMIT_POLICY.enabled = false` |

---

## 14. Environment

Copy `.env.example` → `apps/web/.env.local`. Never commit real keys.

**Public (browser):**

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_EXTENSION_ORIGIN`

**Server-only:**

- `SUPABASE_SERVICE_ROLE_KEY`
- `STORAGE_BUCKET`
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`
- `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`
- `TOKEN_ENCRYPTION_KEY`
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
- `GMAIL_SYNC_ENABLED`, `CALENDAR_SYNC_ENABLED`

---

## 15. Local commands

```bash
npm install
cp .env.example apps/web/.env.local   # then fill live anon URL/key
# apply SQL migrations in Supabase in timestamp order
npm run dev                           # Next on :3000
npm run lint
npm run typecheck
npm test                              # all workspaces Vitest
npm run test:e2e                      # Playwright (placeholder Supabase; public/gated routes)
npm run build
```

Extension: `npm run build -w @1apply/extension`, then Load unpacked the build output.

---

## 16. Testing map

| Suite | Location | Covers |
|---|---|---|
| Domain unit + AI eval | `packages/domain/tests/` | Eligibility, fit, grounding ≥95% fixtures, discovery, email, notifications |
| Form engine | `packages/form-engine/tests/` | Detection, mapping, CAPTCHA, no submit |
| Web unit | `apps/web/tests/unit/` | Upload, RLS SQL, SSRF, OAuth crypto, workflow |
| Integration pipelines | `apps/web/tests/integration/` | Memory → fit → answers → snapshot composed in-process |
| Security | `apps/web/tests/security/` | Cross-user owner checks in loaders + SQL |
| E2E | `apps/web/tests/e2e/` | Marketing + auth gates (no live Supabase login) |
| Worker | `workers/ai-jobs/tests/` | Queue selection |

Playwright `webServer` starts `next start` with placeholder Supabase so `/app/*` stays gated.

---

## 17. Implementation notes (honest)

These are architectural facts, not a feature list:

- Jobs are recorded in Postgres but **executed inline** in the server action/API request.
- Discovery ranks a **sourced catalog**, not live employer sites.
- PDF extraction needs a text layer; scans need OCR (not implemented).
- Workspace questions come from `opportunity_questions`; fill-plan maps approved `application_answers`.
- Account export is a same-request JSON download. Profile delete requires `20260819180000_account_deletion.sql`. `auth.users` is not removed by Settings.
- TRD REST resources such as `POST /api/documents/uploads` were not built as listed; uploads use server actions.

---

## 18. Related docs

- [PRD.md](./PRD.md) — users, journeys, acceptance, non-goals
- [FEATURES.md](./FEATURES.md) — P0/P1/P2 backlog
- [TRD.md](./TRD.md) — original proposed design (may lag the code)
- Root [README.md](../README.md) — run instructions and safety one-liners
