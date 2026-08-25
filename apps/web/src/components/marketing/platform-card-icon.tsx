"use client";

import { useEffect, useRef } from "react";

import { pixelReveal } from "@/lib/pixel-reveal";

type PlatformCardIconProps = {
  src: string;
  width: number;
  height: number;
};

export function PlatformCardIcon({ src, width, height }: PlatformCardIconProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const triggeredRef = useRef(false);
  const cancelRevealRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      img.classList.add("platform-card-img--revealed");
      return;
    }

    let loaded = img.complete && img.naturalWidth > 0;

    const runReveal = () => {
      if (triggeredRef.current || !loaded) return;
      triggeredRef.current = true;
      cancelRevealRef.current = pixelReveal(img, {
        type: "reveal",
        onComplete: () => {
          img.classList.add("platform-card-img--revealed");
        },
      });
    };

    const onLoad = () => {
      loaded = true;
      runReveal();
    };

    if (!loaded) {
      img.addEventListener("load", onLoad, { once: true });
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        runReveal();
        observer.disconnect();
      },
      { threshold: 0 },
    );

    observer.observe(img);

    return () => {
      img.removeEventListener("load", onLoad);
      observer.disconnect();
      cancelRevealRef.current?.();
    };
  }, [src]);

  return (
    <figure className="platform-card-image">
      {/* eslint-disable-next-line @next/next/no-img-element -- external Sanity CDN icons */}
      <img
        ref={imgRef}
        src={src}
        alt=""
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className="platform-card-img"
      />
    </figure>
  );
}
