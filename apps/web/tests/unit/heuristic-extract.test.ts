import { describe, expect, it } from "vitest";

import { heuristicExtractDocument } from "@/server/memory/heuristic-extract";

describe("heuristic document extract", () => {
  it("reads contact facts, skills, and experience from resume text without an AI key", () => {
    const text = `
Jane Applicant
Software Engineer
Karachi, Pakistan
jane@example.com
+92 300 1234567
https://linkedin.com/in/jane
https://github.com/jane

Skills
Python, React, TypeScript, SQL

Experience
Built a scholarship tracker used by 200 students.
Led a remote internship project for a climate nonprofit.

Education
B.S. Computer Science, NED University
`;
    const extracted = heuristicExtractDocument(text, "jane-resume.pdf");
    expect(extracted.displayName).toMatch(/Jane/i);
    expect(extracted.phone).toBeTruthy();
    expect(extracted.skills?.join(" ").toLowerCase()).toMatch(/python/);
    expect(extracted.links?.some((link) => link.kind === "linkedin")).toBe(true);
    expect(extracted.evidence.length).toBeGreaterThan(0);
  });

  it("does not use a vault label like Primary resume as the applicant name", () => {
    const text = `
Skills
Python, React

Experience
Built internal tools for campus clubs.
`;
    const extracted = heuristicExtractDocument(text, "Primary resume");
    expect(extracted.displayName).toBeNull();
  });
});
