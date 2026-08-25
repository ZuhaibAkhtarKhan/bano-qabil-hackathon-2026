import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";

import { inventoryFromDocument, humanQuestionLabel, isNoiseFormField, mapFields } from "../src/index";

function documentFrom(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document as unknown as ParentNode;
}

describe("human question labels", () => {
  it("prefers visible question text over machine ids", () => {
    const label = humanQuestionLabel({
      label: "",
      nearbyText: "What is your LinkedIn profile URL?",
      ariaLabel: "",
      placeholder: "",
      name: "69bad32a1223071317820e44",
      id: "69bad32a1223071317820e44",
      key: "69bad32a1223071317820e44",
    });
    expect(label).toMatch(/LinkedIn/i);
  });

  it("does not treat share-link widgets as applicant questions", () => {
    expect(
      isNoiseFormField({
        label: "share-link",
        nearbyText: "",
        ariaLabel: "",
        placeholder: "",
        name: "share-link",
        id: "share-link",
        key: "share-link",
        type: "text",
        inputType: "text",
      }),
    ).toBe(true);
  });

  it("reads question text from a preceding sibling, not the input name", () => {
    const document = documentFrom(`
      <form>
        <div class="question">
          <p>Tell us why you want to join this fellowship</p>
          <input name="69bad32a1223071317820e44" type="text" />
        </div>
        <input name="share-link" type="text" />
      </form>
    `);
    const fields = inventoryFromDocument(document);
    const why = fields.find((field) => /fellowship|why/i.test(field.label));
    expect(why).toBeTruthy();
    expect(why?.label).not.toMatch(/69bad/i);

    const mappings = mapFields(fields, []);
    expect(mappings.every((item) => !/^[a-f0-9]{16,}$/i.test(item.label))).toBe(true);
    expect(mappings.some((item) => /share-link/i.test(item.fieldKey))).toBe(false);
  });
});
