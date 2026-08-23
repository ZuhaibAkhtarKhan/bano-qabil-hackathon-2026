import { PlatformCardIcon } from "@/components/marketing/platform-card-icon";
import { TextRevealHeading } from "@/components/marketing/text-reveal-heading";

function PlatformBullet() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      viewBox="0 0 11 10"
      className="platform-bullet"
      aria-hidden="true"
    >
      <path d="M7.333 2.445H3.664v4.889h3.669v2.443H0V0h7.333zm3.664 4.889H7.333V2.445h3.664z" />
    </svg>
  );
}

const pillars = [
  {
    title: "Application Memory",
    summary: "Your verified evidence — not a chat transcript.",
    points: ["Extract once, confirm yourself", "Versioned documents", "Nothing invented"],
    image:
      "https://cdn.sanity.io/images/53e5nsdy/production/bdcc5d8a70d9ccc5549bc509f1a239574f2e7f26-56x56.svg?w=128&q=85&auto=format",
    imageWidth: 56,
    imageHeight: 56,
  },
  {
    title: "Fit before effort",
    summary: "Every opportunity measured against your memory.",
    points: ["Eligibility, not vibes", "Resume matching", "Missing facts become questions"],
    image:
      "https://cdn.sanity.io/images/53e5nsdy/production/ee2e4a77dfbc473adcc74f1bdf2be39ea5d111bc-72x72.svg?w=144&q=85&auto=format",
    imageWidth: 72,
    imageHeight: 72,
  },
  {
    title: "Apply with control",
    summary: "Grounded drafts with explicit approval.",
    points: ["Evidence-cited answers", "Preview before fill", "CAPTCHA and paywalls untouched"],
    image:
      "https://cdn.sanity.io/images/53e5nsdy/production/36d14610fb53d0fcb9fa41544b7f7d01ef04fdaf-72x72.svg?w=144&q=85&auto=format",
    imageWidth: 72,
    imageHeight: 72,
  },
] as const;

function PlatformCard({ pillar }: { pillar: (typeof pillars)[number] }) {
  return (
    <article className="platform-card">
      <PlatformCardIcon src={pillar.image} width={pillar.imageWidth} height={pillar.imageHeight} />
      <div className="platform-card-text">
        <h3 className="platform-card-title">{pillar.title}</h3>
        <div className="platform-card-body">
          <p>
            <strong>{pillar.summary}</strong>
          </p>
          <ul className="platform-card-list">
            {pillar.points.map((point) => (
              <li key={point}>
                <PlatformBullet />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}

export function Pillars() {
  return (
    <section id="platform" className="pb-24 pt-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-muted">
          Platform
        </p>
        <TextRevealHeading className="mt-3 max-w-3xl">
          Create once. Analyze, match, generate, review, apply, remember.
        </TextRevealHeading>
      </div>

      <div className="platform-content mt-12">
        <ul className="platform-cards platform-cards-three platform-cards-desktop">
          {pillars.map((pillar) => (
            <li key={pillar.title}>
              <PlatformCard pillar={pillar} />
            </li>
          ))}
        </ul>

        <div className="platform-slider" aria-label="Platform capabilities">
          <ul className="platform-slider-track">
            {pillars.map((pillar) => (
              <li key={pillar.title} className="platform-slide">
                <PlatformCard pillar={pillar} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
