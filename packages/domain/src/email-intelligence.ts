export type EmailCategory =
  | "application_received"
  | "interview_invitation"
  | "assessment"
  | "rejection"
  | "offer"
  | "follow_up_request"
  | "irrelevant";

export type EmailSignal = {
  subject: string;
  snippet: string;
  from: string;
  date: string;
};

export type EmailClassification = {
  category: EmailCategory;
  confidence: number;
  reason: string;
  interviewDetected: boolean;
  interviewDateHints: string[];
};

export type AssociationSignal = {
  organization: string | null;
  opportunityTitle: string | null;
  senderDomain: string | null;
  from?: string;
  subject: string;
  snippet: string;
  links: string[];
  date: string;
};

export type ApplicationCandidate = {
  id: string;
  opportunityTitle: string;
  organization: string | null;
  sourceUrl: string | null;
  status: string;
};

export type AssociationResult = {
  applicationId: string | null;
  confidence: number;
  reason: string;
  signals: string[];
};

// ── Email category patterns ──────────────────────────────────────────────────

const CATEGORY_RULES: Array<{
  category: EmailCategory;
  patterns: RegExp[];
  weight: number;
}> = [
  {
    category: "rejection",
    patterns: [
      /we (will not|won't|are unable to) (be moving|move) forward/i,
      /not (selected|moving forward|shortlisted|progressing)/i,
      /regret to inform/i,
      /position has been filled/i,
      /unfortunately.{0,40}(not|no longer)/i,
      /after careful consideration.{0,60}(not|unable)/i,
      /thank you for (your|the) (interest|time|application).{0,60}unfortunately/i,
    ],
    weight: 1.0,
  },
  {
    category: "offer",
    patterns: [
      /we('re| are) (pleased|delighted|excited) to (offer|extend)/i,
      /offer of (employment|admission|internship|fellowship)/i,
      /congratulations.{0,80}(offer|accepted|selected)/i,
      /letter of offer/i,
      /we would like to offer you/i,
    ],
    weight: 1.0,
  },
  {
    category: "interview_invitation",
    patterns: [
      /interview (invite|invitation|request|slot|schedule)/i,
      /schedule (an? |your )(interview|call|meeting)/i,
      /like to (invite|schedule).{0,40}interview/i,
      /next (step|round|stage).{0,60}interview/i,
      /video (call|interview|meeting)/i,
      /technical (round|screen|interview)/i,
      /(hr|recruiter|hiring).{0,30}(call|interview|chat)/i,
      /calendly|cal\.com|doodle|greenhouse\.io|lever\.co/i,
    ],
    weight: 0.9,
  },
  {
    category: "assessment",
    patterns: [
      /coding (test|challenge|assessment|exercise)/i,
      /take-?home (assignment|test|exercise)/i,
      /hacker(rank|earth)|codility|leetcode|pymetrics|hackerway/i,
      /assessment (link|test|platform)/i,
      /complete (the |a )?(test|assessment|challenge)/i,
      /online (test|assessment|evaluation)/i,
    ],
    weight: 0.9,
  },
  {
    category: "application_received",
    patterns: [
      /thank you for (applying|your application|submitting)/i,
      /application (received|submitted|confirmed)/i,
      /we have received your application/i,
      /confirmation.{0,40}application/i,
      /your application (is|has been) (under|being) review/i,
    ],
    weight: 0.85,
  },
  {
    category: "follow_up_request",
    patterns: [
      /additional (information|documents|details) (required|needed|requested)/i,
      /please (provide|submit|send|upload)/i,
      /we (need|require|would like).{0,60}(additional|more|further)/i,
      /background check/i,
      /references? (required|needed|request)/i,
    ],
    weight: 0.8,
  },
];

const INTERVIEW_DATE_PATTERNS = [
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.{0,30}\d{1,2}(:\d{2})?\s*(am|pm)/i,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{1,2}(,\s*\d{4})?\b/i,
  /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/,
  /\b\d{1,2}:\d{2}\s*(am|pm)\s*([-–]\s*\d{1,2}:\d{2}\s*(am|pm))?/i,
];

const APPLICATION_KEYWORDS =
  /\b(application|applied|applying|position|role|internship|fellowship|scholarship|hackathon|grant|vacancy|opening)\b/i;

export function classifyEmail(signal: EmailSignal): EmailClassification {
  const haystack = `${signal.subject} ${signal.snippet}`.toLowerCase();

  if (!APPLICATION_KEYWORDS.test(haystack)) {
    return {
      category: "irrelevant",
      confidence: 0.9,
      reason: "No application-related keywords found.",
      interviewDetected: false,
      interviewDateHints: [],
    };
  }

  let best: { category: EmailCategory; score: number; reason: string } | null = null;

  for (const rule of CATEGORY_RULES) {
    const matched = rule.patterns.filter((p) => p.test(haystack));
    if (matched.length === 0) continue;
    const score = rule.weight * Math.min(1, 0.6 + matched.length * 0.2);
    if (!best || score > best.score) {
      best = {
        category: rule.category,
        score,
        reason: `Matched ${matched.length} pattern(s) for "${rule.category}".`,
      };
    }
  }

  const interviewDateHints: string[] = [];
  const fullText = `${signal.subject} ${signal.snippet}`;
  if (best?.category === "interview_invitation") {
    for (const pattern of INTERVIEW_DATE_PATTERNS) {
      const match = pattern.exec(fullText);
      if (match) interviewDateHints.push(match[0]);
    }
  }

  if (!best) {
    return {
      category: "irrelevant",
      confidence: 0.5,
      reason: "Application keywords present but no strong category match.",
      interviewDetected: false,
      interviewDateHints: [],
    };
  }

  return {
    category: best.category,
    confidence: best.score,
    reason: best.reason,
    interviewDetected: best.category === "interview_invitation",
    interviewDateHints,
  };
}

// ── Application association ──────────────────────────────────────────────────

function domainOf(email: string): string {
  const at = email.indexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase().split(".").slice(-2).join(".") : "";
}

function urlDomain(url: string): string {
  try {
    return new URL(url).hostname.split(".").slice(-2).join(".");
  } catch {
    return "";
  }
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function wordOverlap(a: string, b: string): number {
  const setA = new Set(normalize(a).split(" ").filter((w) => w.length > 2));
  const setB = new Set(normalize(b).split(" ").filter((w) => w.length > 2));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared++;
  return shared / Math.min(setA.size, setB.size);
}

export function associateEmailToApplication(
  signal: AssociationSignal,
  candidates: ApplicationCandidate[],
): AssociationResult {
  if (candidates.length === 0) {
    return { applicationId: null, confidence: 0, reason: "No applications in workspace.", signals: [] };
  }

  const senderDomain = signal.senderDomain ?? domainOf(signal.from ?? "") ?? "";
  const linkDomains = signal.links.map(urlDomain).filter(Boolean);
  const haystack = `${signal.subject} ${signal.snippet}`;

  let best: { id: string; score: number; signals: string[] } | null = null;

  for (const candidate of candidates) {
    const signals: string[] = [];
    let score = 0;

    // Org name match in subject/snippet
    if (candidate.organization) {
      const orgOverlap = wordOverlap(candidate.organization, haystack);
      if (orgOverlap >= 0.5) {
        score += orgOverlap * 0.5;
        signals.push(`Organization "${candidate.organization}" found in email.`);
      }
    }

    // Opportunity title overlap
    const titleOverlap = wordOverlap(candidate.opportunityTitle, haystack);
    if (titleOverlap >= 0.3) {
      score += titleOverlap * 0.4;
      signals.push(`Title overlap: ${Math.round(titleOverlap * 100)}%.`);
    }

    // Sender domain matches source URL domain
    if (candidate.sourceUrl && senderDomain) {
      const sourceDomain = urlDomain(candidate.sourceUrl);
      if (sourceDomain && (sourceDomain === senderDomain || sourceDomain.endsWith(`.${senderDomain}`) || senderDomain.endsWith(`.${sourceDomain}`))) {
        score += 0.45;
        signals.push(`Sender domain "${senderDomain}" matches source URL.`);
      }
    }

    // Link domain matches source URL
    if (candidate.sourceUrl) {
      const sourceDomain = urlDomain(candidate.sourceUrl);
      if (linkDomains.some((d) => d === sourceDomain)) {
        score += 0.3;
        signals.push("Email link domain matches source URL.");
      }
    }

    if (!best || score > best.score) best = { id: candidate.id, score, signals };
  }

  if (!best || best.score < 0.2) {
    return {
      applicationId: null,
      confidence: best?.score ?? 0,
      reason: "No confident association found.",
      signals: [],
    };
  }

  return {
    applicationId: best.id,
    confidence: Math.min(1, best.score),
    reason: `Best match score: ${Math.round(best.score * 100)}%.`,
    signals: best.signals,
  };
}

// ── Calendar event builder ──────────────────────────────────────────────────

export type CalendarEventInput = {
  applicationId: string;
  opportunityTitle: string;
  organization: string | null;
  interviewDateHints: string[];
  emailSnippet: string;
  emailSubject: string;
  meetingUrl: string | null;
  location: string | null;
  timezone: string | null;
};

export type ProposedCalendarEvent = {
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  meetingUrl: string | null;
  timezone: string | null;
  applicationId: string;
  needsUserConfirmation: true;
  suggestedFrom: "email_date_hint" | "no_date_detected";
  notes: string;
};

export function buildProposedCalendarEvent(input: CalendarEventInput): ProposedCalendarEvent {
  const org = input.organization ?? "Unknown";
  const title = `Interview – ${input.opportunityTitle} at ${org}`;

  // Try to parse a date hint. We surface the raw hint for user confirmation rather
  // than silently create an event on a wrong date.
  let startsAt: string | null = null;
  const hint = input.interviewDateHints[0] ?? null;
  if (hint) {
    const parsed = new Date(hint);
    if (!isNaN(parsed.getTime())) startsAt = parsed.toISOString();
  }

  // Detect meeting URLs in snippet
  const urlPattern = /(https?:\/\/[^\s"<>]*(?:zoom|teams|meet\.google|webex|whereby)[^\s"<>]*)/i;
  const urlMatch = urlPattern.exec(input.emailSnippet);
  const meetingUrl = input.meetingUrl ?? urlMatch?.[1] ?? null;

  return {
    title,
    startsAt,
    endsAt: null,
    location: input.location,
    meetingUrl,
    timezone: input.timezone,
    applicationId: input.applicationId,
    needsUserConfirmation: true,
    suggestedFrom: startsAt ? "email_date_hint" : "no_date_detected",
    notes: `Detected from email: "${input.emailSubject}". Date${startsAt ? ` parsed from "${hint}"` : " not detected — set manually"}.`,
  };
}
