"use client";

import { useEffect, useRef, useState } from "react";

import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const plans = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "",
    detail: "No card required.",
    description: "Enough to prove the loop on real opportunities.",
    applications: "20",
    applicationsLabel: "applications",
    cta: "Start free",
    href: "/sign-up",
    featured: false,
  },
  {
    id: "focus",
    name: "Focus",
    price: "$4.99",
    period: "",
    detail: "One-time pack · 80 applies.",
    description: "For an active search without overbuying volume.",
    applications: "80",
    applicationsLabel: "applications",
    cta: "Get Focus",
    href: "/sign-up",
    featured: true,
    badge: "Most popular",
  },
  {
    id: "scale",
    name: "Scale",
    price: "$9.99",
    period: "",
    detail: "One-time pack · 200 applies.",
    description: "Hit every strong match before the window closes.",
    applications: "200",
    applicationsLabel: "applications",
    cta: "Go Scale",
    href: "/sign-up",
    featured: false,
  },
] as const;

const footnotes = [
  {
    title: "Cancel any time",
    body: "Stop when you’re done. No lock-in.",
  },
  {
    title: "20 free applications",
    body: "Try 1-Apply on the first 20 — no card required.",
  },
  {
    title: "Real applications",
    body: "Credits count against applies you actually run.",
  },
] as const;

export function Pricing() {
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -6% 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="pricing"
      className={cn("pricing-section bg-canvas px-5 py-24 sm:px-8", visible && "is-visible")}
    >
      <div className="mx-auto max-w-6xl">
        <div className="pricing-header max-w-xl">
          <h2 className="font-display text-3xl leading-tight tracking-tight text-ink sm:text-4xl">
            Pay for the applications. Not the tool.
          </h2>
          <p className="mt-3 text-base text-ink-muted">
            Every tier is the full product. Tiers differ only by volume.
          </p>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {plans.map((plan, index) => (
            <article
              key={plan.id}
              className={cn(
                "pricing-card relative flex flex-col rounded-2xl border p-6 sm:p-7",
                plan.featured
                  ? "pricing-card-featured border-ink bg-ink text-white shadow-[0_24px_60px_-28px_rgba(14,14,14,0.55)]"
                  : "border-line bg-white text-ink",
              )}
              style={{ ["--pricing-delay" as string]: `${120 + index * 110}ms` }}
            >
              {"badge" in plan && plan.badge ? (
                <p
                  className={cn(
                    "pricing-badge absolute right-5 top-5 inline-flex items-center gap-1.5 text-xs font-medium",
                    plan.featured ? "text-white/80" : "text-ink-muted",
                  )}
                >
                  <span className="pricing-badge-dot h-1.5 w-1.5 rounded-full bg-sand" aria-hidden="true" />
                  {plan.badge}
                </p>
              ) : null}

              <p className={cn("text-sm font-semibold", plan.featured ? "text-white" : "text-ink")}>
                {plan.name}
              </p>

              <p className="mt-4 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tracking-tight sm:text-5xl">{plan.price}</span>
                {plan.period ? (
                  <span className={cn("text-sm", plan.featured ? "text-white/60" : "text-ink-muted")}>
                    {plan.period}
                  </span>
                ) : null}
              </p>

              <p className={cn("mt-2 text-sm", plan.featured ? "text-white/65" : "text-ink-muted")}>
                {plan.detail}
              </p>
              <p className={cn("mt-4 text-sm leading-6", plan.featured ? "text-white/85" : "text-ink-muted")}>
                {plan.description}
              </p>

              <div className={cn("my-6 h-px w-full", plan.featured ? "bg-white/15" : "bg-line")} />

              <p className={cn("text-sm", plan.featured ? "text-white/75" : "text-ink-muted")}>You get</p>
              <p
                className={cn(
                  "pricing-apps mt-1 text-4xl font-semibold tracking-tight sm:text-5xl",
                  plan.featured ? "text-white" : "text-ink",
                )}
              >
                {plan.applications}
              </p>
              <p className={cn("mt-1 text-sm", plan.featured ? "text-white/75" : "text-ink-muted")}>
                {plan.applicationsLabel}.
              </p>

              <div className="mt-auto pt-8">
                <ButtonLink
                  href={plan.href}
                  variant={plan.featured ? "inverse" : "primary"}
                  size="lg"
                  className="pricing-cta w-full"
                >
                  {plan.cta}
                </ButtonLink>
              </div>
            </article>
          ))}
        </div>

        <div className="pricing-footnotes mt-4 overflow-hidden rounded-2xl border border-line bg-white">
          <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {footnotes.map((item) => (
              <div key={item.title} className="pricing-footnote px-5 py-5 sm:px-6">
                <p className="text-sm font-semibold text-ink">{item.title}</p>
                <p className="mt-1 text-sm text-ink-muted">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
