# 1-Apply

Create once. Apply everywhere.

Evidence-grounded application operating system: Application Memory, opportunity analysis, eligibility, Fit Index, grounded answers, controlled autofill, and submission snapshots.

The Chrome extension never clicks submit. It connects to your signed-in 1-Apply session in the same browser (no pasted tokens) and builds fill plans from Application Memory.

## Layout

```text
apps/web                 Next.js UI (thin routes) + services + infra
apps/extension           Chrome Manifest V3 shell (activeTab only)
packages/contracts       Zod types and validation
packages/domain          Eligibility, grounding, matching (no React, no I/O)
packages/form-engine     Protected-control rules for future autofill
packages/config          Shared TypeScript config
workers/ai-jobs          Background job processor boundary
supabase/migrations      PostgreSQL, RLS, pgvector, private storage
```

UI does not call the model or own SQL. Server actions call services. Services use session-scoped infra. Domain logic lives in `@1apply/domain`.

Full architecture, stack versions, tables, APIs, and data flows: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run locally

```bash
npm install
cp .env.example apps/web/.env.local
# Fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
# Optional: GROQ_API_KEY for posting rewrite (preferred) or OPENAI_API_KEY
npm run dev
```

Apply migrations in order:

- `supabase/migrations/20260818000000_init.sql`
- `supabase/migrations/20260818010000_phase3.sql`
- `supabase/migrations/20260818020000_architecture.sql`
- `supabase/migrations/20260818030000_grants_onboarding.sql`
- `supabase/migrations/20260818040000_memory.sql`
- `supabase/migrations/20260818050000_documents_evidence.sql`
- `supabase/migrations/20260818060000_opportunity_intelligence.sql`
- `supabase/migrations/20260818070000_phase8_intelligence.sql`
- `supabase/migrations/20260818080000_answer_generation.sql`
- `supabase/migrations/20260818100000_application_workflow.sql`
- `supabase/migrations/20260818110000_submission_deadline_intelligence.sql`
- `supabase/migrations/20260818120000_email_calendar_integration.sql`
- `supabase/migrations/20260819140000_opportunity_discovery.sql`
- `supabase/migrations/20260819150000_notifications_automation.sql`
- `supabase/migrations/20260819160000_security_hardening.sql`
- `supabase/migrations/20260819180000_account_deletion.sql`
- `supabase/migrations/20260819190000_realtime_events.sql`

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Safety

- Row Level Security is deny-by-default. Vector search filters `auth.uid()` before ranking.
- Documents are private and path-scoped to the user id.
- No evidence → no claim. AI stays behind `AiProvider`.
- Autofill ≠ submit. Protected controls are excluded in the form engine.
- Secrets are never `NEXT_PUBLIC_*`.
