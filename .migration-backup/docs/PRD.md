# ApplyOne Product Requirements Document

**Product:** ApplyOne (also described as “1-Apply”)  
**Tagline:** Create once. Apply everywhere.  
**Status:** Build-ready v1.0  
**Last updated:** 15 August 2026

## 1. Product Summary

ApplyOne is an AI-assisted application operating system for jobs, internships, scholarships, hackathons, grants, fellowships, universities, accelerators, conferences, ambassador programs, and—later—visas. A user creates one persistent profile from verified personal details, experiences, and documents. For each opportunity, ApplyOne analyzes requirements, checks apparent eligibility, retrieves relevant evidence, drafts truthful personalized answers, prepares permitted form fields and documents for review, and tracks the application through follow-up.

ApplyOne is not an autonomous mass-application bot. The user reviews all generated content and remains responsible for accuracy, consent, and final submission.

## 2. Problem

Applicants repeatedly enter the same information, upload similar documents, and rewrite related answers. Their data becomes fragmented across forms, files, email, and spreadsheets. They cannot reliably answer:

- What did I apply to, and when?
- Which resume or document version did I submit?
- What did I say in a previous application?
- Which deadline or follow-up is next?
- Is this opportunity suitable for me?

Existing tools often optimize only job applications or one part of the workflow. ApplyOne’s wedge is persistent, evidence-backed memory across application categories.

## 3. Goals and Success Metrics

### Product goals

1. Let a new user create a reusable, trustworthy profile in under 10 minutes.
2. Turn a supported opportunity URL into a reviewable application workspace in under 2 minutes, excluding long document processing.
3. Make every AI-written factual claim traceable to profile evidence or explicitly label it as missing.
4. Preserve a complete record of each application, including answers and document versions.
5. Reduce repetitive application preparation while retaining human review and control.

### MVP success metrics

| Metric | Definition | Target |
|---|---|---:|
| Activation | User creates a profile, adds one evidence item, and creates one application | 60% of sign-ups |
| Time to first draft | Median time from valid URL/manual opportunity entry to reviewable draft | < 2 minutes |
| Evidence coverage | Generated factual answer sentences supported by linked evidence | >= 95% |
| Draft acceptance | Draft answers used with no more than light editing | >= 60% |
| Tracking completeness | Submitted applications with stored answer and document snapshot | >= 90% |
| Autofill correctness | Supported fields filled with the user-approved mapped value | >= 95% |

Guardrail metrics: fabricated-claim reports, cross-user data exposure, unintended form submissions, and document upload mismatches must each remain zero in testing and launch cohorts.

## 4. Users

### Primary persona: high-volume early-career applicant

A student, recent graduate, career switcher, or early-career professional applying to several opportunity types. They have reusable experience but limited time and inconsistent organization.

### Secondary personas

- Scholarship or grant applicant who needs longer, evidence-rich narratives.
- Hackathon/fellowship applicant who repeatedly describes projects, motivation, and impact.
- International applicant who manages transcripts, certificates, IDs, and deadlines.

### Jobs to be done

- “When I find an opportunity, help me determine fit and prepare a truthful application quickly.”
- “When I reuse an experience, adapt it to the new prompt without inventing facts.”
- “When I return later, show exactly what I submitted and what I need to do next.”

## 5. Scope and Principles

### MVP application categories

Jobs, internships, scholarships, hackathons, and grants share enough workflow to prove the platform. Universities and visas are modeled in the taxonomy but excluded from MVP automation because of higher document, policy, and legal complexity.

### Product principles

- **Truth before fluency:** missing evidence produces a question or warning, not invention.
- **Review before action:** generation, autofill, and uploads require a review step; ApplyOne never clicks the final submit control.
- **Minimum access:** the browser extension activates only on user request and uses narrow host permissions.
- **Explainability:** eligibility, recommendations, and drafts show their inputs and confidence.
- **Snapshot history:** submitted answers and documents are immutable snapshots, even if the profile later changes.
- **User ownership:** users can edit, export, or delete their data.

## 6. Core Journey

