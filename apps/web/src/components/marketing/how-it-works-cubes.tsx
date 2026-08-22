"use client";

import { useEffect, useRef } from "react";
import {
  BoxGeometry,
  CanvasTexture,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";

const BOX_SIZE = 1.05;
const BOX_DEPTH = 1.05;
const PHASES = 4;
const MAX_BOXES = 3;
const TEX_SIZE = 512;
const Z_START = -1.8;
const Z_END = 3.5;
const FADE_IN_START = 0.05;
const FADE_IN_END = 0.28;
const STEP = 1 / (PHASES + 1);
const GROUP_SCALE = 1;

const LAYOUT_A: [number, number, number][] = [
  [-0.95, 0.75, 0.1],
  [0.9, 0.42, -0.18],
  [-0.62, -0.75, 0.22],
];

const LAYOUT_B: [number, number, number][] = [
  [0.14, 0.9, 0.08],
  [-0.95, -0.75, -0.18],
  [0.9, -0.62, 0.2],
];

type FaceMotif = "rings" | "ovals" | "nodes" | "checks";

type CubeFace = {
  accent: string;
  accentSoft: string;
  title: string;
  chip: string;
  motif: FaceMotif;
};

const PHASE_FACES: CubeFace[][] = [
  [
    { accent: "#98a5ef", accentSoft: "rgba(152,165,239,0.22)", title: "Identity", chip: "Verified", motif: "rings" },
    { accent: "#98a5ef", accentSoft: "rgba(152,165,239,0.18)", title: "Evidence", chip: "Source-linked", motif: "ovals" },
    { accent: "#98a5ef", accentSoft: "rgba(152,165,239,0.2)", title: "Memory", chip: "Reusable", motif: "nodes" },
  ],
  [
    { accent: "#5adeb7", accentSoft: "rgba(90,222,183,0.22)", title: "Intake", chip: "URL / Ext", motif: "ovals" },
    { accent: "#5adeb7", accentSoft: "rgba(90,222,183,0.18)", title: "Fit Index", chip: "Gaps listed", motif: "rings" },
    { accent: "#5adeb7", accentSoft: "rgba(90,222,183,0.2)", title: "Requirements", chip: "Extracted", motif: "checks" },
  ],
  [
    { accent: "#e69393", accentSoft: "rgba(230,147,147,0.22)", title: "RAG Draft", chip: "Cited", motif: "nodes" },
    { accent: "#e69393", accentSoft: "rgba(230,147,147,0.18)", title: "Unknowns", chip: "Review", motif: "rings" },
    { accent: "#e69393", accentSoft: "rgba(230,147,147,0.2)", title: "Grounded", chip: "No invent", motif: "ovals" },
  ],
  [
    { accent: "#eadc8f", accentSoft: "rgba(234,220,143,0.22)", title: "Approve", chip: "You decide", motif: "checks" },
    { accent: "#eadc8f", accentSoft: "rgba(234,220,143,0.18)", title: "Audit", chip: "Full trail", motif: "rings" },
    { accent: "#eadc8f", accentSoft: "rgba(234,220,143,0.2)", title: "Safe fill", chip: "Not submit", motif: "ovals" },
  ],
];

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function mapRange(value: number, inMin: number, inMax: number, outMin: number, outMax: number) {
  const t = clamp01((value - inMin) / (inMax - inMin));
  return outMin + (outMax - outMin) * t;
}

function pickLayout(phase: number): [number, number, number][] {
  return phase % 2 === 0 ? LAYOUT_A : LAYOUT_B;
}

function outwardPositions(raw: [number, number, number][]): [number, number, number][] {
  const half = BOX_SIZE / 2;
  return raw.map(([x, y, z]) => {
    const len = Math.hypot(x, y);
    if (len === 0) return [x, y, z];
    const nx = x / len;
    const ny = y / len;
    const extent = Math.abs(nx) * half + Math.abs(ny) * half;
    const dist = len + extent * 0.35;
    return [nx * dist, ny * dist, z];
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  face: CubeFace,
  time: number,
  variant: number,
) {
  const s = TEX_SIZE;
  const cx = s / 2;
  const cy = s / 2;
  const pulse = 0.5 + 0.5 * Math.sin(time * 1.4 + variant * 1.1);

  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = "#121212";
  ctx.fillRect(0, 0, s, s);

  // Soft vignette
  const glow = ctx.createRadialGradient(cx, cy, 20, cx, cy, s * 0.62);
  glow.addColorStop(0, face.accentSoft);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, s, s);

  ctx.strokeStyle = face.accent;
  ctx.lineWidth = 2;

  if (face.motif === "rings") {
    for (let i = 0; i < 4; i += 1) {
      const radius = 58 + i * 42 + pulse * 10;
      ctx.globalAlpha = 0.22 + i * 0.12;
      ctx.beginPath();
      ctx.arc(cx, cy - 18, radius, Math.PI * 0.12, Math.PI * 1.88);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.ellipse(cx + 70, cy + 78, 54 + pulse * 6, 28, -0.35, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (face.motif === "ovals") {
    const ovals = [
      [cx - 70, cy - 40, 70, 36, -0.4],
      [cx + 40, cy - 10, 86, 40, 0.25],
      [cx - 20, cy + 55, 96, 34, -0.1],
    ] as const;
    ovals.forEach(([x, y, rx, ry, rot], i) => {
      ctx.globalAlpha = 0.35 + i * 0.15;
      ctx.beginPath();
      ctx.ellipse(x, y, rx + pulse * 4, ry, rot, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = face.accent;
      ctx.fill();
    });
  }

  if (face.motif === "nodes") {
    const nodes = [
      [cx - 90, cy - 50],
      [cx + 20, cy - 80],
      [cx + 95, cy - 10],
      [cx - 30, cy + 40],
      [cx + 55, cy + 70],
      [cx - 100, cy + 75],
    ] as const;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    nodes.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    nodes.forEach(([x, y], i) => {
      ctx.globalAlpha = 0.55 + (i % 3) * 0.15;
      ctx.beginPath();
      ctx.arc(x, y, 7 + (i === variant % nodes.length ? pulse * 4 : 0), 0, Math.PI * 2);
      ctx.fillStyle = face.accent;
      ctx.fill();
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.ellipse(x, y, 22, 12, 0.4, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  if (face.motif === "checks") {
    for (let i = 0; i < 3; i += 1) {
      const y = 150 + i * 78;
      ctx.globalAlpha = 0.25 + i * 0.15;
      roundRect(ctx, 86, y, s - 172, 52, 26);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(120, y + 26, 11, 0, Math.PI * 2);
      ctx.stroke();
      if (i < 2 || pulse > 0.45) {
        ctx.beginPath();
        ctx.moveTo(114, y + 26);
        ctx.lineTo(119, y + 32);
        ctx.lineTo(130, y + 18);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(cx + 90, cy - 90, 48, 26, 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;

  // Corner accent square (matches label squares)
  ctx.fillStyle = face.accent;
  ctx.fillRect(36, 36, 28, 28);

  // Title
  ctx.fillStyle = "#fdfff8";
  ctx.font = "300 44px Georgia, 'Times New Roman', serif";
  ctx.textAlign = "left";
  ctx.fillText(face.title, 80, 64);

  // Chip / oval label
  const chipW = Math.max(128, face.chip.length * 11 + 40);
  const chipX = 48;
  const chipY = s - 92;
  ctx.fillStyle = face.accentSoft;
  roundRect(ctx, chipX, chipY, chipW, 40, 20);
  ctx.fill();
  ctx.strokeStyle = face.accent;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.85;
  roundRect(ctx, chipX, chipY, chipW, 40, 20);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = face.accent;
  ctx.font = "600 20px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(face.chip, chipX + 20, chipY + 27);

  // Fine frame inset
  ctx.strokeStyle = "rgba(118,118,118,0.7)";
  ctx.lineWidth = 1;
  ctx.strokeRect(18, 18, s - 36, s - 36);
}

type CubeParts = {
  root: Group;
  texture: CanvasTexture;
  canvas: HTMLCanvasElement;
  faceIndex: number;
};

function createBox(faceIndex: number): CubeParts {
  const root = new Group();
  const geometry = new BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_DEPTH);
  const edges = new EdgesGeometry(geometry);

  const fill = new Mesh(
    geometry,
    new MeshBasicMaterial({
      color: 0x121212,
      transparent: true,
      opacity: 1,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );

  const outline = new LineSegments(
    edges,
    new LineBasicMaterial({
      color: 0x8a8a8a,
      transparent: true,
      opacity: 1,
    }),
  );

  const canvas = document.createElement("canvas");
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;

  const face = new Mesh(
    new PlaneGeometry(BOX_SIZE * 0.92, BOX_SIZE * 0.92),
    new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }),
  );
  face.position.z = BOX_DEPTH / 2 + 0.002;

  root.add(fill, outline, face);
  root.visible = false;
  return { root, texture, canvas, faceIndex };
}

function setGroupOpacity(group: Group, opacity: number) {
  group.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.material && "opacity" in mesh.material) {
      const mat = mesh.material as MeshBasicMaterial | LineBasicMaterial;
      mat.transparent = true;
      mat.opacity = opacity;
      mat.needsUpdate = true;
    }
  });
}

function paintPhase(boxes: CubeParts[], phase: number, time: number) {
  const faces = PHASE_FACES[phase] ?? PHASE_FACES[0]!;
  boxes.forEach((box, i) => {
    const face = faces[i] ?? faces[0]!;
    const ctx = box.canvas.getContext("2d");
    if (!ctx) return;
    drawFace(ctx, face, time, i);
    box.texture.needsUpdate = true;
  });
}

type HowItWorksCubesProps = {
  progress: number;
  centerEl: HTMLElement | null;
  active: boolean;
};

export function HowItWorksCubes({ progress, centerEl, active }: HowItWorksCubesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(progress);
  const centerRef = useRef(centerEl);
  const activeRef = useRef(active);

  progressRef.current = progress;
  centerRef.current = centerEl;
  activeRef.current = active;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const scene = new Scene();
    const camera = new PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 7.25);

    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearAlpha(0);
    renderer.domElement.className = "hiw-three-canvas";
    container.appendChild(renderer.domElement);

    const groupA = new Group();
    const groupB = new Group();
    scene.add(groupA, groupB);

    const boxesA = Array.from({ length: MAX_BOXES }, (_, i) => {
      const box = createBox(i);
      groupA.add(box.root);
      return box;
    });
    const boxesB = Array.from({ length: MAX_BOXES }, (_, i) => {
      const box = createBox(i);
      groupB.add(box.root);
      return box;
    });

    let phaseA = -1;
    let phaseB = -1;
    let viewOffsetY = Number.NaN;
    let raf = 0;
    let running = true;
    const started = performance.now();

    const hideGroup = (group: Group) => {
      group.visible = false;
      group.scale.setScalar(0.001);
    };

    const layoutPhase = (phase: number, boxes: CubeParts[]) => {
      const positions = outwardPositions(pickLayout(phase));
      boxes.forEach((box, i) => {
        const pos = positions[i];
        if (!pos) {
          box.root.visible = false;
          return;
        }
        box.root.visible = true;
        box.root.scale.setScalar(1);
        box.root.position.set(pos[0], pos[1], pos[2]);
      });
      paintPhase(boxes, phase, 0);
    };

    const growGroup = (group: Group, t: number) => {
      const eased = t * t * (3 - 2 * t);
      group.visible = true;
      group.scale.setScalar(Math.max(0.001, eased * GROUP_SCALE));
      group.position.z = mapRange(eased, 0, 1, Z_START, 0);
      setGroupOpacity(group, mapRange(eased, FADE_IN_START, FADE_IN_END, 0, 1));
    };

    const shrinkGroup = (group: Group, t: number) => {
      const eased = t * t * (3 - 2 * t);
      group.visible = true;
      group.scale.setScalar(Math.max(0.001, (1 - eased) * GROUP_SCALE));
      group.position.z = mapRange(eased, 0, 1, 0, Z_END);
      setGroupOpacity(group, mapRange(eased, 0.55, 1, 1, 0));
    };

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < 1 || h < 1) return;
      const dpr = Math.min(window.devicePixelRatio, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    const syncViewOffset = () => {
      const center = centerRef.current;
      const canvas = renderer.domElement;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!center || w < 1 || h < 1) {
        camera.clearViewOffset();
        return;
      }
      const canvasRect = canvas.getBoundingClientRect();
      const centerRect = center.getBoundingClientRect();
      const delta =
        canvasRect.top + canvasRect.height / 2 - (centerRect.top + centerRect.height / 2);
      if (Math.abs(delta - viewOffsetY) < 0.5) return;
      viewOffsetY = delta;
      if (Math.abs(delta) < 0.5) camera.clearViewOffset();
      else camera.setViewOffset(w, h, 0, delta, w, h);
    };

    const tick = () => {
      if (!running) return;
      raf = window.requestAnimationFrame(tick);

      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < 1 || h < 1) return;

      const time = (performance.now() - started) / 1000;

      if (!activeRef.current) {
        hideGroup(groupA);
        hideGroup(groupB);
        renderer.render(scene, camera);
        return;
      }

      syncViewOffset();
      const L = clamp01(progressRef.current);
      let usedA = false;
      let usedB = false;

      for (let k = 0; k < PHASES; k += 1) {
        const start = k * STEP;
        const mid = (k + 1) * STEP;
        const end = (k + 2) * STEP;
        if (L < start || L >= end) continue;

        const even = k % 2 === 0;
        const group = even ? groupA : groupB;
        const boxes = even ? boxesA : boxesB;

        if (even) {
          if (phaseA !== k) {
            phaseA = k;
            layoutPhase(k, boxes);
          } else {
            paintPhase(boxes, k, time);
          }
        } else if (phaseB !== k) {
          phaseB = k;
          layoutPhase(k, boxes);
        } else {
          paintPhase(boxes, k, time);
        }

        if (L < mid) growGroup(group, (L - start) / STEP);
        else shrinkGroup(group, Math.min((L - mid) / STEP, 1));

        if (even) usedA = true;
        else usedB = true;
      }

      if (!usedA) hideGroup(groupA);
      if (!usedB) hideGroup(groupB);
      renderer.render(scene, camera);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    tick();

    return () => {
      running = false;
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      boxesA.concat(boxesB).forEach((box) => {
        box.texture.dispose();
        box.root.traverse((obj) => {
          const mesh = obj as Mesh;
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
          else if (mesh.material && "dispose" in mesh.material) mesh.material.dispose();
        });
      });
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="hiw-canvas" aria-hidden="true">
      <div ref={containerRef} className="hiw-three-canvas-container" />
    </div>
  );
}
