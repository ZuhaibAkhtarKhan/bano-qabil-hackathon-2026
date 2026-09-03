import type { PageHazards } from "./types";

const CAPTCHA_SELECTORS = [
  ".g-recaptcha",
  ".h-captcha",
  ".cf-turnstile",
  "iframe[src*='recaptcha']",
  "iframe[src*='hcaptcha']",
  "iframe[src*='turnstile']",
  "iframe[src*='challenges.cloudflare.com']",
  "#captcha",
  "[data-captcha-widget]",
];

function isInvisibleOrBadgeCaptcha(node: Element): boolean {
  const el = node as HTMLElement;
  if (el.closest?.(".grecaptcha-badge, .h-captcha-badge")) return true;
  if (el.getAttribute?.("data-size") === "invisible") return true;
  const src = (el.getAttribute?.("src") ?? "").toLowerCase();
  if (src.includes("badge") || src.includes("/bframe") || /[?&]size=invisible\b/.test(src)) return true;
  return false;
}

function isVisibleCaptchaNode(node: Element | null | undefined): boolean {
  if (!node) return false;
  if (isInvisibleOrBadgeCaptcha(node)) return false;
  const el = node as HTMLElement & { disabled?: boolean };
  if (el.disabled) return false;
  if (typeof el.getBoundingClientRect !== "function") return true;
  try {
    const style = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
    if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) {
      return false;
    }
  } catch {
    // ignore — some test DOMs don't implement getComputedStyle fully
  }
  const rect = el.getBoundingClientRect();
  // Real browsers: require a painted box. Hidden/zero-size widgets are ignored.
  return rect.width > 2 && rect.height > 2;
}

export function detectCaptcha(root: ParentNode, pageText = ""): Pick<PageHazards, "captcha" | "captchaVendor" | "captchaMessage"> {
  // Require a visible challenge widget. Do not scan full HTML for the word "recaptcha"
  // — many forms (including Google Forms) embed inactive script strings and false-positive.
  const findVisible = (selector: string): Element | null => {
    const matches = root.querySelectorAll?.(selector);
    if (!matches) return null;
    for (const node of Array.from(matches)) {
      if (isVisibleCaptchaNode(node)) return node;
    }
    return null;
  };

  let vendor: string | null = null;
  if (findVisible(".g-recaptcha, iframe[src*='recaptcha']")) {
    vendor = "reCAPTCHA";
  } else if (findVisible(".h-captcha, iframe[src*='hcaptcha']")) {
    vendor = "hCaptcha";
  } else if (findVisible(".cf-turnstile, iframe[src*='turnstile'], iframe[src*='challenges.cloudflare.com']")) {
    vendor = "Cloudflare Turnstile";
  } else if (findVisible(CAPTCHA_SELECTORS.join(","))) {
    vendor = "CAPTCHA";
  } else if (/\bi'?m not a robot\b|\bverify you are (a )?human\b|\bcomplete the captcha\b/i.test(pageText)) {
    // Challenge copy only counts with a visible widget nearby.
    if (findVisible("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], iframe[src*='turnstile'], .g-recaptcha, .h-captcha, .cf-turnstile")) {
      vendor = "CAPTCHA";
    }
  }

  if (!vendor) {
    return { captcha: false, captchaVendor: null, captchaMessage: null };
  }

  return {
    captcha: true,
    captchaVendor: vendor,
    captchaMessage: `${vendor} detected. Autofill is paused for the challenge. Human action is required — 1-Apply never bypasses CAPTCHA. Nearby safe fields may still be filled after you approve them.`,
  };
}

export function detectAccountCreation(root: ParentNode, pageText = ""): Pick<PageHazards, "accountCreation" | "accountMessage"> {
  const text = `${pageText} ${root.textContent ?? ""}`.toLowerCase();
  const password = root.querySelector?.("input[type='password']");
  const email = root.querySelector?.("input[type='email'], input[name*='email' i]");
  const createCopy = /create (your )?account|sign up|register( now)?|join now|open an account/.test(text);
  if (password && email && createCopy) {
    return {
      accountCreation: true,
      accountMessage:
        "This page looks like account creation. 1-Apply will not create host accounts, fill passwords, or bypass account-security checks. Sign in or register yourself, then reopen the extension on the application form.",
    };
  }
  return { accountCreation: false, accountMessage: null };
}

export function detectUnsupportedForm(fields: { type: string }[], hazards: Pick<PageHazards, "captcha" | "accountCreation">): Pick<PageHazards, "unsupported" | "unsupportedReason"> {
  if (hazards.accountCreation) {
    return {
      unsupported: true,
      unsupportedReason: "Account creation cannot be automated. Continue manually after you have a host account.",
    };
  }
  const fillable = fields.filter((field) => field.type !== "file" && field.type !== "password");
  if (fillable.length === 0) {
    return {
      unsupported: true,
      unsupportedReason: "No standard fields could be mapped on this page. Continue the application manually in the host form.",
    };
  }
  return { unsupported: false, unsupportedReason: null };
}

export function inspectPage(root: ParentNode, pageText = "", fields: { type: string }[] = []): PageHazards {
  const captcha = detectCaptcha(root, pageText);
  const account = detectAccountCreation(root, pageText);
  const unsupported = detectUnsupportedForm(fields, { captcha: captcha.captcha, accountCreation: account.accountCreation });
  const hasSubmitControl = Boolean(
    root.querySelector?.("button[type='submit'], input[type='submit'], button[name*='submit' i], [role='button']"),
  );
  return {
    ...captcha,
    ...account,
    ...unsupported,
    hasSubmitControl,
  };
}
