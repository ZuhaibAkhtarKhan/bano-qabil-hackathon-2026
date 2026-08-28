import { experienceKindSchema, type ExperienceKind } from "@1apply/contracts";

const KIND_ALIASES: Record<string, ExperienceKind> = {
  work: "employment",
  job: "employment",
  experience: "employment",
  role: "employment",
  internship: "employment",
  intern: "employment",
  school: "education",
  degree: "education",
  university: "education",
  bachelor: "education",
  bachelors: "education",
  masters: "education",
  phd: "education",
  coursework: "education",
  award: "achievement",
  honors: "achievement",
  honour: "achievement",
  contest: "achievement",
  competition: "achievement",
  hackathon: "achievement",
  cert: "certification",
  certificate: "certification",
  course: "certification",
  coursera: "certification",
  udemy: "certification",
  edx: "certification",
  volunteer: "volunteering",
  volunteering: "volunteering",
  lead: "leadership",
  club: "leadership",
  ambassador: "leadership",
  research: "research",
  paper: "research",
  projects: "project",
  education: "education",
  employment: "employment",
  project: "project",
  achievement: "achievement",
  certification: "certification",
  leadership: "leadership",
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
    // Collapse "DSA" / "Data Structures and Algorithms (DSA)" style near-duplicates.
    const key = name
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/[^a-z0-9+#./]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name.slice(0, 80));
  }
  return names.slice(0, 40);
}
