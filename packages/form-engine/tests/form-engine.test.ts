import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

import {
  assertFillActionAllowed,
  detectAccountCreation,
  detectCaptcha,
  deriveYearOfStudy,
  fillTargetAllowed,
  inspectPage,
  inventoryFromDocument,
  isAiAnswerableField,
  isProtectedControl,
  mapFields,
  planAutofill,
  proposedFillTargets,
  toHtmlDateValue,
  valueFitsNativeInput,
} from "../src/index";
import type { MemoryValue } from "../src/types";

const memory: MemoryValue[] = [
  { path: "Education → Institution", source: "Application Memory", value: "GIKI", aliases: ["university"] },
  { path: "Profile → GitHub", source: "Application Memory", value: "https://github.com/saadia", aliases: ["github"] },
  { path: "Profile → Full name", source: "Application Memory", value: "Saadia Asghar", aliases: ["name"] },
  { path: "Approved Application Answer", source: "Approved Application Answer", value: "I want to build retrieval systems.", aliases: ["why"] },
];

function stubVisibleBox(el: Element) {
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

function documentFrom(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  const document = window.document as unknown as ParentNode & {
    body: { innerText: string };
    textContent: string;
    documentElement: { outerHTML: string };
    querySelectorAll: Document["querySelectorAll"];
  };
  // happy-dom reports 0×0 boxes until layout; CAPTCHA detection requires a painted box.
  for (const el of Array.from(
    document.querySelectorAll(
      ".g-recaptcha, .h-captcha, .cf-turnstile, iframe[src*='recaptcha'], iframe[src*='hcaptcha'], iframe[src*='turnstile'], #captcha, [data-captcha-widget]",
    ),
  )) {
    stubVisibleBox(el);
  }
  return document;
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
    expect(
      isProtectedControl({
        name: "audio-response",
        label: "Type the text you hear or see",
        type: "text",
      }),
    ).toBe(true);
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
    expect(mapping?.aiAnswerable).toBe(true);
    expect(mapping?.proposedValue).toBe("");
    expect(mapping?.options.some((item) => item.value.includes("retrieval"))).toBe(true);
  });

  it("treats host-custom short prompts as AI-answerable", () => {
    const document = documentFrom(`
      <label for="share">Please share why this role interests you</label>
      <input id="share" name="share" />
    `);
    const [field] = inventoryFromDocument(document);
    expect(field).toBeTruthy();
    expect(isAiAnswerableField(field!)).toBe(true);
  });

  it("does not treat native date inputs as AI-answerable", () => {
    const document = documentFrom(`
      <label for="start">Start date</label>
      <input id="start" name="start_date" type="date" />
    `);
    const [field] = inventoryFromDocument(document);
    expect(field?.type).toBe("date");
    expect(isAiAnswerableField(field!)).toBe(false);
  });

  it("does not map weekday availability into a date input", () => {
    const catalog: MemoryValue[] = [
      { path: "Profile → Availability", source: "Application Memory", value: "Mon-Friday", aliases: ["available", "availability"] },
      { path: "Profile → Full name", source: "Application Memory", value: "Saadia Asghar", aliases: ["name"] },
    ];
    const document = documentFrom(`
      <label for="start">Start date</label>
      <input id="start" name="start_date" type="date" />
    `);
    const [mapping] = mapFields(inventoryFromDocument(document), catalog);
    expect(mapping?.fieldType).toBe("date");
    expect(mapping?.proposedValue).toBe("");
    expect(mapping?.aiAnswerable).toBe(false);
  });

  it("keeps ISO calendar dates for date inputs", () => {
    const catalog: MemoryValue[] = [
      { path: "Education → Graduation year", source: "Application Memory", value: "2024-06-15", aliases: ["graduation", "start date"] },
    ];
    const document = documentFrom(`
      <label for="grad">Graduation date</label>
      <input id="grad" name="graduation_date" type="date" />
    `);
    const [mapping] = mapFields(inventoryFromDocument(document), catalog);
    expect(mapping?.proposedValue).toBe("2024-06-15");
    expect(mapping?.aiAnswerable).toBe(false);
  });

  it("maps Microsoft-style degree+experience Yes/No radios from Application Memory", () => {
    const document = documentFrom(`
      <fieldset>
        <legend>Do you have bachelor's degree in construction project management, Architecture, Engineering, or related field AND 10+ years related experience OR equivalent experience?</legend>
        <label><input type="radio" name="q1" value="Yes" /> Yes</label>
        <label><input type="radio" name="q1" value="No" /> No</label>
      </fieldset>
    `);
    const catalog: MemoryValue[] = [
      {
        path: "Education → Institution",
        source: "Verified fact",
        value: "BS Architecture, National College of Arts",
        aliases: ["university", "degree"],
      },
      {
        path: "Evidence → Site engineer",
        source: "Evidence",
        value: "employment — Site engineer — 12 years construction project management experience",
        aliases: ["experience"],
      },
    ];
    const [mapping] = mapFields(inventoryFromDocument(document), catalog);
    expect(mapping?.fieldType).toBe("radio");
    expect(mapping?.proposedValue).toMatch(/yes/i);
    expect(mapping?.reason.toLowerCase()).toMatch(/memory|yes/);
    expect(mapping?.showChip).toBe(true);
  });

  it("does not autofill commitment Yes/No from kit skills containing the substring no", () => {
    const document = documentFrom(`
      <div role="listitem">
        <div role="heading" id="i33">This role needs 4-5 hours a day, part-time. Can you commit to that consistently?</div>
        <label><input type="radio" name="commit" value="Yes" /> Yes</label>
        <label><input type="radio" name="commit" value="No" /> No</label>
      </div>
      <div role="listitem">
        <div role="heading" id="i44">Are you currently a university student?</div>
        <label><input type="radio" name="student" value="Yes" /> Yes</label>
        <label><input type="radio" name="student" value="No" /> No</label>
      </div>
    `);
    const catalog: MemoryValue[] = [
      {
        path: "Skills → Kit",
        source: "Your kit",
        value: "Technology",
        aliases: ["skills"],
      },
      {
        path: "Skills → Kit",
        source: "Your kit",
        value: "Innovation",
        aliases: ["skills"],
      },
      {
        path: "Education → Institution",
        source: "Your kit",
        value: "NUST",
        aliases: ["university"],
      },
    ];
    const mappings = mapFields(inventoryFromDocument(document), catalog);
    const commit = mappings.find((item) => /commit/i.test(item.label));
    const student = mappings.find((item) => /student/i.test(item.label));
    expect(commit?.proposedValue || "").toBe("");
    expect(commit?.excludedByDefault).toBe(true);
    expect(student?.proposedValue || "").toBe("");
    expect(student?.excludedByDefault).toBe(true);
  });

  it("fills a commitment Yes/No from the matching Need You answer, not from kit No", () => {
    const document = documentFrom(`
      <div role="listitem">
        <div role="heading">This role needs 4-5 hours a day, part-time. Can you commit to that consistently?</div>
        <label><input type="radio" name="commit" value="Yes" /> Yes</label>
        <label><input type="radio" name="commit" value="No" /> No</label>
      </div>
    `);
    const catalog: MemoryValue[] = [
      {
        path: "Skills → Kit",
        source: "Your kit",
        value: "NoSQL",
        aliases: ["skills"],
      },
      {
        path: "Need You → Can you commit to that consistently",
        source: "Need You",
        value: "Yes",
        aliases: ["commit", "part-time"],
      },
    ];
    const [mapping] = mapFields(inventoryFromDocument(document), catalog);
    expect(mapping?.proposedValue).toBe("Yes");
    expect(mapping?.source).toBe("Need You");
    expect(mapping?.excludedByDefault).toBe(false);
  });

  it("auto-maps required sole confirmation checkboxes only", () => {
    const document = documentFrom(`
      <div role="listitem">
        <div>
          <div role="heading" id="email-h">Email</div>
          <span aria-label="Required">*</span>
        </div>
        <div role="checkbox" aria-label="Record zuhaib@example.com as the email to be included with my response" aria-checked="false">Record email</div>
      </div>
      <div role="listitem">
        <div role="heading">Optional newsletter</div>
        <div role="checkbox" aria-label="Subscribe to updates">Subscribe</div>
      </div>
      <div role="listitem">
        <div role="heading">Skills *</div>
        <div role="checkbox" aria-label="Python">Python</div>
        <div role="checkbox" aria-label="TypeScript">TypeScript</div>
      </div>
      <label><input type="checkbox" name="privacy" required /> I accept the privacy policy</label>
      <label><input type="checkbox" name="optional_marketing" /> Send me marketing emails</label>
    `);
    const fields = inventoryFromDocument(document);
    const emailField = fields.find((field) => /email/i.test(field.label) || /record/i.test(field.options.join(" ")));
    expect(emailField?.type).toBe("checkbox");
    expect(emailField?.required).toBe(true);

    const mappings = mapFields(fields, memory);
    const email = mappings.find((item) => /record|email/i.test(item.label) || /record/i.test(item.proposedValue));
    const privacy = mappings.find((item) => item.fieldKey === "privacy" || /privacy/i.test(item.label));
    const optional = mappings.find((item) => /newsletter|subscribe|marketing/i.test(item.label));
    const multi = mappings.find((item) => /skills/i.test(item.label));

    expect(email?.proposedValue).toBeTruthy();
    expect(email?.reason).toMatch(/required sole/i);
    expect(planAutofill([email!]).fill).toHaveLength(1);

    expect(privacy?.proposedValue).toBeTruthy();
    expect(privacy?.reason).toMatch(/required sole/i);

    expect(optional?.proposedValue || "").toBe("");
    expect(multi?.reason ?? "").not.toMatch(/required sole/i);
  });
});

