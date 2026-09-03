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
  const document = window.document as unknown as ParentNode & {
    body: { innerText: string };
    textContent: string;
    querySelectorAll: Document["querySelectorAll"];
  };
  for (const el of Array.from(
    document.querySelectorAll(".g-recaptcha, .h-captcha, .cf-turnstile, iframe[src*='recaptcha'], iframe[src*='hcaptcha'], #captcha"),
  )) {
    (el as HTMLElement).getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 10,
        left: 10,
        bottom: 70,
        right: 310,
        width: 300,
        height: 60,
        toJSON() {
          return {};
        },
      }) as DOMRect;
  }
  return document;
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

  it("detects Google Forms listbox, role-radio, and Add file questions", () => {
    const document = documentFrom(`
      <div role="listitem">
        <div id="i1" role="heading">State/UT</div>
        <div role="listbox" aria-label="State/UT">Choose</div>
      </div>
      <div role="listitem">
        <div id="i2" role="heading">Which position are you applying for?</div>
        <div role="radio" aria-label="Editorial Board"></div>
        <div role="radio" aria-label="Human Resource"></div>
      </div>
      <div role="listitem">
        <div id="i3" role="heading">CV or Resume (pdf)</div>
        <div role="button" aria-label="Add file">Add file</div>
      </div>
    `);
    const fields = inventoryFromDocument(document);
    expect(fields.find((item) => item.key === "listitem:i1")?.type).toBe("select");
    expect(fields.find((item) => item.key === "listitem:i2")?.type).toBe("radio");
    expect(fields.find((item) => item.key === "listitem:i2")?.options).toEqual(["Editorial Board", "Human Resource"]);
    expect(fields.find((item) => item.key === "listitem:i3")?.type).toBe("file");
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
    const plan = planAutofill(mappings);
    expect(plan.fill.every((item) => item.fieldKey !== "submit")).toBe(true);
    expect(plan.fill.some((item) => item.fieldKey === "email")).toBe(true);
    expect(() => assertFillActionAllowed("submit")).toThrow();
  });

  it("marks why-join questions as AI-answerable and keeps a chip", () => {
    const document = documentFrom(`
      <label for="why">Why do you wanna join our company?</label>
      <textarea id="why" name="why"></textarea>
    `);
    const [mapping] = mapFields(inventoryFromDocument(document), memory);
    expect(mapping?.aiAnswerable).toBe(true);
    expect(mapping?.showChip).toBe(true);
    expect(mapping?.proposedValue).toBe("");
  });

  it("marks Google Forms scenario short-answers as AI-answerable without auto-fill", () => {
    const document = documentFrom(`
      <div role="listitem">
        <div role="heading" id="q1">Scenario: a member has missed three consecutive weekly meetings without explanation. How would you handle it?</div>
        <input aria-label="Your answer" type="text" />
      </div>
    `);
    const fields = inventoryFromDocument(document);
    const field = fields.find((item) => item.type === "text" || item.type === "textarea");
    expect(field).toBeTruthy();
    const [mapping] = mapFields(fields, memory);
    expect(mapping?.aiAnswerable).toBe(true);
    expect(mapping?.proposedValue).toBe("");
    expect(mapping?.showChip).toBe(true);
  });

  it("maps resume file inputs for extension attachment", () => {
    const document = documentFrom(`<label for="cv">Upload resume</label><input id="cv" name="resume" type="file" />`);
    const [mapping] = mapFields(inventoryFromDocument(document), memory);
    expect(mapping?.fieldType).toBe("file");
    expect(mapping?.memoryPath).toBe("Documents → Resume");
    expect(mapping?.approvalState).not.toBe("blocked");
  });

  it("matches multi-choice options from memory", () => {
    const document = documentFrom(`
      <label for="school">University</label>
      <select id="school" name="school">
        <option>NUST</option>
        <option>GIKI</option>
        <option>LUMS</option>
      </select>
    `);
    const catalog: MemoryValue[] = [
      { path: "Education → Institution", source: "Verified fact", value: "GIKI", aliases: ["university"] },
    ];
    const [mapping] = mapFields(inventoryFromDocument(document), catalog);
    expect(mapping?.proposedValue).toBe("GIKI");
    expect(mapping?.options.some((item) => item.value === "NUST")).toBe(true);
    expect(mapping?.showChip).toBe(true);
  });

  it("surfaces CAPTCHA and canvas-only forms as unsupported instead of filling them", () => {
    const captcha = detectCaptcha(documentFrom(`<div class="h-captcha"></div>`), "hCaptcha");
    expect(captcha.captcha).toBe(true);
    const hazards = inspectPage(documentFrom(`<canvas></canvas>`), "", []);
    expect(hazards.unsupported).toBe(true);
  });
});
