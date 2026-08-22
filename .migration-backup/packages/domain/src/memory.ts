import type { ExperienceKind, MemoryCategory } from "@1apply/contracts";

export const MEMORY_SECTIONS: Array<{ id: MemoryCategory; label: string }> = [
  { id: "personal", label: "Personal" },
  { id: "education", label: "Education" },
  { id: "skills", label: "Skills" },
  { id: "projects", label: "Projects" },
  { id: "experience", label: "Experience" },
  { id: "achievements", label: "Achievements" },
  { id: "certifications", label: "Certifications" },
  { id: "leadership", label: "Leadership" },
  { id: "research", label: "Research" },
  { id: "links", label: "Links" },
  { id: "supporting", label: "Supporting Evidence" },
];

const KIND_TO_CATEGORY: Record<ExperienceKind, MemoryCategory> = {
  education: "education",
  employment: "experience",
  project: "projects",
  achievement: "achievements",
  certification: "certifications",
  leadership: "leadership",
  research: "research",
  volunteering: "supporting",
};

export function categoryFromKind(kind: string): MemoryCategory {
  return KIND_TO_CATEGORY[kind as ExperienceKind] ?? "supporting";
}

export function normalizeMemoryToken(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function memoryFactKey(input: {
  category: MemoryCategory;
  organization?: string | null;
  title?: string | null;
  field: string;
}): string {
  return [
    input.category,
    normalizeMemoryToken(input.organization) || "unknown",
    normalizeMemoryToken(input.title) || "item",
    normalizeMemoryToken(input.field) || "value",
  ].join(":");
}

export type ConflictCandidate = {
  id: string;
  userId: string;
  factKey: string;
  category: MemoryCategory;
  value: string;
  verificationStatus: "unverified" | "verified" | "rejected";
};

export type DetectedConflict = {
  factKey: string;
  category: MemoryCategory;
  values: string[];
  factIds: string[];
};

export function normalizeFactValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function detectMemoryConflicts(facts: ConflictCandidate[]): DetectedConflict[] {
  const groups = new Map<string, ConflictCandidate[]>();
  for (const fact of facts) {
    if (fact.verificationStatus === "rejected") continue;
    const list = groups.get(fact.factKey) ?? [];
    list.push(fact);
    groups.set(fact.factKey, list);
  }

  const conflicts: DetectedConflict[] = [];
  for (const [factKey, group] of groups) {
    const unique = new Map<string, ConflictCandidate[]>();
    for (const fact of group) {
      const key = normalizeFactValue(fact.value);
      if (!key) continue;
      const list = unique.get(key) ?? [];
      list.push(fact);
      unique.set(key, list);
    }
    if (unique.size < 2) continue;
    conflicts.push({
      factKey,
      category: group[0]!.category,
      values: [...unique.keys()],
      factIds: group.map((item) => item.id),
    });
  }
  return conflicts;
}

export function assertOwnedMemory(actorUserId: string, rowUserId: string | null | undefined): void {
  if (!rowUserId || rowUserId !== actorUserId) {
    throw new Error("MEMORY_FORBIDDEN");
  }
}

export function pickCanonicalFact<T extends { id: string }>(facts: T[], chosenId: string): T | null {
  return facts.find((item) => item.id === chosenId) ?? null;
}