describe("multi-choice memory matching", () => {
  it("selects university year from Application Memory synonyms", () => {
    const document = documentFrom(`
      <fieldset>
        <legend>Which year of university are you in?</legend>
        <label><input type="radio" name="year" value="Freshman" /> Freshman</label>
        <label><input type="radio" name="year" value="Sophomore" /> Sophomore</label>
        <label><input type="radio" name="year" value="Junior" /> Junior</label>
        <label><input type="radio" name="year" value="Senior" /> Senior</label>
      </fieldset>
    `);
    const catalog: MemoryValue[] = [
      {
        path: "Education → Year of study",
        source: "Application Memory",
        value: "3rd year",
        aliases: ["year of study", "which year"],
      },
    ];
    const [mapping] = mapFields(inventoryFromDocument(document), catalog);
    expect(mapping?.proposedValue).toMatch(/Junior/i);
    expect(mapping?.memoryPath).toMatch(/Year of study/i);
    expect(mapping?.options.length).toBe(4);
    expect(mapping?.showChip).toBe(true);
  });

  it("selects a Need You radio answer for the matching question", () => {
    const document = documentFrom(`
      <fieldset>
        <legend>Rate your communication skills</legend>
        <label><input type="radio" name="comm" value="Basic" /> Basic</label>
        <label><input type="radio" name="comm" value="Intermediate" /> Intermediate</label>
        <label><input type="radio" name="comm" value="Advanced" /> Advanced</label>
        <label><input type="radio" name="comm" value="Expert" /> Expert</label>
      </fieldset>
    `);
    const catalog: MemoryValue[] = [
      {
        path: "Need You → Rate your communication skills",
        source: "Need You",
        value: "Advanced",
        aliases: ["rate your communication skills", "communication"],
      },
    ];
    const [mapping] = mapFields(inventoryFromDocument(document), catalog);
    expect(mapping?.proposedValue).toBe("Advanced");
    expect(mapping?.source).toBe("Need You");
  });

  it("matches graduation year options against memory years", () => {
    const document = documentFrom(`
      <label>Expected graduation year
        <select name="grad">
          <option>2025</option>
          <option>2026</option>
          <option>2027</option>
          <option>2028</option>
        </select>
      </label>
    `);
    const catalog: MemoryValue[] = [
      {
        path: "Education → Graduation year",
        source: "Evidence",
        value: "Expected graduation 2027",
        aliases: ["graduation"],
      },
    ];
    const [mapping] = mapFields(inventoryFromDocument(document), catalog);
    expect(mapping?.proposedValue).toBe("2027");
  });

  it("derives 1st/2nd/3rd year from enrollment range and fills college", () => {
    const document = documentFrom(`
      <label>College * <input name="college" /></label>
      <fieldset>
        <legend>Year *</legend>
        <label><input type="radio" name="year" value="1st" /> 1st</label>
        <label><input type="radio" name="year" value="2nd" /> 2nd</label>
        <label><input type="radio" name="year" value="3rd" /> 3rd</label>
        <label><input type="radio" name="year" value="4th" /> 4th</label>
        <label><input type="radio" name="year" value="Graduated/Post Graduated" /> Graduated/Post Graduated</label>
      </fieldset>
    `);
    const derived = deriveYearOfStudy([2024, 2028], new Date("2026-08-22T12:00:00Z"));
    expect(derived).toBe("3rd year");

    const catalog: MemoryValue[] = [
      {
        path: "Education → Institution",
        source: "Evidence",
        value: "GIKI",
        aliases: ["university", "college"],
      },
      {
        path: "Education → Year of study",
        source: "Evidence",
        value: derived!,
        aliases: ["year", "year of study"],
      },
      {
        path: "Evidence → BS",
        source: "Evidence",
        value: "education — BS Computer Engineering — GIKI — 2024 — 2028",
        aliases: ["education", "years"],
      },
    ];
    const mappings = mapFields(inventoryFromDocument(document), catalog);
    const college = mappings.find((item) => /college/i.test(item.label));
    const year = mappings.find((item) => item.fieldType === "radio" || /^year/i.test(item.label));
    expect(college?.proposedValue).toBe("GIKI");
    expect(college?.aiAnswerable).toBe(false);
    expect(year?.proposedValue).toBe("3rd");
    expect(year?.aiAnswerable).toBe(false);
  });

  it("formats WhatsApp as 10 digits without country code", () => {
    const document = documentFrom(`
      <label>Whatsapp Number [Kindly write the 10 digit number without spacing and without country code, for ex- 48575XXXXX]
        <input name="wa" />
      </label>
    `);
    const catalog: MemoryValue[] = [
      {
        path: "Profile → Phone",
        source: "Profile",
        value: "+92 300 1234567",
        aliases: ["phone", "whatsapp"],
      },
    ];
    const [mapping] = mapFields(inventoryFromDocument(document), catalog);
    expect(mapping?.aiAnswerable).toBe(false);
    expect(mapping?.proposedValue).toBe("3001234567");
  });

  it("fills LinkedIn for writing-sample link fields and keeps AI popups for open questions", () => {
    const document = documentFrom(`
      <label>Link to a writing or editing sample (Drive link, published piece, or any prior work) *
        <input name="sample" />
      </label>
      <label>Practical exercise. Read the passage below and respond as you would if reviewing it. Rewrite the flagged portion so it would pass. *
        <textarea name="exercise"></textarea>
      </label>
      <label>College * <input name="college" /></label>
    `);
    const catalog: MemoryValue[] = [
      {
        path: "Profile → LinkedIn",
        source: "Profile",
        value: "https://linkedin.com/in/saadia",
        aliases: ["linkedin", "link"],
      },
      {
        path: "Education → Institution",
        source: "Evidence",
        value: "GIKI",
        aliases: ["college", "university"],
      },
    ];
    const mappings = mapFields(inventoryFromDocument(document), catalog);
    const link = mappings.find((item) => /writing or editing sample|sample/i.test(item.label));
    const exercise = mappings.find((item) => /practical exercise|rewrite/i.test(item.label));
    const college = mappings.find((item) => /college/i.test(item.label));
    expect(link?.proposedValue).toContain("linkedin.com");
    expect(link?.aiAnswerable).toBe(false);
    expect(exercise?.aiAnswerable).toBe(true);
    expect(exercise?.showChip).toBe(true);
    expect(college?.proposedValue).toBe("GIKI");
  });
});

