import { describe, expect, it } from "vitest";

import { sourcedDiscoveryCatalog } from "../src/discovery-catalog";
import {
  deduplicateDiscoveries,
  filterDiscoveries,
  normalizeOpportunityUrl,
  parseDiscoveryCriteria,
  rankDiscoveries,
  runDiscoveryPipeline,
  type DiscoveryCandidate,
} from "../src/discovery";
import type { MemoryEvidence } from "../src/intelligence-types";

const query = "Find AI/ML internships in Pakistan or remote opportunities for undergraduate students.";

const evidence: MemoryEvidence[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Undergraduate machine learning project",
    kind: "project",
    organization: "NED University",
    situation: "Built a retrieval pipeline",
    action: "Trained a classifier in Python",
    outcome: "Shipped a working demo",
    skills: ["python", "machine", "learning"],
    verificationStatus: "verified",
    excludedFromAi: false,
  },
];

function listing(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    provider: "test",
    sourceUrl: "https://example.com/intern",
    canonicalUrl: "https://example.com/intern",
    title: "AI internship",
    organization: "Lab",
    category: "internship",
    location: "Remote",
    remote: true,
    educationLevel: "undergraduate",
    experienceLevel: "internship",
    domain: ["ai_ml"],
    skills: ["python"],
    excerpt: "Python machine learning internship for undergraduates",
    deadlineAt: "2026-09-01T00:00:00.000Z",
    quality: 70,
    requirements: [{ id: "r1", text: "Python machine learning project experience", hard: false, kind: "skills" }],
    ...overrides,
  };
}

describe("discovery criteria", () => {
  it("extracts type, domain, location, remote, and education from natural language", () => {
    const parsed = parseDiscoveryCriteria(query);
    expect(parsed.categories).toContain("internship");
    expect(parsed.domain).toContain("ai_ml");
    expect(parsed.locations).toContain("Pakistan");
    expect(parsed.remoteOk).toBe(true);
    expect(parsed.educationLevel).toBe("undergraduate");
  });
});

describe("url normalization and deduplication", () => {
  it("strips tracking params and trailing slashes", () => {
    expect(normalizeOpportunityUrl("https://WWW.Example.com/jobs/1/?utm_source=x&ref=nav")).toBe(
      "https://example.com/jobs/1",
    );
  });

  it("keeps a single record for the same canonical URL", () => {
    const items = deduplicateDiscoveries([
      listing({ sourceUrl: "https://example.com/intern/?utm_campaign=a", quality: 40 }),
      listing({ sourceUrl: "https://www.example.com/intern/", quality: 90, alreadySaved: true, opportunityId: "opp-1" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.alreadySaved).toBe(true);
    expect(items[0]?.canonicalUrl).toBe("https://example.com/intern");
  });
});

describe("filter and rank", () => {
  it("keeps Pakistan or remote internships and drops mismatched jobs", () => {
    const criteria = parseDiscoveryCriteria(query);
    const filtered = filterDiscoveries(
      [
        listing({ title: "Remote ML intern" }),
        listing({
          title: "Karachi ML intern",
          sourceUrl: "https://example.com/khi",
          canonicalUrl: "https://example.com/khi",
          location: "Karachi, Pakistan",
          remote: false,
        }),
        listing({
          title: "Staff engineer",
          category: "job",
          sourceUrl: "https://example.com/job",
          canonicalUrl: "https://example.com/job",
        }),
      ],
      criteria,
    );
    expect(filtered.map((item) => item.title).sort()).toEqual(["Karachi ML intern", "Remote ML intern"]);
  });

  it("ranks a verified ML overlap above an unrelated listing and does not invent fit without evidence", () => {
    const criteria = parseDiscoveryCriteria(query);
    const withMemory = rankDiscoveries(
      [
        listing({ title: "ML intern", sourceUrl: "https://a.example/ml" }),
        listing({
          title: "Policy intern",
          sourceUrl: "https://a.example/policy",
          excerpt: "Public policy internship",
          domain: ["policy"],
          skills: [],
          requirements: [{ id: "r2", text: "Policy writing experience", hard: true, kind: "experience" }],
        }),
      ],
      criteria,
      { evidence, now: new Date("2026-08-19T00:00:00.000Z") },
    );
    expect(withMemory[0]?.title).toBe("ML intern");
    expect(withMemory[0]?.fitPreview).toBeGreaterThan(0);
    expect(withMemory[0]?.reasons.some((reason) => reason.includes("https://"))).toBe(true);

    const withoutMemory = rankDiscoveries([listing()], criteria, { evidence: [], now: new Date("2026-08-19T00:00:00.000Z") });
    expect(withoutMemory[0]?.fitPreview).toBeNull();
    expect(withoutMemory[0]?.reasons.join(" ")).toMatch(/no verified evidence/i);
  });
});

describe("sourced catalog", () => {
  it("only exposes listings with a retained source URL", () => {
    const catalog = sourcedDiscoveryCatalog();
    expect(catalog.length).toBeGreaterThan(5);
    expect(catalog.every((item) => item.sourceUrl.startsWith("https://"))).toBe(true);
    expect(catalog.every((item) => item.deadlineAt === null)).toBe(true);
  });

  it("returns remote or Pakistan AI/ML internships for the sample query", () => {
    const results = runDiscoveryPipeline(sourcedDiscoveryCatalog(), parseDiscoveryCriteria(query));
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((item) => item.category === "internship")).toBe(true);
    expect(results.some((item) => item.remote || (item.location ?? "").toLowerCase().includes("pakistan"))).toBe(true);
    expect(results.every((item) => item.sourceUrl.length > 0)).toBe(true);
  });
});
