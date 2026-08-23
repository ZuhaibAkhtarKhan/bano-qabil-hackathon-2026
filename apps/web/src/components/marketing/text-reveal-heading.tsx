"use client";

import { useEffect, useRef, useState, type ElementType } from "react";

import { cn } from "@/lib/cn";

type TextRevealTone = "light" | "dark";

type TextRevealHeadingProps = {
  as?: ElementType;
  className?: string;
  tone?: TextRevealTone;
  children: string;
};

function splitTokens(text: string) {
  return text.split(/(\s+)/).filter((part) => part.length > 0);
}

export function TextRevealHeading({
  as: Tag = "h2",
  className,
  tone = "light",
  children,
}: TextRevealHeadingProps) {
  const ref = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(false);
  const tokens = splitTokens(children);
  let wordIndex = 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setRevealed(true);
        observer.disconnect();
      },
      { threshold: 0.5 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const content = tokens.map((token, index) => {
    if (/^\s+$/.test(token)) {
      return token;
    }

    const delayIndex = wordIndex;
    wordIndex += 1;

    return (
      <span
        key={`${token}-${index}`}
        className="text-reveal-word"
        style={{ ["--reveal-delay" as string]: `${delayIndex * 100}ms` }}
        aria-hidden="true"
      >
        {token}
        <span className="text-reveal-mask" />
      </span>
    );
  });

  return (
    <Tag
      ref={ref as never}
      className={cn(
        "text-reveal-heading",
        tone === "dark" && "text-reveal-heading--dark",
        revealed && "text-reveal-heading--revealed",
        className,
      )}
    >
      <span className="sr-only">{children}</span>
      <span aria-hidden="true">{content}</span>
    </Tag>
  );
}
