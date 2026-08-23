type LogoSize = "sm" | "md" | "lg";

const logos: { src: string; alt: string; size?: LogoSize }[] = [
  { src: "/infinite-logos/10P-Logo.svg", alt: "10Pearls" },
  { src: "/infinite-logos/bano-qabil.svg", alt: "Bano Qabil", size: "lg" },
  { src: "/infinite-logos/Google_2015_logo.webp", alt: "Google" },
  { src: "/infinite-logos/Microsoft_icon.webp", alt: "Microsoft" },
  { src: "/infinite-logos/Oracle_logo.webp", alt: "Oracle", size: "sm" },
  { src: "/infinite-logos/Salesforce.com_logo.webp", alt: "Salesforce", size: "lg" },
  { src: "/infinite-logos/netsol@logotyp.us.svg", alt: "NetSol", size: "lg" },
  { src: "/infinite-logos/nust-logo-png_seeklogo-234117.svg", alt: "NUST", size: "lg" },
  {
    src: "/infinite-logos/higher-education-commission-pakistan-logo-png_seeklogo-275152.svg",
    alt: "Higher Education Commission",
    size: "lg",
  },
  { src: "/infinite-logos/idGi9qvM_H_logos.svg", alt: "Systems Limited" },
  { src: "/infinite-logos/id-n8-Zwt2_logos.svg", alt: "Partner", size: "lg" },
  { src: "/infinite-logos/idnF5R9kg7_1787418919731.svg", alt: "Partner" },
  { src: "/infinite-logos/idutFJLsLZ_1787418668539.svg", alt: "Partner" },
  { src: "/infinite-logos/idFJwVRy6__logos.svg", alt: "Partner", size: "lg" },
];

export function CategoryMarquee() {
  const items = [...logos, ...logos];

  return (
    <section className="logo-marquee border-y border-line py-10 pb-16" aria-labelledby="logo-marquee-heading">
      <p
        id="logo-marquee-heading"
        className="mb-10 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-muted"
      >
        One memory across every application
      </p>
      <div className="logo-marquee-viewport overflow-hidden">
        <div className="marquee-track logo-marquee-track flex w-max items-center gap-14 px-8 sm:gap-16">
          {items.map((logo, index) => (
            <span
              key={`${logo.src}-${index}`}
              className="logo-marquee-item inline-flex shrink-0 items-center justify-center"
              data-size={logo.size ?? "md"}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static public brand marks */}
              <img
                src={logo.src}
                alt={logo.alt}
                className="logo-marquee-img"
                draggable={false}
              />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
