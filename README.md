# ApplyOne Prototype

An interactive frontend prototype for the ApplyOne application operating system. It demonstrates the persistent-profile dashboard, application pipeline, opportunity analysis, eligibility checks, evidence-grounded answer generation, profile editing, document state, and responsive navigation.

## Run locally

```bash
pnpm install
pnpm dev
```

Then open `http://localhost:5173`.

## Quality checks

```bash
pnpm lint
pnpm build
```

This is a frontend-only prototype with seeded data. The opportunity analysis and answer generation are deterministic demo interactions; backend authentication, storage, database, and live AI integration are specified in `docs/TRD.md` but are not part of this initial slice.
