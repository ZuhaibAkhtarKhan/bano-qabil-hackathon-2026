import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

import {
  classifyActionControl,
  findPrimaryStepAdvance,
  findStepAdvanceControls,
  isStepAdvanceControl,
} from "../src/step-controls";

function documentFrom(html: string): Document {
  const window = new Window();
  window.document.body.innerHTML = html;
  const doc = window.document as unknown as Document;
  // happy-dom reports 0×0 boxes until layout; treat controls as visible for classification tests.
  for (const el of Array.from(doc.querySelectorAll("button, a, [role='button']"))) {
    (el as HTMLElement).getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 10,
        left: 10,
        bottom: 50,
        right: 120,
        width: 110,
        height: 40,
        toJSON() {
          return {};
        },
      }) as DOMRect;
  }
  return doc;
}

describe("step advance controls", () => {
  it("classifies Next / Continue as next and Submit application as submit", () => {
    const doc = documentFrom(`
      <button type="button">Next</button>
      <button type="button">Save and continue</button>
      <button type="submit">Submit application</button>
      <button type="button">Pay now</button>
    `);
    const [next, cont, submit, pay] = Array.from(doc.querySelectorAll("button"));
    expect(classifyActionControl(next!)).toBe("next");
    expect(classifyActionControl(cont!)).toBe("next");
    expect(classifyActionControl(submit!)).toBe("submit");
    expect(classifyActionControl(pay!)).toBe("submit");
  });

  it("finds primary Next without returning Submit", () => {
    const doc = documentFrom(`
      <button type="button">Back</button>
      <button type="button" class="btn-next">Next</button>
      <button type="submit">Submit application</button>
    `);
    const primary = findPrimaryStepAdvance(doc);
    expect(primary?.textContent?.trim()).toBe("Next");
    expect(findStepAdvanceControls(doc)).toHaveLength(1);
    expect(isStepAdvanceControl(doc.querySelector(".btn-next"))).toBe(true);
    expect(isStepAdvanceControl(doc.querySelector('button[type="submit"]'))).toBe(false);
  });

  it("allows clickNext and clickSubmit only when host submit is enabled", async () => {
    const { assertFillActionAllowed, isForbiddenFillAction } = await import("../src/index");
    expect(isForbiddenFillAction("clickNext")).toBe(false);
    expect(() => assertFillActionAllowed("clickNext")).not.toThrow();
    expect(isForbiddenFillAction("clickSubmit")).toBe(true);
    expect(isForbiddenFillAction("clickSubmit", { hostSubmitAllowed: true })).toBe(false);
    expect(() => assertFillActionAllowed("clickSubmit", { hostSubmitAllowed: true })).not.toThrow();
  });
});
