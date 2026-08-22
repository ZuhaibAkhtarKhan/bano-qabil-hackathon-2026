import type { PageHazards } from "./types";

const CAPTCHA_SELECTORS = [
  ".g-recaptcha",
  ".h-captcha",
  ".cf-turnstile",
  "iframe[src*='recaptcha']",
  "iframe[src*='hcaptcha']",
  "iframe[src*='turnstile']",
  "[data-sitekey]",
  "#captcha",
  "[name='g-recaptcha-response']",
];

export function detectCaptcha(root: ParentNode, pageText = ""): Pick<PageHazards, "captcha" | "captchaVendor" | "captchaMessage"> {
  const html = `${pageText} ${"outerHTML" in root && typeof (root as Element).outerHTML === "string" ? (root as Element).outerHTML : ""}`.toLowerCase();
  let vendor: string | null = null;
  if (root.querySelector?.(".g-recaptcha, iframe[src*='recaptcha'], [name='g-recaptcha-response']") || /recaptcha/.test(html)) {
    vendor = "reCAPTCHA";
  } else if (root.querySelector?.(".h-captcha, iframe[src*='hcaptcha']") || /hcaptcha|h-captcha/.test(html)) {
    vendor = "hCaptcha";
  } else if (root.querySelector?.(".cf-turnstile, iframe[src*='turnstile']") || /turnstile/.test(html)) {
    vendor = "Cloudflare Turnstile";
  } else if (root.querySelector?.(CAPTCHA_SELECTORS.join(",")) || /\bi'?m not a robot\b/.test(html) || /\bcaptcha\b/.test(html)) {
    vendor = "CAPTCHA";
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
