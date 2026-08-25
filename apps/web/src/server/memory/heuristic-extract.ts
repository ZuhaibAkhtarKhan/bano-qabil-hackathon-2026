import type { ExtractedDocument } from "@/server/memory/plan-extraction";

const SKILL_HINTS = [
  "python",
  "javascript",
  "typescript",
  "react",
  "next.js",
  "node.js",
  "java",
  "sql",
  "postgres",
  "aws",
  "docker",
  "figma",
  "excel",
  "machine learning",
  "pytorch",
  "tensorflow",
  "pandas",
  "git",
  "html",
  "css",
  "tailwind",
  "product management",
  "communication",
  "leadership",
];

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1]?.trim() || match?.[0]?.trim() || null;
}

function section(text: string, heading: RegExp, next: RegExp): string {
  const start = text.search(heading);
  if (start < 0) return "";
  const rest = text.slice(start);
  const end = rest.slice(1).search(next);
  return (end >= 0 ? rest.slice(0, end + 1) : rest).slice(0, 4_000);
}

function parseBullets(block: string): string[] {
  return block
    .split(/\n|•|●|;|\u2022/)
    .map((line) => line.replace(/^[\s\-\d.)]+/, "").trim())
    .filter((line) => line.length > 3 && line.length < 180)
    .slice(0, 16);
}

function kindForHeading(heading: string): string {
  const value = heading.toLowerCase();
  if (/educat|university|school|degree/.test(value)) return "education";
  if (/experience|employment|work|intern/.test(value)) return "employment";
  if (/project/.test(value)) return "project";
  if (/lead/.test(value)) return "leadership";
  if (/volunteer/.test(value)) return "volunteering";
  if (/award|honor|achiev/.test(value)) return "achievement";
  if (/certif/.test(value)) return "certification";
  if (/research/.test(value)) return "research";
  return "project";
}

function looksLikePersonName(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (!text || text.length > 80) return false;
  if (
    /resume|curriculum|cv\b|primary|document|upload|supporting|file|pdf|docx?|skills?|experience|education|projects?|summary|objective|profile|contact|references?/i.test(
      text,
    )
  ) {
    return false;
  }
  // Title-case multi-word names only — avoids headings and sentence fragments.
  return /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(text);
}

export function heuristicExtractDocument(text: string, documentLabel: string): ExtractedDocument {
  const cleaned = text.replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, 40_000);
  const lines = cleaned
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const email = firstMatch(cleaned, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  const phone = firstMatch(cleaned, /(\+?\d[\d\s().-]{7,}\d)/);
  const linkedin = firstMatch(cleaned, /(https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+)/i);
  const github = firstMatch(cleaned, /(https?:\/\/(?:www\.)?github\.com\/[^\s)]+)/i);
  const website = firstMatch(cleaned, /(https?:\/\/(?:www\.)?(?:portfolio|[a-z0-9-]+\.(?:dev|me|io|com))[^\s)]*)/i);

  const fromBody = lines.find((line) => looksLikePersonName(line));
  const fromLabel = documentLabel.replace(/\.(pdf|docx?)$/i, "").replace(/[_-]+/g, " ").trim();
  // Never treat vault labels like "Primary resume" as the applicant's name.
  const displayName = fromBody ?? (looksLikePersonName(fromLabel) ? fromLabel : null);

  const headline =
    lines.find((line) => /engineer|developer|student|designer|analyst|intern|manager|researcher/i.test(line) && line.length < 120) ??
    null;

  const locationLine = lines.find((line) => /\b([A-Z][a-z]+,\s*[A-Z]{2,})\b/.test(line));
  const locationParts = locationLine?.match(/([A-Za-z .]+),\s*([A-Za-z .]+)/);
  const locationCity = locationParts?.[1]?.trim() ?? null;
  const locationCountry = locationParts?.[2]?.trim() ?? null;

  const skillsBlock = section(cleaned, /\bskills\b/i, /\b(experience|education|projects|work)\b/i);
  const skillNames = new Set<string>();
  for (const hint of SKILL_HINTS) {
    if (cleaned.toLowerCase().includes(hint)) skillNames.add(hint);
  }
  for (const item of parseBullets(skillsBlock)) {
    if (item.length <= 40) skillNames.add(item);
  }

  const evidence: ExtractedDocument["evidence"] = [];
  const blocks = [
    { heading: "experience", body: section(cleaned, /\b(experience|employment|work history)\b/i, /\b(education|projects|skills)\b/i) },
    { heading: "education", body: section(cleaned, /\beducation\b/i, /\b(experience|projects|skills)\b/i) },
    { heading: "projects", body: section(cleaned, /\bprojects?\b/i, /\b(education|experience|skills)\b/i) },
  ];
  for (const block of blocks) {
    for (const bullet of parseBullets(block.body).slice(0, 6)) {
      evidence.push({
        title: bullet.slice(0, 160),
        kind: kindForHeading(block.heading),
        organization: null,
        situation: bullet,
        action: null,
        outcome: null,
        skills: [],
        excerpt: bullet,
      });
    }
  }

  const links = [
    linkedin ? { kind: "linkedin", url: linkedin } : null,
    github ? { kind: "github", url: github } : null,
    website && website !== linkedin && website !== github ? { kind: "portfolio", url: website } : null,
    email ? { kind: "other", url: `mailto:${email}` } : null,
  ].filter((item): item is { kind: string; url: string } => Boolean(item));

  return {
    displayName,
    headline,
    phone,
    locationCity,
    locationCountry,
    links,
    skills: [...skillNames].slice(0, 24),
    evidence,
  };
}
