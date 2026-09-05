/**
 * Google Forms POSTs both Next and Submit to /formResponse.
 * An empty (or still-loading) response URL is not a recorded answer.
 * Keep in sync with detectSubmissionConfirmation in playwright-form-dom.ts.
 */
export function isHostSubmissionConfirmed(input: {
  href: string;
  pageText: string;
  confirmationMessage?: string;
  headingText?: string;
}): boolean {
  const text = input.pageText.replace(/\s+/g, " ").trim();
  const href = input.href.toLowerCase();

  if (/your response has been recorded|response has been recorded|تم تسجيل إجابتك/i.test(text)) {
    return true;
  }
  if ((input.confirmationMessage ?? "").trim().length > 0) return true;

  const headingText = (input.headingText ?? "").replace(/\s+/g, " ").trim();
  if (headingText && /recorded|thank you|submitted/i.test(headingText)) return true;

  if (/submit another response|submit another form/i.test(text) && /formresponse/.test(href)) {
    return true;
  }

  return false;
}
