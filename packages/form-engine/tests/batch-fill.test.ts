import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

import {
  fieldsEligibleForBatch,
  inventoryFromDocument,
  isSensitiveField,
  toBatchFieldInputs,
  type DetectedField,
} from "../src/index";

function documentFrom(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document as unknown as ParentNode & { body: { innerText: string }; textContent: string };
}

describe("batch fill inventory", () => {
  it("strips sensitive and protected fields before the batch payload is built", () => {
    const fields = inventoryFromDocument(
      documentFrom(`
        <label for="name">Full name</label>
        <input id="name" name="full_name" />
        <label for="email">Email</label>
        <input id="email" name="email" type="email" />
        <label for="ssn">Social security number</label>
        <input id="ssn" name="ssn" />
        <label for="auth">Work authorization</label>
        <input id="auth" name="work_authorization" />
        <input type="password" name="password" />
        <button type="submit">Submit application</button>
      `),
    );

    expect(fields.some((field) => isSensitiveField(field))).toBe(true);
    const payload = toBatchFieldInputs(fields);
    const blob = JSON.stringify(payload).toLowerCase();
    expect(blob).not.toContain("ssn");
    expect(blob).not.toContain("social security");
    expect(blob).not.toContain("work authorization");
    expect(blob).not.toContain("password");
    expect(blob).not.toContain("submit");
    expect(payload.map((item) => item.label.toLowerCase()).join(" ")).toMatch(/name/);
    expect(payload.map((item) => item.label.toLowerCase()).join(" ")).toMatch(/email/);
    expect(fieldsEligibleForBatch(fields).every((field) => !isSensitiveField(field))).toBe(true);
  });

  it("keeps stable fieldIds when inventory order changes", () => {
    const first = inventoryFromDocument(
      documentFrom(`
        <input name="email" aria-label="Email" />
        <input name="full_name" aria-label="Full name" />
      `),
    );
    const second = inventoryFromDocument(
      documentFrom(`
        <input name="full_name" aria-label="Full name" />
        <input name="email" aria-label="Email" />
      `),
    );
    const a = toBatchFieldInputs(first);
    const b = toBatchFieldInputs(second);
    const emailA = a.find((item) => /email/i.test(item.label));
    const emailB = b.find((item) => /email/i.test(item.label));
    expect(emailA?.fieldId).toBe(emailB?.fieldId);
  });

  it("round-trips a simple multi-field form into batch JSON without submit controls", () => {
    const fields = inventoryFromDocument(
      documentFrom(`
        <form>
          <label for="name">Full name</label>
          <input id="name" name="full_name" required />
          <label for="about">Why us?</label>
          <textarea id="about" name="why"></textarea>
          <label>
            Track
            <select name="track">
              <option>Engineering</option>
              <option>Design</option>
            </select>
          </label>
          <button type="submit">Submit application</button>
        </form>
      `),
    );
    const payload = toBatchFieldInputs(fields);
    expect(payload.length).toBeGreaterThanOrEqual(3);
    expect(payload.every((item) => item.fieldId.startsWith("f_"))).toBe(true);
    expect(payload.some((item) => item.type === "textarea")).toBe(true);
    expect(payload.some((item) => item.type === "select")).toBe(true);
    expect(payload.find((item) => /submit/i.test(item.label))).toBeUndefined();
    expect(payload.find((item) => /full name/i.test(item.label))?.nearbyText).toBeTruthy();
  });

  it("does not include a fabricated DetectedField that looks like SSN", () => {
    const ssn: DetectedField = {
      key: "ssn",
      name: "ssn",
      id: "ssn",
      label: "Social security number",
      placeholder: "",
      ariaLabel: "Social security number",
      nearbyText: "",
      type: "text",
      inputType: "text",
      options: [],
      required: true,
      autocomplete: "",
      signals: "social security number ssn",
    };
    expect(toBatchFieldInputs([ssn])).toEqual([]);
  });

  it("keeps native date inputs as date instead of collapsing them to text", () => {
    const fields = inventoryFromDocument(
      documentFrom(`
        <label for="start">Start date</label>
        <input id="start" name="start_date" type="date" />
      `),
    );
    const payload = toBatchFieldInputs(fields);
    expect(payload.find((item) => /start/i.test(item.label))?.type).toBe("date");
  });
});
