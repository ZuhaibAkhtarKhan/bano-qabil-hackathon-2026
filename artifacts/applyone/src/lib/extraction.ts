import { experienceKindSchema, type ExperienceKind } from "@1apply/contracts";

const KIND_ALIASES: Record<string, ExperienceKind> = {
  work: "employment",
  job: "employment",
  experience: "employment",
  role: "employment",
  school: "education",
  degree: "education",
  university: "education",
  award: "achievement",
  honors: "achievement",
  cert: "certification",
  certificate: "certification",
  volunteer: "volunteering",
  lead: "leadership",
  research: "research",
};

export function mapExtractedEvidenceKind(value: string | null | undefined): ExperienceKind {
  const raw = (value ?? "").trim();
  const parsed = experienceKindSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return KIND_ALIASES[raw.toLowerCase()] ?? "project";
}

export function uniqueSkillNames(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    const name = value?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name.slice(0, 80));
  }
  return names.slice(0, 40);
}
