export type GuideStep = {
  id: "kit" | "posting" | "packet" | "settings";
  title: string;
  body: string;
  href: string;
  cta: string;
  optional?: boolean;
};

export function nextGuideSteps(input: {
  kitMissing: string[];
  opportunityCount: number;
  applicationCount: number;
  needsYouCount: number;
  prepareAndSendIfSilent: boolean;
}): GuideStep[] {
  const steps: GuideStep[] = [];
  if (input.kitMissing.length > 0) {
    steps.push({
      id: "kit",
      title: "Finish your kit",
      body: `Missing: ${input.kitMissing.join(", ")}. Upload once, then every posting can reuse it.`,
      href: "/app/memory",
      cta: "Go to Your kit",
    });
  }
  if (input.opportunityCount === 0 && input.applicationCount === 0) {
    steps.push({
      id: "posting",
      title: "Add a posting",
      body: "Paste a URL only when you have one. This is not home — Dashboard is.",
      href: "/app/opportunities",
      cta: "Go add a posting",
    });
  }
  if (input.needsYouCount > 0) {
    steps.push({
      id: "packet",
      title: "Clear packets that need you",
      body:
        input.needsYouCount === 1
          ? "1 packet is missing facts, documents, or answers."
          : `${input.needsYouCount} packets are missing facts, documents, or answers.`,
      href: "/app/applications",
      cta: "Go to Applications",
    });
  }
  if (!input.prepareAndSendIfSilent && input.applicationCount > 0) {
    steps.push({
      id: "settings",
      title: "Optional: freeze at deadline if you stay silent",
      body: "Off by default. 1-Apply never clicks host Submit, CAPTCHA, signature, or payment.",
      href: "/app/settings",
      cta: "Go to Settings",
      optional: true,
    });
  }
  return steps;
}

export function currentGuideStep(steps: GuideStep[]): GuideStep | null {
  return steps.find((step) => !step.optional) ?? steps[0] ?? null;
}
