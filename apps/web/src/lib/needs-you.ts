export type NeedsYouKind =
  | "missing_fact"
  | "answer"
  | "document"
  | "field_mapping"
  | "eligibility"
  | "review";

export type NeedsYouItem = {
  id: string;
  kind: NeedsYouKind;
  applicationId: string;
  applicationHref: string;
  company: string;
  role: string;
  title: string;
  detail: string | null;
  /** Short label for the form control */
  inputLabel: string;
  /** Suggested input type for the resolve form */
  inputType: "text" | "textarea" | "date" | "select" | "document";
  options?: string[];
  payload: {
    questionId?: string;
    answerId?: string | null;
    mappingId?: string;
    reviewItemId?: string;
    eligibilityId?: string;
    requiredLabel?: string;
    factKey?: string;
    profileField?: ProfileMemoryField | null;
  };
};

export type ProfileMemoryField =
  | "display_name"
  | "phone"
  | "location_city"
  | "location_country"
  | "work_authorization"
  | "linkedin_url"
  | "github_url"
  | "portfolio_url"
  | "date_of_birth";

const PROFILE_PATTERNS: Array<{ field: ProfileMemoryField; pattern: RegExp }> = [
  { field: "date_of_birth", pattern: /date of birth|birth\s*date|\bdob\b|birthday/i },
  { field: "phone", pattern: /phone|mobile|whatsapp|telephone|cell\b/i },
  { field: "display_name", pattern: /\b(full )?name\b|legal name/i },
  { field: "location_city", pattern: /\bcity\b|location|address|reside/i },
  { field: "location_country", pattern: /\bcountry\b|nation/i },
  { field: "work_authorization", pattern: /work.?authorization|authorized.?to.?work|visa|citizenship/i },
  { field: "linkedin_url", pattern: /linkedin/i },
  { field: "github_url", pattern: /github/i },
  { field: "portfolio_url", pattern: /portfolio|personal website|website url/i },
];

export function detectProfileMemoryField(label: string): ProfileMemoryField | null {
  for (const entry of PROFILE_PATTERNS) {
    if (entry.pattern.test(label)) return entry.field;
  }
  return null;
}

/** Internal eligibility / analysis copy — not an applicant-facing form question. */
export function isNeedsYouSystemNoise(text: string): boolean {
  const value = text.trim();
  if (!value) return true;
  return [
    /no explicit requirements were extracted/i,
    /add them before treating this as a fit check/i,
    /not enough verified (experience|education|evidence)/i,
    /this is not an official eligibility decision/i,
    /requirement:\s*no explicit requirements/i,
    /^kind:\s*eligibility$/i,
    // Fit Index / eligibility empty-corpus diagnostics — shown on Fit panel, not as Needs You forms.
    /no verified .+ in application memory/i,
    /limited verified /i,
    /no verified .+ (are|is) available/i,
    /no verified evidence (found|is available|was available|matched)/i,
  ].some((pattern) => pattern.test(value));
}

/** Need You is for scraped form questions only — not workspace review/eligibility rows. */
export function isNeedsYouApplicantQuestion(kind: NeedsYouKind): boolean {
  return kind === "field_mapping" || kind === "missing_fact" || kind === "answer" || kind === "document";
}

export function needsYouInputType(label: string, kind: NeedsYouKind): NeedsYouItem["inputType"] {
  if (kind === "document") return "document";
  if (kind === "answer") return "textarea";
  if (detectProfileMemoryField(label) === "date_of_birth") return "date";
  if (kind === "eligibility" || kind === "review" || kind === "missing_fact") return "textarea";
  return "text";
}

export function needsYouKindLabel(kind: NeedsYouKind): string {
  switch (kind) {
    case "missing_fact":
      return "Missing fact";
    case "answer":
      return "Answer";
    case "document":
      return "Document";
    case "field_mapping":
      return "Form field";
    case "eligibility":
      return "Eligibility";
    case "review":
      return "Review";
  }
}
