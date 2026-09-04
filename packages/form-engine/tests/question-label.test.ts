import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";

import {
  inventoryFromDocument,
  humanQuestionLabel,
  isNoiseFormField,
  mapFields,
  stripFormSyntaxDecorators,
} from "../src/index";

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

  it("does not treat reCAPTCHA challenge copy as an applicant question", () => {
    expect(
      isNoiseFormField({
        label: "Type the text you hear or see",
        nearbyText: "",
        ariaLabel: "Type the text you hear or see",
        placeholder: "",
        name: "audio-response",
        id: "audio-response",
        key: "audio-response",
        type: "text",
        inputType: "text",
      }),
    ).toBe(true);
  });

  it("does not inventory a recaptcha challenge field into the form", () => {
    const document = documentFrom(`
      <form>
        <div role="listitem">
          <div role="heading">Email or phone</div>
          <input type="text" aria-label="Email or phone" />
        </div>
        <div role="listitem">
          <div role="heading">Type the text you hear or see</div>
          <input id="audio-response" type="text" aria-label="Type the text you hear or see" />
        </div>
        <textarea name="g-recaptcha-response" class="g-recaptcha-response"></textarea>
      </form>
    `);
    const fields = inventoryFromDocument(document);
    expect(fields.map((field) => field.label).join(" ")).toMatch(/Email or phone/i);
    expect(fields.some((field) => /hear or see|recaptcha/i.test(field.label))).toBe(false);
    expect(fields.some((field) => /g-recaptcha-response/i.test(field.name))).toBe(false);
  });

  it("strips Swedish Obligatoriskt and other required chrome from labels", () => {
    expect(stripFormSyntaxDecorators("How long is your notice period?***Obligatoriskt***")).toBe(
      "How long is your notice period?",
    );
    expect(
      stripFormSyntaxDecorators("What is your current salary level & benefits?***Obligatoriskt***"),
    ).toBe("What is your current salary level & benefits?");
    expect(stripFormSyntaxDecorators("What's your monthly salary expectation?***Obligatoriskt***")).toBe(
      "What's your monthly salary expectation?",
    );
    expect(humanQuestionLabel({
      label: "How long is your notice period?***Obligatoriskt***",
      nearbyText: "",
      ariaLabel: "",
      placeholder: "",
      name: "notice",
      id: "notice",
      key: "notice",
    })).toBe("How long is your notice period?");
    expect(stripFormSyntaxDecorators("Email address *Required*")).toBe("Email address");
    expect(stripFormSyntaxDecorators("Phone (mandatory)")).toBe("Phone");
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
