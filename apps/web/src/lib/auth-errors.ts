const MESSAGES: Record<string, string> = {
  "invalid login credentials": "Email or password is incorrect.",
  "email not confirmed": "Confirm your email from the message we sent, then sign in.",
  "user already registered": "An account with that email already exists. Sign in instead.",
  "password should be at least 6 characters": "Use a password with at least 8 characters.",
  "password should be at least 8 characters": "Use a password with at least 8 characters.",
  "unable to validate email address: invalid format": "Enter a valid email address.",
  "signup is disabled": "New accounts are not being accepted on this environment.",
  otp_expired: "That email link is invalid or has expired. Request a new one.",
  access_denied: "That email link is invalid or has expired. Request a new one.",
  callback: "Could not finish signing in. Request a new email link.",
  "not-configured":
    "Connect Supabase with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable accounts.",
  over_email_send_rate_limit: "Too many emails were sent. Wait a minute and try again.",
  unexpected_failure: "We couldn't send the confirmation email. Check Supabase SMTP settings (see supabase/email-templates/README.md).",
  "error sending confirmation email":
    "We couldn't send the confirmation email. Turn off Custom SMTP in Supabase, or fix SMTP credentials (username must be `resend`, password = API key).",
  "new password should be different from the old password": "Choose a password you have not used on this account.",
};

export function mapAuthError(input: { message?: string | null; code?: string | null } | string | null | undefined): string {
  if (!input) return "Authentication failed.";
  const message = typeof input === "string" ? input : input.message ?? "";
  const code = typeof input === "string" ? "" : input.code ?? "";
  const key = (code || message).trim().toLowerCase();
  if (MESSAGES[key]) return MESSAGES[key];
  const fromMessage = MESSAGES[message.trim().toLowerCase()];
  if (fromMessage) return fromMessage;
  if (key.includes("expired") || key.includes("otp")) {
    return MESSAGES.otp_expired ?? "That email link is invalid or has expired. Request a new one.";
  }
  if (message.trim()) return message;
  return "Authentication failed.";
}

export function authErrorFromSearchParams(params: { error?: string | null; reason?: string | null; error_code?: string | null }): string | null {
  const mapped = mapAuthError({
    message: params.error ?? params.reason,
    code: params.error_code ?? params.error ?? params.reason,
  });
  return mapped === "Authentication failed." ? null : mapped;
}

export function safeNextPath(value: string | null | undefined, fallback = "/app") {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("://")) {
    return fallback;
  }
  return value;
}

export function safeOnboardingReturn(value: FormDataEntryValue | null) {
  const raw = String(value ?? "");
  if (
    raw === "/app/onboarding/documents" ||
    raw === "/app/onboarding/review" ||
    raw === "/app/onboarding/profile"
  ) {
    return raw;
  }
  return null;
}
