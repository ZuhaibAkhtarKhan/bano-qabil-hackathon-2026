"use client";

import { useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };

export function LandingCursor() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<Point[]>([]);
  const mouseRef = useRef<Point | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setEnabled(fine && !reduce);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onMove = (event: PointerEvent) => {
      mouseRef.current = { x: event.clientX, y: event.clientY };
      const points = pointsRef.current;
      const last = points[points.length - 1];
      if (!last || Math.hypot(last.x - event.clientX, last.y - event.clientY) > 10) {
        points.push({ x: event.clientX, y: event.clientY });
        if (points.length > 14) points.shift();
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const points = pointsRef.current;

      if (points.length > 1) {
        if (points.length > 2) {
          ctx.beginPath();
          ctx.moveTo(points[0]!.x, points[0]!.y);
          for (let i = 1; i < points.length; i += 1) {
            ctx.lineTo(points[i]!.x, points[i]!.y);
          }
          ctx.strokeStyle = "rgba(14, 14, 14, 0.12)";
          ctx.lineWidth = 1;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.stroke();
        }

        // Soft idle decay
        if (points.length > 2) points.shift();
      }

      const mouse = mouseRef.current;
      if (mouse) {
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(14, 14, 14, 0.45)";
        ctx.fill();
      }

      frame = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[60]"
      aria-hidden="true"
    />
  );
}
