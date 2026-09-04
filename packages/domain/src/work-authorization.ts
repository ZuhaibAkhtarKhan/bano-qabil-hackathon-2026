/** Work-authorization / visa eligibility — applicant Yes must settle the requirement. */

export function isWorkAuthorizationRequirement(text: string): boolean {
  return /\b(visa|work authorization|authorized to work|right to work|citizenship|work permit|eligible to work|legally authorized)\b/i.test(
    text,
  );
}

export function isAffirmativeEligibilityAnswer(value: string): boolean {
  const n = value.trim().toLowerCase();
  if (!n) return false;
  if (/^(yes|y|yeah|yep|true|authorized|eligible)$/i.test(n)) return true;
  if (isNegativeEligibilityAnswer(n)) return false;
  return /\b(yes|authorized|legally authorized|i am (authorized|eligible)|eligible to work|no sponsorship (needed|required)|do not need sponsorship|don'?t need sponsorship|us citizen|u\.s\. citizen|american citizen|green card|permanent resident|\bead\b|h-?1b|\bopt\b|\bcpt\b)\b/i.test(
    n,
  );
}

export function isNegativeEligibilityAnswer(value: string): boolean {
  const n = value.trim().toLowerCase();
  if (!n) return false;
  if (/\b(no sponsorship|do not need sponsorship|don'?t need sponsorship|without sponsorship)\b/i.test(n)) {
    return false;
  }
  if (/^(no|n|false|unauthorized)$/i.test(n)) return true;
  return /\b(not authorized|unauthorized|cannot work|can'?t work|need(s)? (a )?(visa )?sponsorship|require(s)? (a )?(visa )?sponsorship|not eligible)\b/i.test(
    n,
  );
}

export type WorkAuthorizationVerdict = "met" | "not_met" | "unclear";

export function workAuthorizationMeetsRequirement(
  requirementText: string,
  authorization: string,
): WorkAuthorizationVerdict {
  const auth = authorization.trim();
  if (!auth) return "unclear";
  if (isNegativeEligibilityAnswer(auth)) return "not_met";
  if (isAffirmativeEligibilityAnswer(auth)) return "met";

  const req = requirementText.toLowerCase();
  const have = auth.toLowerCase();
  if (
    /\b(authorized|eligible to work|work authorization|us citizen|u\.s\. citizen|green card|permanent resident|h-?1b|\bopt\b|\bead\b)\b/i.test(
      have,
    )
  ) {
    return "met";
  }
  const reqGeo = /\b(united states|u\.s\.a?|usa|\bus\b)\b/i.test(req);
  const haveUs = /\b(united states|u\.s\.a?|usa|\bus\b|american)\b/i.test(have);
  if (reqGeo && haveUs) return "met";
  return "unclear";
}

/** Persist Yes against the live requirement so later re-evals keep a grounded kit value. */
export function expandAffirmativeAuthorizationValue(
  value: string,
  requirementOrLabel: string,
): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (!isAffirmativeEligibilityAnswer(trimmed)) return trimmed;
  const req = requirementOrLabel.trim();
  if (!isWorkAuthorizationRequirement(req)) return trimmed;
  if (isWorkAuthorizationRequirement(trimmed) && trimmed.length > 8) return trimmed;
  return `Yes — ${req}`;
}
