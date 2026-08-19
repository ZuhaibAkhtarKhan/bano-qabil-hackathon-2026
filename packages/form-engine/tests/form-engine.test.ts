import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

import {
  assertFillActionAllowed,
  detectAccountCreation,
  detectCaptcha,
  fillTargetAllowed,
  inspectPage,
  inventoryFromDocument,
  isProtectedControl,
  mapFields,
  mappingsSafeToFill,
  planAutofill,
  proposedFillTargets,
} from "../src/index";
import type { MemoryValue } from "../src/types";

const memory: MemoryValue[] = [
  { path: "Education → Institution", source: "Application Memory", value: "GIKI", aliases: ["university"] },
  { path: "Profile → GitHub", source: "Application Memory", value: "https://github.com/saadia", aliases: ["github"] },
  { path: "Profile → Full name", source: "Application Memory", value: "Saadia Asghar", aliases: ["name"] },
  { path: "Approved Application Answer", source: "Approved Application Answer", value: "I want to build retrieval systems.", aliases: ["why"] },
];

function documentFrom(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document as unknown as ParentNode & { body: { innerText: string }; textContent: string; documentElement: { outerHTML: string } };
}

describe("protected controls", () => {
  it("never treats submit, captcha, signature, or payment as fillable", () => {
    const fields = [
      { name: "full_name", label: "Full name", type: "text" },
      { name: "submit", label: "Submit application", type: "submit" },
      { name: "g-recaptcha-response", label: "Captcha", type: "textarea" },
      { name: "signature", label: "Sign here", type: "text" },
      { name: "card", label: "Payment card", type: "text" },
    ];
    expect(fields.filter((field) => !isProtectedControl(field)).map((field) => field.name)).toEqual(["full_name"]);
  });
});

describe("field detection across DOM patterns", () => {
  it("uses label, name, id, placeholder, aria-label, nearby text, options, and type", () => {
    const document = documentFrom(`
      <form>
        <label for="uni">University</label>
        <input id="uni" name="school_name" placeholder="Your campus" />
        <label>GitHub
          <input name="github" aria-label="GitHub profile" type="url" />
        </label>
        <p>Why are you interested?</p>
        <textarea name="motivation"></textarea>
        <fieldset>
          <legend>Work mode</legend>
          <select name="mode" multiple>
            <option>Remote</option>
            <option>Onsite</option>
          </select>
        </fieldset>
        <input type="date" name="start_date" />
        <input type="number" name="years" />
        <input type="checkbox" name="terms" />
        <input type="radio" name="track" value="ml" />
        <input type="radio" name="track" value="web" />
        <input type="file" name="resume" />
      </form>
    `);
    const fields = inventoryFromDocument(document);
    expect(fields.find((field) => field.id === "uni")?.label).toMatch(/University/i);
    expect(fields.find((field) => field.name === "github")?.ariaLabel).toMatch(/GitHub/i);
    expect(fields.find((field) => field.name === "motivation")?.nearbyText).toMatch(/interested/i);
    expect(fields.find((field) => field.name === "mode")?.type).toBe("multi-select");
    expect(fields.find((field) => field.name === "mode")?.options).toEqual(["Remote", "Onsite"]);
    expect(fields.some((field) => field.type === "date")).toBe(true);
    expect(fields.some((field) => field.type === "number")).toBe(true);
    expect(fields.some((field) => field.type === "checkbox")).toBe(true);
    expect(fields.filter((field) => field.type === "radio")).toHaveLength(1);
    expect(fields.some((field) => field.type === "file")).toBe(true);
    expect(fields.some((field) => field.type === "url")).toBe(true);
    expect(fields.some((field) => field.type === "textarea")).toBe(true);
  });
});