1. User signs up and accepts privacy/AI-processing disclosures.
2. User enters core details and uploads a resume; optional links and documents can be added later.
3. ApplyOne extracts structured facts and asks the user to confirm, edit, or reject them.
4. User pastes an opportunity URL or creates an opportunity manually.
5. ApplyOne extracts requirements and questions, reports confidence, and allows corrections.
6. The workspace shows apparent eligibility, missing information, recommended evidence, and required documents.
7. ApplyOne drafts selected answers from approved evidence. Each draft exposes evidence links and warnings.
8. User edits and approves answers and chooses document versions.
9. On supported forms, the extension previews field mappings, fills approved fields, and uploads approved files.
10. User submits on the third-party site and records the outcome; ApplyOne stores a submission snapshot.
11. Dashboard surfaces deadlines, statuses, next actions, and follow-up reminders.

## 7. Epics and Acceptance Criteria

### E1. Account, consent, and onboarding

**Story:** As an applicant, I want a secure account and clear consent choices so that I control how my data is used.

Acceptance criteria:

- Email magic-link or OAuth sign-in is supported.
- The user accepts terms and privacy disclosure before document processing.
- AI processing and optional recommendation personalization are separately explained.
- First-run progress shows required and optional onboarding steps.
- A user may skip optional fields and complete them later.
- Account export and deletion entry points are visible in settings.

### E2. Persistent profile

**Story:** As an applicant, I want one editable profile so that I do not repeatedly enter the same facts.

Acceptance criteria:

- Profile supports identity, contact, location, education, employment, projects, skills, achievements, leadership, volunteering, links, and application preferences.
- Imported facts are marked unverified until confirmed by the user.
- Every material fact records source, verification state, and last update time.
- Edits create an audit entry; historical application snapshots do not change.
- Sensitive fields are masked by default where appropriate.

### E3. Document vault and versioning

**Story:** As an applicant, I want organized document versions so that I always know what was used.

Acceptance criteria:

- User can upload PDF and DOCX documents within configured size limits.
- Each document has type, label, version, upload date, extraction status, and optional expiry date.
- Replacing a file creates a new version rather than overwriting history.
- User can preview, download, archive, and delete eligible versions.
- The application workspace records the exact selected version.
- Unsupported, encrypted, corrupt, or malware-flagged files fail safely with a clear message.

### E4. Evidence graph

**Story:** As an applicant, I want my experiences represented as reusable evidence so that drafts are specific and truthful.

Acceptance criteria:

- Evidence items support situation, action, outcome, metrics, dates, skills, organization, source, and confidence.
- The user can merge duplicates and correct extracted evidence.
- AI drafts cite one or more evidence items internally.
- A claim without adequate evidence is omitted or shown as a required user input.
- The user can exclude an evidence item from AI use without deleting it.

### E5. Opportunity intake and analysis

**Story:** As an applicant, I want to paste a link and understand the opportunity so that I can decide what to do next.

Acceptance criteria:

- A valid public URL creates an opportunity record; manual entry is always available.
- Analysis extracts title, organization, category, location, deadline, requirements, requested documents, and known questions.
- Extracted fields display source and confidence and remain editable.
- Unsupported/login-gated pages explain the limitation and offer manual paste/entry.
- Duplicate URLs warn the user and link to the existing record.
- Page content is treated as untrusted data and cannot override system instructions.

### E6. Eligibility and gap check

**Story:** As an applicant, I want a transparent fit check so that I do not waste time or miss a requirement.

Acceptance criteria:

- Each explicit requirement is labeled met, not met, unclear, or not evaluated.
- The result cites the profile fact and opportunity requirement used.
- Unclear results ask for missing information.
- The UI states that this is assistance, not an official eligibility decision.
- Hard blockers and improvement suggestions are visually distinct.

### E7. Application workspace and AI answers

**Story:** As an applicant, I want personalized draft answers so that I can prepare faster without losing authenticity.

Acceptance criteria:

- User can add or import questions and word/character limits.
- User chooses a persona/emphasis preset, such as technical, leadership, academic, or impact.
- Draft respects the prompt, length constraint, selected tone, and approved evidence.
- Draft view displays evidence used, unsupported-claim warnings, generation time, and version history.
- Editing never silently changes the saved approved version.
- Generation failure retains the question and user edits and supports retry.
- The user explicitly approves an answer before it becomes eligible for autofill.

### E8. Browser extension and autofill

**Story:** As an applicant, I want to fill supported forms from approved data so that I avoid repetitive typing.

Acceptance criteria:

