import { logError, logInfo } from "@/lib/log";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type SendEmailResult =
  | { ok: true; providerId: string | null }
  | { ok: false; reason: string };

function emailFromAddress(): string {
  return process.env.EMAIL_FROM?.trim() || "1-Apply <onboarding@resend.dev>";
}

/** Sends transactional email via Resend when RESEND_API_KEY is configured. */
export async function sendTransactionalEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey || apiKey.startsWith("replace-with")) {
    return { ok: false, reason: "email_not_configured" };
  }

  const to = input.to.trim();
  if (!to) return { ok: false, reason: "missing_recipient" };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFromAddress(),
        to: [to],
        subject: input.subject,
        html: input.html,
        text: input.text ?? input.subject,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok) {
      logError("email.resend_failed", { status: response.status, message: payload.message ?? "unknown" });
      return { ok: false, reason: payload.message ?? `http_${response.status}` };
    }

    logInfo("email.sent", { to, subject: input.subject.slice(0, 80), providerId: payload.id ?? null });
    return { ok: true, providerId: payload.id ?? null };
  } catch (err) {
    logError("email.resend_exception", { err });
    return { ok: false, reason: err instanceof Error ? err.message : "send_failed" };
  }
}
