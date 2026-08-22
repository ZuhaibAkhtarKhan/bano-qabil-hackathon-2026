# ApplyOne Feature Specification and Prioritized Backlog

This document converts the PRD into build slices. Priority meanings: **P0** is required for the first usable MVP, **P1** completes the public beta proposition, and **P2** is post-MVP expansion. IDs are stable and should be reused in issues, commits, and tests.

## Release Definition

### Prototype demo

P0 web journey using a seeded or real profile: upload resume, confirm evidence, analyze an opportunity, show eligibility, generate an evidence-backed answer, select a document, and record an application.

### MVP beta

All P0 plus P1 security, tracking, reminder, export/delete, and browser extension requirements. Supports jobs, internships, scholarships, hackathons, and grants.

## Feature Backlog

| ID | Priority | Feature | User-visible outcome | Dependencies |
|---|---|---|---|---|
| AUTH-01 | P0 | Sign-in/session | User securely enters and resumes ApplyOne | Foundation |
| CONSENT-01 | P0 | Consent onboarding | User understands AI and document processing | AUTH-01 |
| PROF-01 | P0 | Core profile | Reusable identity/contact/education details | AUTH-01 |
| PROF-02 | P0 | Experience editor | User records work, projects, achievements, leadership | PROF-01 |
| PROF-03 | P1 | Source and verification states | User distinguishes imported from confirmed facts | PROF-02, DOC-03 |
| PROF-04 | P1 | Persona presets | User emphasizes technical, academic, leadership, or impact evidence | PROF-02 |
| DOC-01 | P0 | Private document upload | User stores resume/transcript/certificate files | AUTH-01 |
| DOC-02 | P0 | Document vault | User previews, labels, filters, downloads, archives | DOC-01 |
| DOC-03 | P0 | Text/fact extraction review | User confirms extracted profile candidates | DOC-01, JOB-01, AI-01 |
| DOC-04 | P0 | Immutable versioning | Each replacement preserves prior versions | DOC-01 |
| DOC-05 | P1 | Expiry and duplicate warnings | User avoids stale or repeated documents | DOC-04 |
| EVID-01 | P0 | Evidence graph | Experiences become structured, reusable evidence | PROF-02, DOC-03 |
| EVID-02 | P0 | Evidence retrieval | Relevant approved facts are selected per prompt | EVID-01, AI-02 |
| EVID-03 | P1 | Evidence merge/exclusion | User controls duplicate or private evidence | EVID-01 |
| OPP-01 | P0 | Manual opportunity creation | Any unsupported opportunity can still be tracked | AUTH-01 |
| OPP-02 | P0 | URL analysis | Public page becomes editable structured opportunity | JOB-01, AI-01, SEC-03 |
| OPP-03 | P0 | Requirement/question extraction | User sees requirements, documents, and prompts | OPP-02 |
| OPP-04 | P1 | Duplicate/staleness handling | User avoids duplicates and can re-analyze changes | OPP-02 |
| ELIG-01 | P0 | Transparent eligibility matrix | Each requirement is met/not met/unclear with evidence | OPP-03, PROF-03 |
| ELIG-02 | P1 | Missing-info workflow | Unclear checks become actionable profile questions | ELIG-01 |
| APP-01 | P0 | Application workspace | One guided place for analysis, answers, docs, review | OPP-01, PROF-01 |
| ANS-01 | P0 | Grounded draft generation | User gets a truthful, tailored answer | APP-01, EVID-02, AI-01 |
| ANS-02 | P0 | Limits and evidence display | Draft respects length and shows sources/warnings | ANS-01 |
| ANS-03 | P0 | Editing/version/approval | User controls the exact approved answer | ANS-02 |
| ANS-04 | P1 | Previous-answer suggestions | Similar prior work speeds drafting without silent reuse | ANS-03 |
| APP-02 | P0 | Document selection | Application records exact document versions | APP-01, DOC-04 |
| TRACK-01 | P0 | Status and history | User knows every application’s current state | APP-01 |
| TRACK-02 | P0 | Deadlines and next actions | Dashboard surfaces what is due next | TRACK-01 |
| TRACK-03 | P1 | Submission snapshot | Approved answers/docs are preserved at submission | ANS-03, APP-02 |
| TRACK-04 | P1 | List/board/filter views | User can manage a larger pipeline | TRACK-01 |
| REM-01 | P1 | In-app reminders | User sees upcoming deadlines/follow-ups | TRACK-02, JOB-01 |
| REM-02 | P1 | Email reminders | User receives configurable external reminders | REM-01 |
| EXT-01 | P1 | Extension sign-in/link | Extension accesses only the signed-in user session | AUTH-01, SEC-04 |
| EXT-02 | P1 | Field inventory | Active page reports supported fields | EXT-01 |
| EXT-03 | P1 | Mapping preview | User reviews values, sources, and confidence | EXT-02, APP-01 |
| EXT-04 | P1 | Controlled autofill | Only selected standard fields are filled | EXT-03 |
| EXT-05 | P1 | Approved file upload | Selected exact document version is attached | EXT-03, APP-02 |
| EXT-06 | P1 | Protected-control exclusions | CAPTCHA/payment/signature/attestation/submit stay untouched | EXT-04 |
| DATA-01 | P1 | Data export | User downloads a portable profile/application archive | AUTH-01 |
| DATA-02 | P1 | Account deletion | User can delete account through confirmed workflow | AUTH-01 |
| SEC-01 | P0 | Tenant isolation/RLS | No user can access another user’s rows/vectors | Foundation |
| SEC-02 | P0 | Private file access | Files require authorized short-lived access | DOC-01 |
| SEC-03 | P0 | Safe URL fetch | URL analysis resists SSRF and hostile content | OPP-02 |
| SEC-04 | P1 | Minimal extension permissions | Extension runs on active user request only | EXT-01 |
| SEC-05 | P1 | Audit/redacted telemetry | Sensitive actions are traceable without content leakage | Foundation |
| AI-01 | P0 | Structured AI gateway | AI calls are server-only, schema-validated, metered | Foundation |
| AI-02 | P0 | Permission-aware embeddings | Similarity search cannot cross user boundaries | EVID-01, SEC-01 |
| AI-03 | P1 | Quality/safety evaluation suite | Regressions in grounding or injection are blocked | AI-01, AI-02 |
| JOB-01 | P0 | Async job lifecycle | Long work is retryable and survives refresh | Foundation |
| OBS-01 | P1 | Operational monitoring | Team can diagnose failures by request/job ID | JOB-01 |
| REC-01 | P2 | Opportunity recommendations | User sees explainable profile matches | EVID-01, OPP-03 |
| INT-01 | P2 | Calendar integration | Deadlines sync with user calendar | TRACK-02 |
| INT-02 | P2 | Email integration | Status/follow-up signals can be linked with consent | TRACK-01 |
| COLLAB-01 | P2 | Advisor review | User can request bounded comments on an application | APP-01 |
| CAT-01 | P2 | University workflows | Category-specific admissions fields and documents | MVP validated |
| CAT-02 | P2 | Visa workflows | Carefully scoped checklist/tracking, not legal advice | Policy/legal review |