- Extension runs only after the user invokes it on the active tab.
- It inventories visible supported fields without submitting the form.
- Preview lists target field, proposed value/document, confidence, and source.
- Low-confidence mappings are left blank by default.
- User may include/exclude each mapping before fill.
- File upload uses only the exact approved document version.
- CAPTCHA, payment, attestation, signature, and final-submit controls are never automated.
- Unsupported fields are reported without breaking the third-party page.

### E9. Application tracking

**Story:** As an applicant, I want a complete application history so that I know what happened and what comes next.

Acceptance criteria:

- Statuses include draft, preparing, ready, submitted, assessment, interview, offer, rejected, withdrawn, and archived.
- User can set deadline, submission date, contacts, notes, next action, and reminder.
- Marking submitted creates an immutable snapshot of approved answers and document version IDs.
- List and board views support category, status, deadline, and organization filters.
- Dashboard highlights overdue and due-soon actions.

### E10. Notifications and follow-ups

**Story:** As an applicant, I want timely reminders so that deadlines and follow-ups do not slip.

Acceptance criteria:

- In-app reminders are available in MVP; email reminders are configurable.
- User selects timezone and reminder timing.
- Duplicate reminders are not sent for the same event and schedule.
- Changing or completing the underlying task updates/cancels scheduled reminders.

### E11. Privacy, security, and control

**Story:** As an applicant, I want strong data controls because my profile contains sensitive information.

Acceptance criteria:

- All user-owned records enforce tenant isolation.
- Files are private and accessed through short-lived signed URLs.
- Secrets and AI credentials never ship in the browser or extension.
- Logs exclude document contents, generated answers, authentication tokens, and sensitive profile values.
- User can export profile/application data and request account deletion.
- Deletion state and retention exceptions are communicated clearly.

## 8. UX Requirements

Primary navigation: Dashboard, Opportunities, Applications, Profile, Documents, and Settings. The central application workspace uses five steps: Analyze, Eligibility, Answers, Documents, Review. Every AI result must be editable and display status: processing, ready, needs input, failed, or stale.

Accessibility target: WCAG 2.2 AA for the web application. All workflows must be keyboard operable; status cannot rely on color alone; focus remains predictable after async operations.

## 9. Edge Cases

- No resume: onboarding supports manual profile creation.
- Conflicting facts across sources: show both, do not silently select one.
- Expired document: warn before approval and block configured high-risk document types.
- Changed opportunity page: keep the prior analysis and offer explicit re-analysis.
- Deadline without timezone: show the inferred timezone and ask for confirmation.
- Duplicate or near-duplicate questions: suggest a previous answer but generate a new version for the current context.
- Third-party form changes after preview: re-scan and require review if mappings materially change.
- Offline/extension API failure: do not partially fill without reporting which fields changed.
- User deletes profile evidence used by a submitted application: retain the immutable application snapshot under the disclosed retention policy.

## 10. MVP, Later, and Non-goals

### MVP

- Authentication, consent, onboarding, and profile.
- Resume/document upload, extraction, confirmation, and versioning.
- Evidence graph and evidence-backed answer drafting.
- URL/manual opportunity intake, editable analysis, eligibility/gap view.
- Application workspace, answer approval, document selection.
- Tracking dashboard, deadlines, status, reminders, submission snapshots.
- Chrome extension for user-invoked preview and autofill on common standard form fields.

### Post-MVP

- Opportunity recommendations and ingestion feeds.
- Email/calendar integrations and follow-up drafting.
- Team/advisor review, comments, and sharing.
- University and visa-specific workflows.
- Mobile apps, multilingual profiles, analytics, and advanced personas.

### Explicit non-goals

- Autonomous or bulk submission.
- Bypassing CAPTCHA, anti-bot controls, access controls, or site terms.
- Inventing credentials, experiences, achievements, or eligibility.
- Official legal, immigration, admissions, or financial advice.
- Scraping login-gated/private pages without authorization.
- Supporting every arbitrary form in MVP.

## 11. Launch Acceptance

MVP is launchable when the complete core journey succeeds for at least three opportunity categories; isolation/security tests pass; every generated factual answer exposes evidence or a warning; extension tests confirm no final submission; and a user can export and delete their account through documented workflows.

## 12. Open Product Decisions

- Launch geography and minimum age requirement.
- Exact file size/retention limits and free-tier quotas.
- Whether email reminders ship in the first public demo.
- Initial allowlist of tested application platforms.
- Pricing and AI usage limits; these do not block prototype development.

