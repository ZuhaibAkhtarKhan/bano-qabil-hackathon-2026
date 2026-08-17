import { describe, expect, it } from "vitest";

import { isProtectedControl, proposedFillTargets } from "../src/index";

describe("form engine", () => {
  it("never treats submit, captcha, signature, or payment as fillable", () => {
    const fields = [
      { name: "full_name", label: "Full name", type: "text" },
      { name: "submit", label: "Submit application", type: "submit" },
      { name: "g-recaptcha-response", label: "Captcha", type: "textarea" },
      { name: "signature", label: "Sign here", type: "text" },
      { name: "card", label: "Payment card", type: "text" },
    ];
    expect(proposedFillTargets(fields).map((field) => field.name)).toEqual(["full_name"]);
    expect(isProtectedControl(fields[1]!)).toBe(true);
  });
});
