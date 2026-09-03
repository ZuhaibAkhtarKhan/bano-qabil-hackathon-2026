import { deriveYearOfStudy, extractYearsFromText, formatIdentityNumberForField, toHtmlDateValue } from "./format-value";
import { humanQuestionLabel } from "./question-label";
import { isProtectedControl, isSensitiveField } from "./safety";
import type { DetectedField, FieldMapping, FieldMappingOption, MemoryValue } from "./types";

type Rule = {
  path: string;
  aliases: string[];
  minConfidence: number;
};

const RULES: Rule[] = [
  { path: "Education → Institution", aliases: ["university", "college", "school", "institution", "campus", "uni", "varsity"], minConfidence: 0.7 },
  { path: "Education → Degree", aliases: ["degree", "qualification"], minConfidence: 0.8 },
  {
    path: "Education → Course",
    aliases: ["course", "major", "minor", "programme", "program", "field of study", "program of study"],
    minConfidence: 0.72,
  },
  { path: "Education → Graduation year", aliases: ["graduation", "grad year", "class of", "year of graduation", "expected graduation"], minConfidence: 0.8 },
  {
    path: "Education → Year of study",
    aliases: [
      "year of study",
      "year in university",
      "year in college",
      "current year",
      "academic year",
      "class standing",
      "student year",
      "what year",
      "which year",
      "freshman",
      "sophomore",
      "junior",
      "senior",
      "year",
    ],
    minConfidence: 0.7,
  },
  { path: "Education → GPA", aliases: ["gpa", "grade point"], minConfidence: 0.9 },
  { path: "Profile → GitHub", aliases: ["github", "git hub"], minConfidence: 0.95 },
  { path: "Profile → LinkedIn", aliases: ["linkedin", "linked in", "linkedin url", "linkedin profile"], minConfidence: 0.9 },
  {
    path: "Profile → Portfolio",
    aliases: [
      "portfolio",
      "personal website",
      "website",
      "writing sample",
      "editing sample",
      "work sample",
      "published piece",
      "drive link",
      "sample link",
      "link to a",
      "prior work",
      "portfolio url",
      "personal site",
    ],
    minConfidence: 0.62,
  },
  {
    path: "Profile → Full name",
    aliases: [
      "name",
      "full name",
      "legal name",
      "applicant name",
      "your name",
      "full legal name",
      "candidate name",
      "student name",
      "participant name",
    ],
    minConfidence: 0.88,
  },
  { path: "Profile → First name", aliases: ["first name", "given name", "forename"], minConfidence: 0.9 },
  { path: "Profile → Last name", aliases: ["last name", "surname", "family name"], minConfidence: 0.9 },
  {
    path: "Profile → Email",
    aliases: ["email", "e-mail", "email address", "your email", "contact email"],
    minConfidence: 0.92,
  },
  {
    path: "Profile → Phone",
    aliases: [
      "phone",
      "mobile",
      "telephone",
      "whatsapp",
      "whats app",
      "cell",
      "contact number",
      "contact no",
      "contact no.",
      "contact",
    ],
    minConfidence: 0.75,
  },
  {
    path: "Profile → CNIC",
    aliases: ["cnic", "nic", "national identity", "identity card", "nadra"],
    minConfidence: 0.85,
  },
  {
    path: "Profile → Location",
    aliases: [
      "city",
      "location",
      "address",
      "country",
      "state",
      "state/ut",
      "delhi-ncr",
      "delhi ncr",
      "province",
      "region",
      "place",
      "residence",
      "current address",
      "home address",
      "mailing address",
      "your address",
      "street address",
      "current location",
      "city state",
    ],
    minConfidence: 0.65,
  },
  {
    path: "Documents → Resume",
    aliases: ["resume", "cv", "cv or resume", "curriculum vitae", "upload resume", "attach resume", "resume file", "resume (pdf)"],
    minConfidence: 0.65,
  },
  {
    path: "Documents → Cover letter",
    aliases: ["cover letter", "covering letter", "motivation letter", "upload cover"],
    minConfidence: 0.7,
  },
  {
    path: "Documents → Transcript",
    aliases: ["transcript", "academic record", "marksheet"],
    minConfidence: 0.75,
  },
  {
    path: "Documents → Supporting",
    aliases: ["supporting document", "attachment", "upload file", "choose file", "browse"],
    minConfidence: 0.65,
  },
  {
    path: "Approved Application Answer",
    aliases: [
      "why are you interested",
      "why do you want",
      "why do you wanna",
      "why join",
      "motivation",
      "personal statement",
      "tell us about yourself",
      "why our company",
      "why this role",
      "what interests you",
    ],
    minConfidence: 0.72,
  },
];

const AI_ANSWERABLE =
  /\b(why|how|describe|explain|tell us|essay|statement|motivation|interest|passion|strength|weakness|goal|aspiration|what makes|what excites|cover letter|personal statement|anything else|additional information|comments|scenario|situation|handle it|would you|in your opinion|reflect|missed|consecutive|challenge|conflict|leadership|rewrite|respond|review|passage|practical exercise|if yes|then explain|prior .+ experience)\b/i;

const STRUCTURED_MEMORY =
  /\b(phone|whatsapp|mobile|telephone|cnic|nic\b|college|university|campus|course|major|minor|programme|gpa|github|linkedin|email|e-mail|graduation|year of study|class standing|state\/ut|portfolio)\b/i;

const LINK_FIELD =
  /\b(link|url|website|portfolio|linkedin|github|drive|sample|published|personal site)\b/i;


function confidenceFor(signals: string, aliases: string[]): number {
  let best = 0;
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exact = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(signals);
    if (exact) {
      best = Math.max(best, 0.99);
      continue;
    }
    // Avoid short substrings matching inside unrelated words (e.g. "ut" in "without").
    if (alias.length >= 5 && signals.includes(alias)) {
      best = Math.max(best, 0.72);
    }
  }
  return best;
}