describe("field length limits", () => {
  it("detects word and character limits from labels and maxlength", async () => {
    const { detectFieldLengthLimit, enforceFieldLengthLimit } = await import("../src/field-limits");
    const document = documentFrom(`
      <label>Essay (max 120 words)<textarea maxlength="800"></textarea></label>
    `);
    const area = document.querySelector("textarea")!;
    const fromMax = detectFieldLengthLimit(area, "Essay (max 120 words)", "");
    // maxlength wins when present on the control
    expect(fromMax?.unit).toBe("characters");
    expect(fromMax?.value).toBe(800);

    const wordOnly = detectFieldLengthLimit(
      documentFrom(`<div role="listitem"><div role="heading">Why us? Limit 150 words</div><textarea></textarea></div>`).querySelector("textarea")!,
      "Why us? Limit 150 words",
      "",
    );
    expect(wordOnly).toEqual({ value: 150, unit: "words", source: "label" });

    expect(enforceFieldLengthLimit("one two three four five", { value: 3, unit: "words", source: "label" })).toBe("one two three");
  });
});

describe("native HTML date values", () => {
  it("accepts calendar dates and rejects availability text and essays", () => {
    expect(toHtmlDateValue("2024-09-01")).toBe("2024-09-01");
    expect(toHtmlDateValue("Mon-Friday")).toBeNull();
    expect(
      toHtmlDateValue(
        "I do not have specific information regarding an end date for my current or previous positions.",
      ),
    ).toBeNull();
    expect(valueFitsNativeInput("Mon-Friday", "date")).toBe(false);
    expect(valueFitsNativeInput("2024-09-01", "date")).toBe(true);
    expect(valueFitsNativeInput("not a number", "number")).toBe(false);
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

  it("does not treat script/HTML mentions of recaptcha as a CAPTCHA wall", () => {
    const document = documentFrom(`
      <form><input name="name" /><button type="submit">Submit</button></form>
      <script>window.__X = "recaptcha hcaptcha turnstile captcha";</script>
      <textarea name="g-recaptcha-response" style="display:none"></textarea>
      <div class="grecaptcha-badge"><iframe src="https://www.google.com/recaptcha/api2/anchor?k=badge"></iframe></div>
    `);
    const result = detectCaptcha(document, "Submit your application");
    expect(result.captcha).toBe(false);
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
  it("fills safe mapped fields automatically without approval checkboxes", () => {
    const document = documentFrom(`
      <label for="university">University</label>
      <input id="university" name="university" />
      <input type="submit" name="commit" value="Submit" />
      <textarea name="g-recaptcha-response"></textarea>
    `);
    const fields = inventoryFromDocument(document);
    const mappings = mapFields(fields, memory);
    const plan = planAutofill(mappings);
    expect(plan.fill).toHaveLength(1);
    expect(plan.fill[0]?.proposedValue).toBe("GIKI");
    expect(plan.fill[0]?.options?.[0]?.value).toBe("GIKI");
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