## Detailed MVP Slices

### Slice A — “Remember me”

Includes AUTH-01, CONSENT-01, PROF-01/02, DOC-01/03/04, EVID-01, SEC-01/02, AI-01, and JOB-01.

Demo proof: upload a resume, inspect extracted facts, correct one fact, approve evidence, upload a new resume version, and show that both versions remain identifiable.

### Slice B — “Understand this opportunity”

Includes OPP-01/02/03, ELIG-01, SEC-03.

Demo proof: paste a public opportunity link, show extracted requirements and confidence, correct the deadline, then show a requirement-by-requirement eligibility view with an `unclear` item rather than a guessed answer.

### Slice C — “Write from evidence”

Includes APP-01, EVID-02, ANS-01/02/03, APP-02, AI-02.

Demo proof: generate a constrained answer, open the evidence drawer, edit it, approve the version, and select an exact resume version.

### Slice D — “Never lose the application”

Includes TRACK-01/02 and the P1 TRACK-03/04, REM-01, DATA-01/02.

Demo proof: mark an application submitted, change the profile afterward, and show that the stored submission snapshot remains unchanged.

### Slice E — “Fill with control”

Includes EXT-01 through EXT-06 and SEC-04.

Demo proof: open a supported fixture form, preview mappings, reject one low-confidence field, fill selected fields and an approved file, and show that the submit button remains untouched.

## Cross-cutting UX States

Every feature must define and test:

- First-run/empty state with one clear next action.
- Loading/progress state that survives refresh for async work.
- Validation state beside the affected field.
- Recoverable error with retry or manual fallback.
- Permission/unsupported state that explains the boundary.
- Stale state when source profile, opportunity, or page changes.
- Accessible success state announced without relying only on color.

## Analytics Events

Events contain IDs, category, state, latency, and error code—not profile content, document text, questions, answers, or field values.

- `onboarding_started`, `onboarding_completed`
- `document_uploaded`, `document_processing_completed`, `evidence_confirmed`
- `opportunity_created`, `opportunity_analysis_completed`
- `eligibility_reviewed`, `draft_generated`, `answer_approved`
- `fill_preview_created`, `fill_completed`
- `application_status_changed`, `submission_snapshot_created`
- `export_requested`, `deletion_requested`

## Recommended Issue Order

1. Foundation, schema, RLS tests, auth, contracts, CI.
2. Profile and private document upload/versioning.
3. Jobs, extraction, confirmation, and evidence graph.
4. Manual opportunity and workspace.
5. Safe URL analysis, requirement extraction, and eligibility.
6. Retrieval, grounded drafting, versioning, and approval.
7. Tracking, deadlines, documents, and snapshots.
8. Extension inventory, preview, fill, and exclusions.
9. Reminders, export/deletion, observability, accessibility, and hardening.

## Feature Acceptance Gate

No feature is complete if it works only on the happy path. Each issue must link to its PRD acceptance criteria, identify its authorization rule, include empty/loading/error/stale behavior where relevant, add automated tests, and demonstrate that logs/analytics do not contain sensitive content.

