export type SubmissionCheckKind =
  | "required_fields"
  | "documents_present"
  | "approved_answers"
  | "unresolved_info"
  | "unsupported_claims"
  | "resume_selected"
  | "document_versions"
  | "captcha_status"
  | "signature_status"
  | "payment_status"
  | "security_challenge"
  | "user_authorization"
  | "duplicate_protection";

export type CheckResult = {
  kind: SubmissionCheckKind;
  label: string;
  passed: boolean;
  reason: string;
  blocking: boolean;
};

export type SubmissionGuardResult = {
  safe: boolean;
  checks: CheckResult[];
  blockers: CheckResult[];
  warnings: CheckResult[];
  idempotencyKey: string;
};

export type SubmissionInput = {
  applicationId: string;
  status: string;
  questions: Array<{ id: string; prompt: string }>;
  approvedAnswerIds: Map<string, string>;
  attachedDocumentIds: string[];
  resumeMatchRecommended: string | null;
  eligibilityResults: Array<{ state: string; explanation: string }>;
  reviewItems: Array<{ resolved: boolean; prompt: string }>;
  snapshots: Array<{ id: string }>;
  fitScore: number | null;
  fitMissing: string[];
  hasSignatureField: boolean;
  hasPaymentField: boolean;
  hasCaptcha: boolean;
  hasSecurityChallenge: boolean;
  userAuthenticated: boolean;
};

function check(
  kind: SubmissionCheckKind,
  label: string,
  passed: boolean,
  reason: string,
  blocking = true,
): CheckResult {
  return { kind, label, passed, reason, blocking };
}

export function evaluateSubmissionGuard(input: SubmissionInput): SubmissionGuardResult {
  const checks: CheckResult[] = [];

  checks.push(
    check(
      "user_authorization",
      "User authenticated",
      input.userAuthenticated,
      input.userAuthenticated
        ? "You are signed in."
        : "Sign in before marking submitted.",
    ),
  );

  checks.push(
    check(
      "duplicate_protection",
      "Not already submitted",
      input.snapshots.length === 0,
      input.snapshots.length === 0
        ? "No prior snapshot exists."
        : `${input.snapshots.length} snapshot(s) already frozen. Re-submission creates a duplicate record.`,
      false,
    ),
  );

  const unanswered = input.questions.filter((q) => !input.approvedAnswerIds.has(q.id));
  checks.push(
    check(
      "approved_answers",
      "Approved answers present",
      unanswered.length === 0,
      unanswered.length === 0
        ? "All questions have an approved answer."
        : `${unanswered.length} question(s) have no approved answer: ${unanswered.map((q) => q.prompt).slice(0, 3).join("; ")}`,
    ),
  );

  checks.push(
    check(
      "documents_present",
      "Documents attached",
      input.attachedDocumentIds.length > 0 || input.questions.length === 0,
      input.attachedDocumentIds.length > 0
        ? `${input.attachedDocumentIds.length} document(s) attached.`
        : "No documents attached. Attach at least a resume.",
      false,
    ),
  );

  checks.push(
    check(
      "resume_selected",
      "Resume selected",
      Boolean(input.resumeMatchRecommended),
      input.resumeMatchRecommended
        ? "A recommended resume has been selected."
        : "No resume recommendation found. Run Fit Index analysis first.",
      false,
    ),
  );

  const unresolvedReview = input.reviewItems.filter((item) => !item.resolved);
  checks.push(
    check(
      "unresolved_info",
      "No unresolved required information",
      unresolvedReview.length === 0,
      unresolvedReview.length === 0
        ? "All review items are resolved."
        : `${unresolvedReview.length} review item(s) still open: ${unresolvedReview.map((r) => r.prompt).slice(0, 2).join("; ")}`,
      false,
    ),
  );

  const unsupportedClaims = input.eligibilityResults.filter(
    (e) => e.state === "not_met" || e.state === "not_evaluated",
  );
  checks.push(
    check(
      "unsupported_claims",
      "No unsupported claims",
      unsupportedClaims.length === 0,
      unsupportedClaims.length === 0
        ? "All eligibility requirements are met or partially met."
        : `${unsupportedClaims.length} requirement(s) not met or not evaluated.`,
      false,
    ),
  );

  checks.push(
    check(
      "required_fields",
      "Required fields complete",
      input.questions.length > 0 ? unanswered.length === 0 : true,
      input.questions.length === 0
        ? "No questions to answer."
        : unanswered.length === 0
          ? "All required fields are complete."
          : `${unanswered.length} required question(s) remain.`,
    ),
  );

  checks.push(
    check(
      "captcha_status",
      "CAPTCHA resolved",
      !input.hasCaptcha,
      input.hasCaptcha
        ? "CAPTCHA detected. Human action required — 1-Apply never bypasses CAPTCHA."
        : "No CAPTCHA blocking submission.",
    ),
  );

  checks.push(
    check(
      "signature_status",
      "Signature not required by extension",
      !input.hasSignatureField,
      input.hasSignatureField
        ? "Signature field detected. Sign manually — 1-Apply never signs for you."
        : "No signature field detected.",
      input.hasSignatureField,
    ),
  );

  checks.push(
    check(
      "payment_status",
      "No payment required",
      !input.hasPaymentField,
      input.hasPaymentField
        ? "Payment field detected. Pay manually — 1-Apply never handles payments."
        : "No payment field detected.",
      input.hasPaymentField,
    ),
  );

  checks.push(
    check(
      "security_challenge",
      "No security challenge pending",
      !input.hasSecurityChallenge,
      input.hasSecurityChallenge
        ? "Security challenge detected. Complete it manually."
        : "No security challenge detected.",
      input.hasSecurityChallenge,
    ),
  );

  checks.push(
    check(
      "document_versions",
      "Correct document versions",
      input.attachedDocumentIds.length > 0 || input.questions.length === 0,
      input.attachedDocumentIds.length > 0
        ? "Document versions are pinned."
        : "Attach exact document versions before submission.",
      false,
    ),
  );

  const blockers = checks.filter((c) => !c.passed && c.blocking);
  const warnings = checks.filter((c) => !c.passed && !c.blocking);
  const safe = blockers.length === 0;

  const idempotencyKey = [
    input.applicationId,
    [...input.approvedAnswerIds.values()].sort().join(","),
    input.attachedDocumentIds.sort().join(","),
    input.resumeMatchRecommended ?? "",
    input.snapshots.length.toString(),
  ].join("|");

  return { safe, checks, blockers, warnings, idempotencyKey };
}
