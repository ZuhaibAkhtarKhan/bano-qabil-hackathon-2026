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
  { id: "answers", label: "Saved answers" },
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

/** Soft-normalize orgs so "Personal" / "Personal Project" / null and "Udemy" / "Jonas (Udemy)" collide. */
export function normalizeOrganizationToken(value: string | null | undefined): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || /^(personal(\s+project)?|self|myself|n\/?a|unknown|none|-|—|–)$/i.test(raw)) {
    return "personal";
  }
  if (/\budemy\b/i.test(raw)) return "udemy";
  if (/\bedx\b|\bharvard\b/i.test(raw)) return "edx";
  if (/\bcoursera\b/i.test(raw)) return "coursera";
  if (/\bicpc\b/i.test(raw)) return "icpc";
  return normalizeMemoryToken(raw) || "personal";
}

/**
 * Stable identity for kit evidence rows (ignores title vs end_year field splits).
 * Used to prevent duplicate inserts across fill passes / documents.
 */
export function evidenceIdentityKey(input: {
  kind: string;
  title: string;
  organization?: string | null;
}): string {
  const category = categoryFromKind(input.kind);
  return [
    category,
    normalizeOrganizationToken(input.organization),
    normalizeMemoryToken(input.title) || "item",
  ].join(":");
}

export function memoryFactKey(input: {
  category: MemoryCategory;
  organization?: string | null;
  title?: string | null;
  field: string;
}): string {
  return [
    input.category,
    normalizeOrganizationToken(input.organization),
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