function toOptions(items: MemoryValue[]): FieldMappingOption[] {
  const seen = new Set<string>();
  const options: FieldMappingOption[] = [];
  for (const item of items) {
    const value = item.value.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: item.path, source: item.source });
  }
  return options;
}

function memoriesForPath(path: string, aliases: string[], catalog: MemoryValue[]): MemoryValue[] {
  return catalog.filter(
    (item) =>
      item.path === path ||
      item.aliases.some((alias) => aliases.includes(alias)) ||
      aliases.some((alias) => item.path.toLowerCase().includes(alias)),
  );
}

function narrativeMemories(catalog: MemoryValue[]): MemoryValue[] {
  return catalog.filter(
    (item) =>
      item.path.startsWith("Approved Application Answer") ||
      item.path.startsWith("Answer →") ||
      item.path.startsWith("Evidence →") ||
      item.path === "Profile → Headline",
  );
}

export function isAiAnswerableField(field: DetectedField): boolean {
  if (
    field.type === "file" ||
    field.type === "radio" ||
    field.type === "checkbox" ||
    field.type === "select" ||
    field.type === "multi-select" ||
    field.type === "date" ||
    field.type === "number"
  ) {
    return false;
  }
  if (isProtectedControl(field) || isSensitiveField(field)) return false;
  const signals = field.signals || `${field.label} ${field.placeholder} ${field.ariaLabel} ${field.nearbyText}`;
  // Structured memory fields are never open-ended AI drafts (even if the label says "write …").
  if (STRUCTURED_MEMORY.test(signals) && !/\b(why|describe|explain|if yes|then explain|tell us)\b/i.test(signals)) return false;
  if (LINK_FIELD.test(signals) && !/\b(why|describe|explain|tell us)\b/i.test(signals)) return false;
  if (field.type === "textarea") return true;
  if (AI_ANSWERABLE.test(signals)) return true;
  // Host-custom short answers (Google Forms / ATS) with a real prompt — not identity fields.
  const prompt = `${field.label} ${field.nearbyText}`.trim();
  if (
    (field.type === "text" || field.type === "url") &&
    prompt.length >= 18 &&
    /\?|please |describe|explain|tell |why |how |share |write |discuss |reflect |anything|additional|comment|note to|cover letter|motivation|interest/i.test(
      prompt,
    )
  ) {
    return true;
  }
  return false;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function extractYears(value: string): number[] {
  return extractYearsFromText(value);
}

const STANDING_GROUPS: Array<{ labels: string[]; match: RegExp }> = [
  {
    labels: ["freshman", "first year", "1st year", "1st", "year 1", "year one", "1"],
    match: /\bfreshman\b|\bfirst year\b|\b1st(?:\s*year)?\b|\byear 1\b|\byear one\b/,
  },
  {
    labels: ["sophomore", "second year", "2nd year", "2nd", "year 2", "year two", "2"],
    match: /\bsophomore\b|\bsecond year\b|\b2nd(?:\s*year)?\b|\byear 2\b|\byear two\b/,
  },
  {
    labels: ["junior", "third year", "3rd year", "3rd", "year 3", "year three", "3"],
    match: /\bjunior\b|\bthird year\b|\b3rd(?:\s*year)?\b|\byear 3\b|\byear three\b/,
  },
  {
    labels: ["senior", "fourth year", "4th year", "4th", "year 4", "year four", "final year", "4"],
    match: /\bsenior\b|\bfourth year\b|\b4th(?:\s*year)?\b|\byear 4\b|\byear four\b|\bfinal year\b/,
  },
  {
    labels: ["5th", "5th year", "fifth year", "year 5", "5"],
    match: /\b5th(?:\s*year)?\b|\bfifth year\b|\byear 5\b/,
  },
  {
    labels: ["graduate", "graduated", "post graduated", "postgraduate", "masters", "master's", "phd", "doctoral"],
    match: /\bgraduate[ds]?\b|\bpost\s*graduat|\bmaster'?s?\b|\bpostgraduate\b|\bphd\b|\bdoctoral\b/,
  },
  { labels: ["high school", "secondary", "grade 12", "a levels"], match: /\bhigh school\b|\bsecondary\b|\bgrade 12\b|\ba levels?\b/ },
];

function expandStandingAliases(value: string): string[] {
  const n = normalize(value);
  const out = new Set<string>([n]);
  for (const group of STANDING_GROUPS) {
    const hitsGroup =
      group.match.test(n) ||
      group.labels.some((label) => {
        const normalized = normalize(label);
        if (!normalized) return false;
        // Avoid "1" matching inside "2025" — only exact for short tokens.
        if (normalized.length <= 2) return n === normalized;
        return n === normalized || n.includes(normalized);
      });
    if (hitsGroup) {
      for (const label of group.labels) out.add(normalize(label));
    }
  }
  return [...out];
}

function choiceScore(choice: string, memoryValue: string): number {
  const a = normalize(choice);
  const b = normalize(memoryValue);
  if (!a || !b) return 0;
  // Never treat bare Yes/No tokens as reusable kit answers — they contaminate every radio.
  if (/^(yes|y|no|n)$/.test(a) || /^(yes|y|no|n)$/.test(b)) return 0;
  if (a === b) return 1;
  // Tiny tokens ("2", "3") must not match inside years like "2024".
  if (Math.min(a.length, b.length) <= 2) return 0;
  if (a.includes(b) || b.includes(a)) return 0.92;
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = b.split(" ").filter(Boolean);
  if (!bTokens.length) return 0;
  const hit = bTokens.filter((token) => aTokens.has(token)).length;
  return hit / Math.max(aTokens.size, bTokens.length);
}

/** Score a form option against one memory value, including year/standing synonyms. */
export function memoryChoiceScore(choice: string, memory: MemoryValue, question = ""): number {
  let best = Math.max(choiceScore(choice, memory.value), choiceScore(choice, memory.path));

  const choiceAliases = expandStandingAliases(choice);
  const memoryAliases = expandStandingAliases(memory.value);
  for (const left of choiceAliases) {
    for (const right of memoryAliases) {
      if (left === right) best = Math.max(best, 1);
      else if (left.length > 2 && right.length > 2) best = Math.max(best, choiceScore(left, right));
    }
  }

  const choiceYears = extractYears(choice);
  const memoryYears = extractYears(`${memory.value} ${memory.path}`);
  if (choiceYears.some((year) => memoryYears.includes(year))) best = Math.max(best, 0.98);

  const derived = deriveYearOfStudy(memoryYears);
  if (derived) {
    for (const left of choiceAliases) {
      for (const right of expandStandingAliases(derived)) {
        if (left === right) best = Math.max(best, 0.97);
      }
    }
  }

  best = Math.max(best, locationChoiceBoost(choice, memory.value), locationChoiceBoost(choice, memory.path));

  const q = question.toLowerCase();
  const educationQuestion = /\b(year|standing|class of|graduat|degree|university|college|student|freshman|sophomore|junior|senior|enrolled|major|gpa|state|delhi)\b/.test(
    q,
  );
  if (educationQuestion && /education|year|graduat|degree|student|university|college|location|delhi|city|state/i.test(`${memory.path} ${memory.value}`)) {
    best = Math.min(1, best + 0.08);
  }

  return best;
}

function standingMemoriesFromCatalog(catalog: MemoryValue[]): MemoryValue[] {
  const extras: MemoryValue[] = [];
  const seen = new Set<string>();
  for (const mem of catalog) {
    const years = extractYears(mem.value);
    if (years.length < 2 && !/education|university|college|school|graduat|student|giki|degree|batch/i.test(`${mem.path} ${mem.value}`)) {
      continue;
    }
    if (years.length < 1) continue;
    const derived = deriveYearOfStudy(years);
    if (!derived || seen.has(derived)) continue;
    seen.add(derived);
    extras.push({
      path: "Education → Year of study",
      source: mem.source,
      value: derived,
      aliases: ["year", "year of study", "class standing", "1st", "2nd", "3rd", "4th"],
    });
  }
  return extras;
}

function looksLikeUrl(value: string): boolean {
  return /https?:\/\/|www\.|linkedin\.com|github\.com|drive\.google/i.test(value);
}

function linkMemories(catalog: MemoryValue[]): MemoryValue[] {
  const preferred = [
    ...memoriesForPath("Profile → Portfolio", ["portfolio", "website", "sample"], catalog),
    ...memoriesForPath("Profile → LinkedIn", ["linkedin"], catalog),
    ...memoriesForPath("Profile → GitHub", ["github"], catalog),
  ];
  const extras = catalog.filter((item) => looksLikeUrl(item.value) && !preferred.some((p) => p.value === item.value));
  return [...preferred, ...extras];
}

function isLinkStyleField(signals: string): boolean {
  // Dedicated profile URL questions stay on their own rules (GitHub / LinkedIn / Portfolio).
  if (/\b(github|git hub|linkedin|linked in)\b/i.test(signals) && !/\b(sample|writing|editing|prior work|drive)\b/i.test(signals)) {
    return false;
  }
  return (
    /\b(writing sample|editing sample|work sample|published piece|drive link|sample link|link to a|prior work|portfolio)\b/i.test(signals) ||
    (/\blink\b/i.test(signals) && !/\b(github|linkedin)\b/i.test(signals))
  );
}

/** Score catalog values against the question text so every field consults memory. */
function rankCatalogAgainstField(field: DetectedField, catalog: MemoryValue[]): Array<{ mem: MemoryValue; score: number }> {
  const signals = normalize(`${field.label} ${field.nearbyText} ${field.ariaLabel} ${field.placeholder}`);
  const ranked: Array<{ mem: MemoryValue; score: number }> = [];
  for (const mem of catalog) {
    let score = Math.max(choiceScore(signals, normalize(mem.path)), choiceScore(signals, normalize(mem.value)));
    for (const alias of mem.aliases) {
      if (signals.includes(normalize(alias))) score = Math.max(score, 0.7);
    }
    // Education fields: boost institution-like short values.
    if (/\b(college|university|school|campus|institution)\b/.test(signals)) {
      if (/education|university|college|school|giki|institution/i.test(`${mem.path} ${mem.value}`)) {
        score = Math.max(score, mem.value.trim().length <= 64 ? 0.82 : 0.55);
      }
    }
    if (/\b(course|major|programme|program)\b/.test(signals) && /education|course|degree|major|bachelor|computer|engineering/i.test(`${mem.path} ${mem.value}`)) {
      score = Math.max(score, 0.7);
    }
    if (isLinkStyleField(signals) && looksLikeUrl(mem.value)) {
      score = Math.max(score, /linkedin/i.test(signals) && /linkedin/i.test(mem.value) ? 0.98 : 0.8);
    }
    if (score >= 0.35) ranked.push({ mem, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

function locationChoiceBoost(choice: string, memoryValue: string): number {
  const c = normalize(choice);
  const m = normalize(memoryValue);
  if (!c || !m) return 0;
  // Never let bare Yes/No leak through location substring boost
  // ("no" inside "technology" / "innovation" was auto-filling radios at 0.9).
  if (/^(yes|y|no|n)$/.test(c) || /^(yes|y|no|n)$/.test(m)) return 0;
  if (c.length <= 2 || m.length <= 2) return 0;
  if (c.includes("delhi") && m.includes("delhi")) return 0.96;
  if ((c.includes("delhi ncr") || c === "delhi") && (m.includes("delhi") || m.includes("ncr"))) return 0.98;
  if (c.includes(m) || m.includes(c)) return 0.9;
  return 0;
}

function formatProposedValue(path: string, value: string, signals: string): string {
  if (!value) return value;
  if (path === "Profile → Phone" || path === "Profile → CNIC" || /\b(phone|whatsapp|mobile|cnic|telephone)\b/i.test(signals)) {
    return formatIdentityNumberForField(value, signals);
  }
  // Institution: prefer short school name when memory stored a long blob.
  if (path === "Education → Institution") {
    const org = value
      .split(/\s*[—\-|,:]\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    const named = org.find(
      (part) =>
        /university|college|institute|school|academy|giki|nust|lums|fast/i.test(part) ||
        (part.length <= 48 && /[a-z]/i.test(part) && !/^\d{4}/.test(part) && !/^(education|employment)$/i.test(part)),
    );
    if (named && named.length < value.length) return named;
  }
  if (path === "Education → Course") {
    const parts = value
      .split(/\s*[—\-|,:]\s*/)
      .map((part) => part.trim())
      .filter((part) => part && !/^(education|giki|\d{4})$/i.test(part));
    const course = parts.find((part) => /bachelor|master|b\.?s|b\.?a|computer|engineering|science|programme|major/i.test(part));
    if (course) return course;
  }
  return value;
}

function isYesNoField(field: DetectedField): boolean {
  if (field.type !== "radio" && field.type !== "select") return false;
  if (field.options.length !== 2) return false;
  const normalized = field.options.map((item) => normalize(item));
  const hasYes = normalized.some((item) => /^(yes|y)$/.test(item));
  const hasNo = normalized.some((item) => /^(no|n)$/.test(item));
  return hasYes && hasNo;
}

/** Degree / years eligibility — may be inferred from kit education & experience. */
function isEligibilityStyleQuestion(text: string): boolean {
  return /\b(do you (have|possess|hold)|have you|bachelor|master|degree|years?.{0,40}experience|qualified|eligible|minimum|related field|or equivalent)\b/i.test(
    text,
  );
}

/**
 * Commitment / availability / current-status Yes/No — must not be filled by lexical
 * kit matches or weak "No" heuristics. LLM may decide only with clear evidence.
 */
export function isJudgmentYesNoQuestion(text: string): boolean {
  return /\b(can you|will you|would you|are you able|are you currently|are you a|are you an|commit|committed|available|availability|part[- ]?time|full[- ]?time|hours?\s+(a|per)\s+day|willing to|currently (a |an )?(university )?student|enrolled|consistently)\b/i.test(
    text,
  );
}

/** True when a form label is a Yes/No judgment question (commitment / status), not a profile fact. */
export function shouldDeferYesNoToUserOrLlm(text: string): boolean {
  return isJudgmentYesNoQuestion(text);
}

function findYesNoLabels(field: DetectedField): { yes: string; no: string } | null {
  const yes = field.options.find((item) => /^(yes|y)$/i.test(item.trim()));
  const no = field.options.find((item) => /^(no|n)$/i.test(item.trim()));
  if (!yes || !no) return null;
  return { yes, no };
}

function yearsRequired(question: string): number | null {
  const match = question.match(/(\d+)\s*\+?\s*years?/i);
  return match ? Number(match[1]) : null;
}

function yearsFromCatalog(catalog: MemoryValue[]): number {
  let max = 0;
  const blob = catalog.map((item) => `${item.path} ${item.value}`).join("\n");
  for (const match of blob.matchAll(/(\d+)\s*\+?\s*years?/gi)) {
    max = Math.max(max, Number(match[1]));
  }
  const years = [...blob.matchAll(/\b(19|20)\d{2}\b/g)].map((item) => Number(item[0]));
  if (years.length >= 2) {
    const span = Math.max(...years) - Math.min(...years);
    if (span > 0 && span <= 50) max = Math.max(max, span);
  }
  return max;
}

function degreeSignals(question: string, catalogBlob: string): { needed: boolean; matched: boolean } {
  const needed = /\b(bachelor|undergraduate|b\.?\s?s\.?|b\.?\s?a\.?|master|m\.?\s?s\.?|phd|doctorate|degree)\b/i.test(question);
  if (!needed) return { needed: false, matched: false };
  return {
    needed: true,
    matched:
      /\b(bachelor|undergraduate|bsc|b\.s|b\.a|degree in|bachelor of|master|msc|phd|education)\b/i.test(catalogBlob) ||
      /education →/i.test(catalogBlob),
  };
}

function fieldOverlap(question: string, catalogBlob: string): number {
  const fields = question.match(
    /construction|architecture|engineering|project management|computer science|software|data|design|finance|business|biology|physics|mathematics|related/gi,
  );
  if (!fields?.length) return 0.5;
  const hits = fields.filter((token) => catalogBlob.includes(token.toLowerCase())).length;
  return hits / fields.length;
}

/** Infer Yes/No for eligibility-style radios from Application Memory text. */
export function inferYesNoFromMemory(
  question: string,
  catalog: MemoryValue[],
): { answer: "yes" | "no" | null; confidence: number; reason: string; memoryPath: string } {
  if (!catalog.length) {
    return { answer: null, confidence: 0, reason: "No Application Memory available to evaluate this Yes/No question.", memoryPath: "Unmapped" };
  }
  const catalogBlob = catalog.map((item) => `${item.path}: ${item.value}`).join("\n").toLowerCase();
  const requiredYears = yearsRequired(question);
  const haveYears = yearsFromCatalog(catalog);
  const degree = degreeSignals(question, catalogBlob);
  const overlap = fieldOverlap(question, catalogBlob);
  const evidenceHit = catalog.some(
    (item) =>
      item.path.startsWith("Evidence →") ||
      item.path.startsWith("Education →") ||
      /experience|employment|project|degree|bachelor|engineer/i.test(`${item.path} ${item.value}`),
  );

  let score = 0;
  const notes: string[] = [];
  if (degree.needed) {
    if (degree.matched) {
      score += 0.45;
      notes.push("degree/education signal found in memory");
    } else {
      notes.push("required degree not clearly evidenced");
    }
  } else {
    score += 0.2;
  }
  if (requiredYears != null) {
    if (haveYears >= requiredYears) {
      score += 0.45;
      notes.push(`${haveYears}+ years signaled in memory (needs ${requiredYears}+)`);
    } else if (haveYears > 0) {
      score += 0.15;
      notes.push(`only ~${haveYears} years signaled (needs ${requiredYears}+)`);
    } else if (/equivalent experience/i.test(question) && evidenceHit) {
      score += 0.25;
      notes.push("equivalent experience clause; related evidence present");
    } else {
      notes.push(`years requirement (${requiredYears}+) not evidenced`);
    }
  } else if (evidenceHit) {
    score += 0.25;
  }
  score += Math.min(0.2, overlap * 0.2);

  if (score >= 0.7) {
    return {
      answer: "yes",
      confidence: Math.min(0.92, score),
      reason: `Application Memory supports Yes (${notes.join("; ")}). Review before submit.`,
      memoryPath: "Eligibility → Memory match",
    };
  }
  if (score <= 0.25 && (degree.needed || requiredYears != null)) {
    return {
      answer: "no",
      confidence: 0.55,
      reason: `Application Memory does not clearly support Yes (${notes.join("; ") || "insufficient evidence"}).`,
      memoryPath: "Eligibility → Memory gap",
    };
  }
  return {
    answer: null,
    confidence: score,
    reason: `Could not decide Yes/No from memory yet (${notes.join("; ") || "weak overlap"}). Pick Yes or No from the chip.`,
    memoryPath: "Eligibility → Needs review",
  };
}

function isVerifiedEmailCollectionCheckbox(field: DetectedField): boolean {
  if (field.type !== "checkbox" || field.options.length > 1) return false;
  const blob = `${field.label} ${field.nearbyText} ${field.ariaLabel} ${field.options.join(" ")}`;
  return /record\s+.+\s+as the email to be included with my response/i.test(blob);
}

function isRequiredSoleCheckbox(field: DetectedField): boolean {
  if (field.type !== "checkbox") return false;
  if (field.options.length > 1) return false;
  // Verified Google Forms email collection is always mandatory when shown.
  if (isVerifiedEmailCollectionCheckbox(field)) return true;
  return field.required;
}

function mapChoiceField(field: DetectedField, catalog: MemoryValue[], sensitive: boolean): FieldMapping | null {
  if (!["select", "radio", "checkbox", "multi-select"].includes(field.type)) return null;

  // Required sole confirmation (privacy, record email, I agree) — auto-check only then.
  if (isRequiredSoleCheckbox(field) && !sensitive) {
    const value = field.options[0]?.trim() || "true";
    return {
      fieldKey: field.key,
      label: humanQuestionLabel(field),
      memoryPath: "Required confirmation",
      source: "Form requirement",
      confidence: 0.99,
      proposedValue: value,
      options: [{ value, label: field.label || "Confirm", source: "Required confirmation" }],
      approvalState: "pending",
      sensitive: false,
      excludedByDefault: false,
      reason: "Required sole checkbox with no other choice — auto-checked.",
      fieldType: "checkbox",
      aiAnswerable: false,
      showChip: true,
    };
  }

  if (!field.options.length) return null;

  const question = `${field.label} ${field.nearbyText} ${field.ariaLabel}`.trim();
  const yesNo = findYesNoLabels(field);

  // Yes/No radios must never fall through to generic option↔kit string matching
  // (any prior kit value "No" would otherwise auto-fill every Yes/No at ~100%).
  if (yesNo && isYesNoField(field) && !sensitive) {
    const judgment = isJudgmentYesNoQuestion(question);
    const eligibility = isEligibilityStyleQuestion(question) && !judgment;

    if (eligibility) {
      const inferred = inferYesNoFromMemory(question, catalog);
      // Only auto-fill confident Yes. Weak/absent evidence → Need You (never guess No).
      const autoYes = inferred.answer === "yes" && inferred.confidence >= 0.75;
      const proposed = autoYes ? yesNo.yes : "";
      return {
        fieldKey: field.key,
        label: humanQuestionLabel(field),
        memoryPath: inferred.memoryPath,
        source: "Application Memory",
        confidence: inferred.confidence,
        proposedValue: proposed,
        options: [
          { value: yesNo.yes, label: "Yes", source: "Form choice" },
          { value: yesNo.no, label: "No", source: "Form choice" },
        ],
        approvalState: "pending",
        sensitive: false,
        excludedByDefault: !proposed,
        reason: proposed
          ? inferred.reason
          : `${inferred.reason} Left for Need You until memory clearly supports Yes, or you choose.`,
        fieldType: field.type,
        aiAnswerable: true,
        showChip: true,
      };
    }

    return {
      fieldKey: field.key,
      label: humanQuestionLabel(field),
      memoryPath: "Needs You",
      source: "Application Memory",
      confidence: 0.2,
      proposedValue: "",
      options: [
        { value: yesNo.yes, label: "Yes", source: "Form choice" },
        { value: yesNo.no, label: "No", source: "Form choice" },
      ],
      approvalState: "pending",
      sensitive: false,
      excludedByDefault: true,
      reason: judgment
        ? "Commitment / status Yes/No — AI may answer only from clear kit evidence; otherwise Needs You."
        : "Yes/No question — not auto-filled from unrelated kit Yes/No answers. Needs You or AI with evidence.",
      fieldType: field.type,
      aiAnswerable: true,
      showChip: true,
    };
  }

  const effectiveCatalog = [...catalog, ...standingMemoriesFromCatalog(catalog)];
  const ranked: Array<{ choice: string; option: FieldMappingOption; score: number }> = [];
  for (const choice of field.options) {
    for (const mem of effectiveCatalog) {
      const score = memoryChoiceScore(choice, mem, question);
      if (score >= 0.42) {
        ranked.push({
          choice,
          option: { value: choice, label: mem.path, source: mem.source },
          score,
        });
      }
    }
  }
  ranked.sort((a, b) => b.score - a.score);

  const bestByChoice = new Map<string, { option: FieldMappingOption; score: number }>();
  for (const item of ranked) {
    const existing = bestByChoice.get(item.choice);
    if (!existing || item.score > existing.score) {
      bestByChoice.set(item.choice, { option: item.option, score: item.score });
    }
  }

  const options: FieldMappingOption[] = [];
  for (const choice of field.options) {
    const hit = bestByChoice.get(choice);
    options.push({
      value: choice,
      label: hit?.option.label ?? (field.label || "Form option"),
      source: hit?.option.source ?? "Form choice",
    });
  }

  const top = ranked[0];
  const proposedValue = top && top.score >= 0.48 ? top.choice : "";
  return {
    fieldKey: field.key,
    label: humanQuestionLabel(field),
    memoryPath: top?.option.label ?? "Application Memory",
    source: top?.option.source ?? "Application Memory",
    confidence: top ? Math.round(top.score * 100) / 100 : 0.25,
    proposedValue,
    options,
    approvalState: sensitive ? "blocked" : "pending",
    sensitive,
    excludedByDefault: sensitive || !proposedValue,
    reason: proposedValue
      ? `Matched “${proposedValue}” from Application Memory (${top?.option.label}).`
      : "Checked Application Memory for every option — no confident match yet. Pick from the chip.",
    fieldType: field.type,
    aiAnswerable: false,
    showChip: true,
  };
}

function blockedMapping(field: DetectedField, reason: string, memoryPath = "Blocked"): FieldMapping {
  return {
    fieldKey: field.key,
    label: humanQuestionLabel(field),
    memoryPath,
    source: "Safety rule",
    confidence: 0,
    proposedValue: "",
    options: [],
    approvalState: "blocked",
    sensitive: true,
    excludedByDefault: true,
    reason,
    fieldType: field.type,
    aiAnswerable: false,
    showChip: false,
  };
}

export function mapField(field: DetectedField, catalog: MemoryValue[]): FieldMapping {
  const signals = field.signals || `${field.label} ${field.name} ${field.id} ${field.placeholder} ${field.ariaLabel} ${field.nearbyText}`.toLowerCase();
  const protectedControl = isProtectedControl(field);
  const sensitive = isSensitiveField(field) || protectedControl;

  if (protectedControl) {
    return blockedMapping(field, "Protected control (CAPTCHA, submit, signature, payment, or password). 1-Apply will not fill it.");
  }

  if (field.type === "file") {
    let bestDoc: { rule: Rule; score: number } | null = null;
    for (const rule of RULES.filter((item) => item.path.startsWith("Documents →"))) {
      const score = confidenceFor(signals, rule.aliases);
      if (score >= rule.minConfidence && (!bestDoc || score > bestDoc.score)) bestDoc = { rule, score };
    }
    const path = bestDoc?.rule.path ?? "Documents → Resume";
    const options = toOptions(memoriesForPath(path, bestDoc?.rule.aliases ?? ["resume", "cv", "file"], catalog));
    // Fall back to any document memory if the specific bucket is empty.
    const fallback = options.length
      ? options
      : toOptions(catalog.filter((item) => item.path.startsWith("Documents →")));
    return {
      fieldKey: field.key,
      label: humanQuestionLabel(field),
      memoryPath: path,
      source: fallback[0]?.source ?? "Documents",
      confidence: bestDoc ? Math.round(bestDoc.score * 100) / 100 : 0.45,
      proposedValue: fallback[0]?.value ?? "",
      options: fallback,
      approvalState: "pending",
      sensitive: false,
      excludedByDefault: fallback.length === 0,
      reason: fallback[0]
        ? `File field mapped to ${path}. The extension can attach the selected document version.`
        : "File field detected, but no resume/cover letter is in your vault yet.",
      fieldType: "file",
      aiAnswerable: false,
      showChip: fallback.length > 1,
      attachment: null,
    };
  }

  const choice = mapChoiceField(field, catalog, sensitive);
  if (choice) return choice;

  let best: { rule: Rule; score: number } | null = null;
  for (const rule of RULES) {
    const score = confidenceFor(signals, rule.aliases);
    if (score >= rule.minConfidence && (!best || score > best.score)) best = { rule, score };
  }

  // Link / sample URL fields: always propose LinkedIn / Portfolio / GitHub from memory.
  if (isLinkStyleField(signals) && !sensitive) {
    const links = toOptions(linkMemories(catalog));
    if (links.length) {
      const preferLinkedIn = /linkedin/i.test(signals);
      const ordered = preferLinkedIn
        ? [...links].sort((a, b) => Number(/linkedin/i.test(b.value)) - Number(/linkedin/i.test(a.value)))
        : links;
      return {
        fieldKey: field.key,
        label: humanQuestionLabel(field),
        memoryPath: ordered[0]?.label ?? "Profile → Links",
        source: ordered[0]?.source ?? "Application Memory",
        confidence: 0.88,
        proposedValue: ordered[0]?.value ?? "",
        options: ordered,
        approvalState: "pending",
        sensitive: false,
        excludedByDefault: false,
        reason: `Filled link from Application Memory (${ordered[0]?.label}). Open the chip for other saved URLs.`,
        fieldType: field.type,
        aiAnswerable: false,
        showChip: ordered.length > 1,
      };
    }
  }

  const aiAnswerable = isAiAnswerableField(field);
  const fuzzy = rankCatalogAgainstField(field, catalog);

  const ambiguousName = /\bname\b/.test(signals) && !/(full|first|last|given|family|user|university|school|company)/.test(signals);
  // "Full Name" and a plain "Name" label are unambiguous — they mean the display name.
  const isFullName = /\bfull\s*name\b/i.test(signals) || /^name$/i.test((field.label ?? "").trim());
  if (!best && ambiguousName && !isFullName) {
    const options = toOptions([
      ...memoriesForPath("Profile → Full name", ["name", "full name"], catalog),
      ...memoriesForPath("Profile → First name", ["first name"], catalog),
      ...memoriesForPath("Profile → Last name", ["last name"], catalog),
    ]);
    return {
      fieldKey: field.key,
      label: humanQuestionLabel(field),
      memoryPath: "Profile → Full name",
      source: options[0]?.source ?? "Application Memory",
      confidence: 0.42,
      proposedValue: options[0]?.value ?? "",
      options,
      approvalState: sensitive ? "blocked" : "pending",
      sensitive,
      excludedByDefault: true,
      reason: "Ambiguous “name” field. Top suggestion is filled; open the chip if you need another name variant.",
      fieldType: field.type,
      aiAnswerable: false,
      showChip: options.length > 1,
    };
  }

  if (!best && aiAnswerable) {
    const options = toOptions([...fuzzy.slice(0, 4).map((item) => item.mem), ...narrativeMemories(catalog)]);
    return {
      fieldKey: field.key,
      label: humanQuestionLabel(field),
      memoryPath: "AI answerable",
      source: "AI draft",
      confidence: 0.4,
      proposedValue: "",
      options,
      approvalState: sensitive ? "blocked" : "pending",
      sensitive,
      excludedByDefault: true,
      reason: "Open-ended question — open the 1-Apply assistant to draft from Application Memory, then Confirm to fill.",
      fieldType: field.type,
      aiAnswerable: true,
      showChip: true,
    };
  }

  // No rule hit — still consult Application Memory for every question.
  if (!best) {
    const top = fuzzy[0];
    if (top && top.score >= 0.45) {
      const options = toOptions(fuzzy.slice(0, 5).map((item) => item.mem));
      const proposedValue = formatProposedValue(top.mem.path, top.mem.value, signals);
      return {
        fieldKey: field.key,
        label: humanQuestionLabel(field),
        memoryPath: top.mem.path,
        source: top.mem.source,
        confidence: Math.round(top.score * 100) / 100,
        proposedValue,
        options,
        approvalState: sensitive ? "blocked" : "pending",
        sensitive,
        excludedByDefault: sensitive || !proposedValue,
        reason: proposedValue
          ? `Matched from Application Memory (${top.mem.path}).`
          : "Checked Application Memory — pick a value from the chip or form.",
        fieldType: field.type,
        aiAnswerable: false,
        showChip: options.length > 1,
      };
    }

    if (!sensitive && (field.type === "text" || field.type === "textarea") && field.label.trim().length >= 12) {
      return {
        fieldKey: field.key,
        label: humanQuestionLabel(field),
        memoryPath: "AI answerable",
        source: "AI draft",
        confidence: 0.35,
        proposedValue: "",
        options: toOptions(narrativeMemories(catalog)),
        approvalState: "pending",
        sensitive: false,
        excludedByDefault: true,
        reason: "No direct memory match — open the 1-Apply assistant to draft from Application Memory.",
        fieldType: field.type,
        aiAnswerable: true,
        showChip: true,
      };
    }

    return {
      fieldKey: field.key,
      label: humanQuestionLabel(field),
      memoryPath: "Unmapped",
      source: "None",
      confidence: 0,
      proposedValue: "",
      options: [],
      approvalState: sensitive ? "blocked" : "pending",
      sensitive,
      excludedByDefault: true,
      reason: sensitive
        ? "Sensitive field. Kept under explicit user control and never auto-filled."
        : "Could not map this field to Application Memory. Highlighted for manual completion.",
      fieldType: field.type,
      aiAnswerable: false,
      showChip: false,
    };
  }

  let options = toOptions(
    best.rule.path === "Approved Application Answer"
      ? [...memoriesForPath(best.rule.path, best.rule.aliases, catalog), ...narrativeMemories(catalog)]
      : memoriesForPath(best.rule.path, best.rule.aliases, catalog),
  );

  if (!options.length && fuzzy.length) {
    options = toOptions(fuzzy.slice(0, 5).map((item) => item.mem));
  }

  if (!options.length && (best.rule.path === "Education → Institution" || best.rule.path === "Education → Course")) {
    options = toOptions(
      catalog
        .filter((item) => /education|university|college|giki|degree|course|bachelor/i.test(`${item.path} ${item.value}`))
        .slice(0, 5),
    );
  }

  const structuredPath = /^(Profile|Education|Skills|Documents) →/.test(best.rule.path);
  const treatAsAi = !structuredPath && (aiAnswerable || best.rule.path === "Approved Application Answer");
  const rawProposed = treatAsAi ? "" : (options[0]?.value ?? "");
  const proposedValue = treatAsAi ? "" : formatProposedValue(best.rule.path, rawProposed, signals);

  if (!treatAsAi && (best.rule.path === "Profile → Phone" || best.rule.path === "Profile → CNIC") && rawProposed) {
    const variants = [
      formatIdentityNumberForField(rawProposed, `${signals} 10 digit without country code without spacing`),
      formatIdentityNumberForField(rawProposed, `${signals} with +92`),
      formatIdentityNumberForField(rawProposed, `${signals} without dash`),
      formatIdentityNumberForField(rawProposed, `${signals} with dash`),
      rawProposed.trim(),
    ];
    for (const variant of variants) {
      if (!variant || options.some((item) => item.value === variant)) continue;
      options.push({ value: variant, label: best.rule.path, source: options[0]?.source ?? "Application Memory" });
    }
  }

  return {
    fieldKey: field.key,
    label: humanQuestionLabel(field),
    memoryPath: best.rule.path,
    source: options[0]?.source ?? "Application Memory",
    confidence: Math.round(best.score * 100) / 100,
    proposedValue,
    options,
    approvalState: sensitive ? "blocked" : "pending",
    sensitive,
    excludedByDefault: sensitive || treatAsAi || best.score < 0.72 || !proposedValue,
    reason: sensitive
      ? "Sensitive field. Kept under explicit user control and never auto-filled."
      : treatAsAi
        ? "Open-ended question — open the 1-Apply assistant to draft from Application Memory, then Confirm to fill."
      : proposedValue
          ? `Mapped from ${options[0]?.source ?? "Application Memory"} (${best.rule.path}).`
        : `Mapped to ${best.rule.path}, but no verified value is stored yet.`,
    fieldType: field.type,
    aiAnswerable: treatAsAi,
    showChip: treatAsAi || options.length > 1,
  };
}

export function mapFields(fields: DetectedField[], catalog: MemoryValue[]): FieldMapping[] {
  return fields.map((field) => ensureFieldAssist(mapField(field, catalog), field, catalog));
}

function coerceNativeInputValue(mapping: FieldMapping, field: DetectedField): FieldMapping {
  if (field.type === "date") {
    const iso = toHtmlDateValue(mapping.proposedValue);
    if (iso) {
      return { ...mapping, proposedValue: iso, aiAnswerable: false };
    }
    return {
      ...mapping,
      proposedValue: "",
      aiAnswerable: false,
      excludedByDefault: true,
      reason: "Date field needs a calendar date (yyyy-MM-dd) from Application Memory.",
    };
  }
  if (field.type === "number") {
    const numeric = mapping.proposedValue.trim();
    if (/^-?\d+(\.\d+)?$/.test(numeric)) {
      return { ...mapping, proposedValue: numeric, aiAnswerable: false };
    }
    return { ...mapping, proposedValue: "", aiAnswerable: false, excludedByDefault: true };
  }
  return mapping;
}

/** Every interactive field gets a chip or AI popup so nothing is left without an assist control. */
function ensureFieldAssist(mapping: FieldMapping, field: DetectedField, catalog: MemoryValue[]): FieldMapping {
  mapping = coerceNativeInputValue(mapping, field);
  if (mapping.sensitive || mapping.approvalState === "blocked" || mapping.memoryPath === "Blocked") {
    return mapping;
  }

  const choiceType =
    field.type === "radio" || field.type === "checkbox" || field.type === "select" || field.type === "multi-select";
  if (field.type === "date" || field.type === "number") {
    const options =
      field.type === "date"
        ? mapping.options.flatMap((item) => {
            const iso = toHtmlDateValue(item.value);
            return iso ? [{ ...item, value: iso }] : [];
          })
        : mapping.options.filter((item) => /^-?\d+(\.\d+)?$/.test(item.value.trim()));
    return {
      ...mapping,
      options,
      aiAnswerable: false,
      showChip: Boolean(mapping.proposedValue) || options.length > 0,
    };
  }
  const textType = field.type === "text" || field.type === "textarea" || field.type === "url";

  if (choiceType) {
    const formOptions =
      mapping.options.length > 0
        ? mapping.options
        : field.options.map((value) => ({ value, label: field.label || "Form option", source: "Form choice" }));
    return {
      ...mapping,
      options: formOptions,
      showChip: formOptions.length > 0,
      aiAnswerable: false,
    };
  }

  if (field.type === "file") {
    return {
      ...mapping,
      showChip: mapping.options.length > 0 || Boolean(mapping.proposedValue),
    };
  }

  if (textType) {
    // Empty free-text / short-answer → always AI assistant popup.
    if (!mapping.proposedValue) {
      const memoryOpts = mapping.options.length
        ? mapping.options
        : toOptions([...rankCatalogAgainstField(field, catalog).slice(0, 4).map((item) => item.mem), ...narrativeMemories(catalog)]);
      return {
        ...mapping,
        options: memoryOpts,
        aiAnswerable: true,
        showChip: true,
        reason: mapping.reason.includes("Open-ended") || mapping.reason.includes("assistant")
          ? mapping.reason
          : "Needs input — open the 1-Apply assistant to draft from Application Memory, then Confirm.",
      };
    }

    // Auto-filled text still gets a chip so the user can swap memory values / reopen assist.
    const options =
      mapping.options.length > 0
        ? mapping.options
        : [{ value: mapping.proposedValue, label: mapping.memoryPath, source: mapping.source }];
    return {
      ...mapping,
      options,
      showChip: true,
      aiAnswerable: mapping.aiAnswerable,
    };
  }

  return { ...mapping, showChip: mapping.showChip || mapping.options.length > 0 || mapping.aiAnswerable };
}
