# 1-Apply

Create once. Apply everywhere.

Evidence-grounded application operating system: Application Memory, opportunity analysis, eligibility, Fit Index, grounded answers, controlled autofill, and submission snapshots.

The Chrome extension never clicks submit. Fill requires a user session token in Options and a fill-plan from the signed-in app.

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

## Run locally

```bash
npm install
cp .env.example apps/web/.env.local
# Fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
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
