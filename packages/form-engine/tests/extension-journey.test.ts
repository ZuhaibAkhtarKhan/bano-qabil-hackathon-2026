import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

import {
  assertFillActionAllowed,
  detectCaptcha,
  inspectPage,
  inventoryFromDocument,
  isSensitiveField,
  mapFields,
  planAutofill,
} from "../src/index";
import type { MemoryValue } from "../src/types";

const memory: MemoryValue[] = [
  { path: "Profile → Full name", source: "Application Memory", value: "Amina Khan", aliases: ["name"] },
  { path: "Profile → Email", source: "Application Memory", value: "amina@example.com", aliases: ["email"] },
];

function documentFrom(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document as unknown as ParentNode & { body: { innerText: string }; textContent: string };
}

describe("extension field, label, name, and id detection", () => {
  it("prefers name as the field key and still captures id and label", () => {
    const fields = inventoryFromDocument(
      documentFrom(`<label for="legal">Legal name</label><input id="legal" name="full_name" />`),
    );
    expect(fields[0]?.key).toBe("full_name");
    expect(fields[0]?.id).toBe("legal");
    expect(fields[0]?.name).toBe("full_name");
    expect(fields[0]?.label).toMatch(/Legal name/i);
  });

  it("falls back to id when name is missing", () => {
    const fields = inventoryFromDocument(documentFrom(`<input id="email" type="email" />`));
    expect(fields[0]?.key).toBe("email");
    expect(fields[0]?.type).toBe("text");
  });
});

describe("extension mapping, sensitive fields, and no accidental submission", () => {
  it("scores email highly and never includes submit in the fill plan", () => {
    const document = documentFrom(`
      <label for="email">Email</label>
      <input id="email" name="email" type="email" />
      <input name="ssn" aria-label="Social security number" />
      <button type="submit">Submit application</button>
    `);
    const fields = inventoryFromDocument(document);
    expect(fields.map((field) => field.key)).toEqual(["email", "ssn"]);
    expect(inspectPage(document, "", fields).hasSubmitControl).toBe(true);
    const mappings = mapFields(fields, memory);
    const email = mappings.find((item) => item.fieldKey === "email");
    expect(email?.confidence).toBeGreaterThanOrEqual(0.95);
    expect(email?.proposedValue).toBe("amina@example.com");
    expect(isSensitiveField({ name: "ssn", label: "Social security number" })).toBe(true);
    const plan = planAutofill(
      mappings.map((item) => (item.fieldKey === "email" ? { ...item, approvalState: "approved" as const, excludedByDefault: false } : item)),
    );
    expect(plan.fill.every((item) => item.fieldKey !== "submit")).toBe(true);
    expect(() => assertFillActionAllowed("submit")).toThrow();
  });

  it("surfaces CAPTCHA and canvas-only forms as unsupported instead of filling them", () => {
    const captcha = detectCaptcha(documentFrom(`<div class="h-captcha"></div>`), "hCaptcha");
    expect(captcha.captcha).toBe(true);
    const hazards = inspectPage(documentFrom(`<canvas></canvas>`), "", []);
    expect(hazards.unsupported).toBe(true);
  });
});
