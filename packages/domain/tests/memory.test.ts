import { describe, expect, it } from "vitest";

import {
  assertOwnedMemory,
  categoryFromKind,
  detectMemoryConflicts,
  memoryFactKey,
  normalizeFactValue,
  pickCanonicalFact,
  type ConflictCandidate,
} from "@1apply/domain";

describe("memoryFactKey", () => {
  it("builds stable keys for graduation year conflicts", () => {
    const key = memoryFactKey({
      category: "education",
      organization: "MIT",
      title: "B.S. Computer Science",
      field: "end_year",
    });
    expect(key).toBe("education:mit:b-s-computer-science:end-year");
  });
});

describe("detectMemoryConflicts", () => {
  const base = (overrides: Partial<ConflictCandidate>): ConflictCandidate => ({
    id: overrides.id ?? crypto.randomUUID(),
    userId: "user-1",
    factKey: overrides.factKey ?? "education:mit:b-s:end-year",
    category: "education",
    value: overrides.value ?? "2027",
    verificationStatus: overrides.verificationStatus ?? "unverified",
  });

  it("flags when two resumes disagree on graduation year", () => {
    const facts: ConflictCandidate[] = [
      base({ id: "a", value: "2027-06-01", factKey: "education:mit:bs:end-year" }),
      base({ id: "b", value: "2028-06-01", factKey: "education:mit:bs:end-year" }),
    ];
    const conflicts = detectMemoryConflicts(facts);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.factIds).toEqual(expect.arrayContaining(["a", "b"]));
    expect(conflicts[0]?.values.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores rejected facts", () => {
    const facts: ConflictCandidate[] = [
      base({ id: "a", value: "2027" }),
      base({ id: "b", value: "2028", verificationStatus: "rejected" }),
    ];
    expect(detectMemoryConflicts(facts)).toHaveLength(0);
  });

  it("does not conflict when normalized values match", () => {
    const facts: ConflictCandidate[] = [
      base({ id: "a", value: "2027" }),
      base({ id: "b", value: " 2027 " }),
    ];
    expect(detectMemoryConflicts(facts)).toHaveLength(0);
  });
});

describe("categoryFromKind", () => {
  it("maps research experience to research section", () => {
    expect(categoryFromKind("research")).toBe("research");
  });
});

describe("normalizeFactValue", () => {
  it("normalizes whitespace and casing", () => {
    expect(normalizeFactValue(" 2028 ")).toBe("2028");
  });
});

describe("assertOwnedMemory", () => {
  it("throws when actor does not own the row", () => {
    expect(() => assertOwnedMemory("user-a", "user-b")).toThrow("MEMORY_FORBIDDEN");
  });
});

describe("pickCanonicalFact", () => {
  it("returns the chosen fact by id", () => {
    const facts = [{ id: "one" }, { id: "two" }];
    expect(pickCanonicalFact(facts, "two")?.id).toBe("two");
  });
});
