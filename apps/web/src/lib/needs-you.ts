import { looksLikeYesNoChoiceQuestion } from "@/lib/needs-you-field-kinds";

export type NeedsYouKind =
  | "missing_fact"
  | "answer"
  | "document"
  | "field_mapping"
  | "eligibility"
  | "review"
  | "deadline";

export type NeedsYouInputType =
  | "text"
  | "textarea"
  | "date"
  | "datetime"
  | "select"
  | "multi-select"
  | "document"
  | "image"
  | "number"
  | "url"
  | "email"
  | "tel";

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
  inputType: NeedsYouInputType;
  /** Required / blocking items sort above optional ones */
  required: boolean;
  options?: string[];
  payload: {
    questionId?: string;
    answerId?: string | null;
    mappingId?: string;
    reviewItemId?: string;
    eligibilityId?: string;
    requirementId?: string | null;
    requiredLabel?: string;
    factKey?: string;
    profileField?: ProfileMemoryField | null;
    uploadKind?: "document" | "image";
    /** Eligibility problem the applicant must address by editing this answer */
    eligibilityIssue?: string | null;
    eligibilityRequirement?: string | null;
    /** Offer hard-delete of the application when eligibility cannot be met */
    allowDeleteApplication?: boolean;
    /** Show "Yes, I am eligible" when there is no editable field for this blocker */
    confirmEligible?: boolean;
    currentValue?: string | null;
    /** Document / resume Need You state */
    documentStatus?: "unavailable" | "not_best_fit" | "attach";
    recommendedDocumentId?: string | null;
    recommendedDocumentLabel?: string | null;
    fitScore?: number | null;
    fitSuggestion?: string | null;
    /** Suggested IANA timezone when asking for a deadline */
    timezone?: string | null;
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
  { field: "date_of_birth", pattern: /date of birth|birth\s*date|\bdob\b|birthday|\bage\b/i },
  {
    field: "phone",
    pattern: /phone|mobile|whatsapp|telephone|cell\b|contact\s*(no\.?|number|#|num)?/i,
  },
  { field: "display_name", pattern: /\b(full )?name\b|legal name/i },
  {
    field: "location_city",
    pattern: /\bcity\b|location|address|reside|residence|\bplace\b|where do you live/i,
  },
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

/**
 * Short structured form fields (name, email, phone, …) belong in Application Memory /
 * field_mappings — not as essay opportunity_questions / Need You “Answer” cards.
 */
export function isStructuredFormFieldPrompt(label: string): boolean {
  const text = label.trim();
  if (!text || text.length > 120) return false;
  if (detectProfileMemoryField(text)) return true;
  // Open-ended essay cues — never treat as structured contact fields.
  if (
    /\b(tell us|describe|explain|why do you|what motivates|essay|cover letter|motivation|write about|in your own words)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  return /^(full\s*)?name$|first\s*name|last\s*name|surname|family\s*name|email|e-?mail|phone|mobile|whatsapp|telephone|contact\s*(no\.?|number|#)?|address|city|country|state|province|zip|postal|linkedin|github|portfolio|website(\s*url)?|\bdob\b|date\s*of\s*birth|gender|nationality|university|college|school|campus|institution|cgpa|gpa|year\s*of\s*study|graduation\s*year/i.test(
    text,
  );
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

/** Need You applicant-facing queue items (including eligibility blockers to edit or abandon). */
export function isNeedsYouApplicantQuestion(kind: NeedsYouKind): boolean {
  return (
    kind === "field_mapping" ||
    kind === "missing_fact" ||
    kind === "answer" ||
    kind === "document" ||
    kind === "eligibility" ||
    kind === "deadline"
  );
}

export function needsYouInputType(label: string, kind: NeedsYouKind): NeedsYouInputType {
  if (kind === "document") return "document";
  if (kind === "deadline") return "datetime";
  // Yes/No host radios must stay select — including eligibility cards.
  if (looksLikeYesNoChoiceQuestion(label)) return "select";
  const profile = detectProfileMemoryField(label);
  if (profile === "date_of_birth") return "date";
  if (profile === "phone") return "tel";
  if (profile === "linkedin_url" || profile === "github_url" || profile === "portfolio_url") return "url";
  if (profile) return "text";
  if (kind === "eligibility") {
    // Open eligibility prompts (share links / examples) are free-text, not selects.
    return label.length > 60 || /\b(share|describe|explain|links?|examples?)\b/i.test(label)
      ? "textarea"
      : "text";
  }
  if (kind === "answer") return "textarea";
  if (kind === "review" || kind === "missing_fact") return "textarea";
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
    case "deadline":
      return "Deadline";
  }
}

/**
 * Lower rank = higher priority in Need You.
 * Eligibility + missing deadline first; optional items last.
 */
export function needsYouItemSortRank(item: Pick<NeedsYouItem, "kind" | "inputType" | "required">): number {
  const optionalBoost = item.required === false ? 100 : 0;
  let kindRank = 40;
  if (item.kind === "eligibility") kindRank = 0;
  else if (item.kind === "deadline") kindRank = 1;
  else if (item.kind === "document" || item.inputType === "document" || item.inputType === "image") kindRank = 10;
  else if (item.kind === "answer") kindRank = 20;
  else if (item.kind === "field_mapping") kindRank = 25;
  else if (item.kind === "missing_fact") kindRank = 30;
  else if (item.kind === "review") kindRank = 35;
  return optionalBoost + kindRank;
}

export function compareNeedsYouItems(a: NeedsYouItem, b: NeedsYouItem): number {
  const rank = needsYouItemSortRank(a) - needsYouItemSortRank(b);
  if (rank !== 0) return rank;
  return a.title.localeCompare(b.title);
}

/** Normalize question text so the same form prompt collapses across Need You kinds. */
export function normalizeNeedsYouDedupeKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\*+/g, " ")
    .replace(/\b(required|mandatory|optional|obligatoriskt|pflichtfeld)\b/gi, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/**
 * Prefer the most actionable card when the same question appears twice
 * (e.g. opportunity answer + host field_mapping).
 * Lower = keep.
 */
export function needsYouDedupeKeepRank(item: Pick<NeedsYouItem, "kind" | "inputType" | "payload">): number {
  if (item.kind === "eligibility") return 0;
  if (item.kind === "deadline") return 1;
  if (item.kind === "document" || item.inputType === "document" || item.inputType === "image") {
    return item.payload.mappingId ? 2 : 3;
  }
  if (item.kind === "field_mapping") return 4;
  if (item.kind === "answer") return 5;
  if (item.kind === "missing_fact") return 6;
  if (item.kind === "review") return 7;
  return 8;
}

function needsYouPayloadRichness(item: Pick<NeedsYouItem, "payload">): number {
  const p = item.payload;
  return (
    Number(Boolean(p.mappingId)) * 4 +
    Number(Boolean(p.questionId)) * 2 +
    Number(Boolean(p.profileField)) +
    Number(Boolean(p.eligibilityId)) * 3 +
    Number(Boolean(p.recommendedDocumentId))
  );
}

/**
 * One card per application + normalized question title.
 * Merges cross-kind duplicates (answer vs field_mapping, document vs file mapping, …).
 */
export function dedupeNeedsYouItems(items: NeedsYouItem[]): NeedsYouItem[] {
  const bestByKey = new Map<string, NeedsYouItem>();

  for (const item of items) {
    if (!isNeedsYouApplicantQuestion(item.kind)) continue;
    const titleKey = normalizeNeedsYouDedupeKey(item.title);
    if (!titleKey) continue;
    const key = `${item.applicationId}:${titleKey}`;
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, item);
      continue;
    }

    const rankDelta = needsYouDedupeKeepRank(item) - needsYouDedupeKeepRank(existing);
    if (rankDelta < 0) {
      // Prefer keeping actionable form wiring when swapping to a higher-priority kind.
      bestByKey.set(key, {
        ...item,
        payload: {
          ...existing.payload,
          ...item.payload,
          mappingId: item.payload.mappingId ?? existing.payload.mappingId,
          questionId: item.payload.questionId ?? existing.payload.questionId,
          answerId: item.payload.answerId ?? existing.payload.answerId,
          profileField: item.payload.profileField ?? existing.payload.profileField,
        },
      });
      continue;
    }
    if (rankDelta > 0) {
      // Keep existing, but absorb useful ids from the duplicate.
      existing.payload = {
        ...item.payload,
        ...existing.payload,
        mappingId: existing.payload.mappingId ?? item.payload.mappingId,
        questionId: existing.payload.questionId ?? item.payload.questionId,
        answerId: existing.payload.answerId ?? item.payload.answerId,
        profileField: existing.payload.profileField ?? item.payload.profileField,
      };
      continue;
    }

    if (needsYouPayloadRichness(item) > needsYouPayloadRichness(existing)) {
      bestByKey.set(key, {
        ...item,
        payload: {
          ...existing.payload,
          ...item.payload,
          mappingId: item.payload.mappingId ?? existing.payload.mappingId,
          questionId: item.payload.questionId ?? existing.payload.questionId,
          answerId: item.payload.answerId ?? existing.payload.answerId,
          profileField: item.payload.profileField ?? existing.payload.profileField,
        },
      });
    } else {
      existing.payload = {
        ...item.payload,
        ...existing.payload,
        mappingId: existing.payload.mappingId ?? item.payload.mappingId,
        questionId: existing.payload.questionId ?? item.payload.questionId,
        answerId: existing.payload.answerId ?? item.payload.answerId,
        profileField: existing.payload.profileField ?? item.payload.profileField,
      };
    }
  }

  return [...bestByKey.values()];
}