describe("mapping confidence", () => {
  it("maps high-confidence university and GitHub fields to Application Memory", () => {
    const document = documentFrom(`
      <label for="university">University</label>
      <input id="university" name="university" />
      <label>GitHub</label>
      <input name="github" />
    `);
    const mappings = mapFields(inventoryFromDocument(document), memory);
    const university = mappings.find((item) => item.fieldKey === "university");
    const github = mappings.find((item) => item.fieldKey === "github");
    expect(university?.memoryPath).toBe("Education → Institution");
    expect(university?.proposedValue).toBe("GIKI");
    expect(university?.source).toBe("Application Memory");
    expect(university?.confidence).toBeGreaterThanOrEqual(0.99);
    expect(github?.memoryPath).toBe("Profile → GitHub");
    expect(github?.confidence).toBeGreaterThanOrEqual(0.99);
  });

  it("keeps ambiguous name fields at low confidence", () => {
    const document = documentFrom(`<input name="name" placeholder="Name" />`);
    const [mapping] = mapFields(inventoryFromDocument(document), memory);
    expect(mapping?.confidence).toBeLessThan(0.5);
    expect(mapping?.excludedByDefault).toBe(true);
    expect(mapping?.reason.toLowerCase()).toContain("ambiguous");
  });

  it("maps interest questions to an approved application answer", () => {
    const document = documentFrom(`
      <label for="why">Why are you interested?</label>
      <textarea id="why" name="why"></textarea>
    `);
    const [mapping] = mapFields(inventoryFromDocument(document), memory);
    expect(mapping?.memoryPath).toBe("Approved Application Answer");
    expect(mapping?.proposedValue).toContain("retrieval");
  });
});

describe("sensitive fields, CAPTCHA, and unsupported forms", () => {
  it("blocks citizenship, work authorization, and criminal-history fields by default", () => {
    const document = documentFrom(`
      <input name="citizenship" aria-label="Citizenship" />
      <input name="work_auth" placeholder="Work authorization" />
      <input name="felony" aria-label="Have you been convicted of a felony?" />
    `);
    const mappings = mapFields(inventoryFromDocument(document), memory);
    expect(mappings.every((item) => item.sensitive && item.excludedByDefault && item.approvalState === "blocked")).toBe(true);
  });

  it("detects CAPTCHA and tells the user to act", () => {
    const document = documentFrom(`<div class="g-recaptcha"></div><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>`);
    const result = detectCaptcha(document, "I'm not a robot");
    expect(result.captcha).toBe(true);
    expect(result.captchaMessage).toMatch(/never bypasses CAPTCHA/i);
  });

  it("detects account creation and refuses to bypass it", () => {
    const document = documentFrom(`
      <h1>Create your account</h1>
      <input type="email" name="email" />
      <input type="password" name="password" />
      <button>Sign up</button>
    `);
    const result = detectAccountCreation(document, "Create your account");
    expect(result.accountCreation).toBe(true);
    expect(result.accountMessage).toMatch(/will not create host accounts/i);
  });

  it("fails gracefully when no standard fields exist", () => {
    const document = documentFrom(`<canvas id="custom-widget"></canvas>`);
    const hazards = inspectPage(document, "", inventoryFromDocument(document));
    expect(hazards.unsupported).toBe(true);
    expect(hazards.unsupportedReason).toMatch(/manually/i);
  });
});

describe("autofill never submits", () => {
  it("fills only approved safe fields and skips the rest", () => {
    const document = documentFrom(`
      <label for="university">University</label>
      <input id="university" name="university" />
      <input type="submit" name="commit" value="Submit" />
      <textarea name="g-recaptcha-response"></textarea>
    `);
    const fields = inventoryFromDocument(document);
    const mappings = mapFields(fields, memory).map((item) =>
      item.fieldKey === "university" ? { ...item, approvalState: "approved" as const, excludedByDefault: false } : item,
    );
    const plan = planAutofill(mappings);
    expect(plan.fill).toHaveLength(1);
    expect(plan.fill[0]?.proposedValue).toBe("GIKI");
    expect(mappingsSafeToFill(mappings).every((item) => item.approvalState === "approved")).toBe(true);
    expect(proposedFillTargets(fields).every((field) => field.name !== "commit")).toBe(true);
  });

  it("throws if asked to submit or bypass CAPTCHA", () => {
    expect(() => assertFillActionAllowed("submit")).toThrow(/never submits/i);
    expect(() => assertFillActionAllowed("bypassCaptcha")).toThrow(/CAPTCHA/i);
    expect(() => assertFillActionAllowed("createAccount")).toThrow(/accounts/i);
    expect(() => assertFillActionAllowed("setValue")).not.toThrow();
    expect(fillTargetAllowed("password", "password")).toBe(false);
    expect(fillTargetAllowed("full_name", "text")).toBe(true);
  });
});
