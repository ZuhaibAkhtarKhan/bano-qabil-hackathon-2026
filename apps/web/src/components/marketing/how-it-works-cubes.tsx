"use client";

import { useEffect, useRef } from "react";
import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
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

const PHASES = 4;
const MAX_BOXES = 3;
const TEX_W = 640;
const TEX_H = 404;
const Z_START = -1.8;
const Z_END = 3.5;
const FADE_IN_START = 0.05;
const FADE_IN_END = 0.28;
const STEP = 1 / (PHASES + 1);
const GROUP_SCALE = 1.28;

const WIRE = 0x767676;
const FACE_BG = 0x151414;
const SIDE_FILL = 0x1a1a1a;

type BoxSpec = {
  pos: [number, number, number];
  size: [number, number, number];
  rot: [number, number, number];
};

const LAYOUT_A: BoxSpec[] = [
  { pos: [-0.55, 0.72, 0.05], size: [1.52, 0.94, 0.42], rot: [-0.12, 0.18, 0.04] },
  { pos: [0.72, 0.38, -0.08], size: [1.38, 0.88, 0.38], rot: [-0.08, -0.22, -0.03] },
  { pos: [-0.68, -0.62, 0.1], size: [1.44, 0.9, 0.4], rot: [0.1, 0.14, 0.02] },
];

const LAYOUT_B: BoxSpec[] = [
  { pos: [0.08, 0.78, 0.02], size: [1.48, 0.96, 0.4], rot: [-0.14, 0.08, 0.05] },
  { pos: [-0.78, -0.55, -0.06], size: [1.4, 0.86, 0.38], rot: [0.06, 0.2, -0.02] },
  { pos: [0.82, -0.58, 0.08], size: [1.34, 0.84, 0.36], rot: [0.11, -0.16, 0.03] },
];

type FaceContent = {
  accent: string;
  heading: string;
  subtitle?: string;
  kind: "bars" | "pills" | "grid" | "table" | "chart" | "flow";
  items: string[];
  chartValue?: string;
  chartNote?: string;
};

/** One scroll phase = one platform pillar; three cubes = sub-features from that pillar */
const PHASE_FACES: FaceContent[][] = [
  // 01 — Application Memory
  [
    {
      accent: "#98a5ef",
      heading: "Structured profile",
      subtitle: "Identity, education, skills, projects",
      kind: "bars",
      items: ["Identity", "Education", "Skills", "Projects"],
    },
    {
      accent: "#98a5ef",
      heading: "Evidence with source",
      subtitle: "Resumes & docs → verified facts",
      kind: "pills",
      items: ["Resume.pdf", "Transcript", "Portfolio", "Certificates"],
    },
    {
      accent: "#98a5ef",
      heading: "Immutable versions",
      subtitle: "Document history stays intact",
      kind: "grid",
      items: ["v1 uploaded", "v2 reviewed", "Source linked"],
    },
  ],
  // 02 — Opportunity Intake
  [
    {
      accent: "#5adeb7",
      heading: "Add any opportunity",
      subtitle: "Page content stays untrusted",
      kind: "pills",
      items: ["Public URL", "Extension save", "Manual entry"],
    },
    {
      accent: "#5adeb7",
      heading: "Extract requirements",
      subtitle: "Questions & checklist from the page",
      kind: "flow",
      items: ["Parse posting", "Pull questions", "Build checklist"],
    },
    {
      accent: "#5adeb7",
      heading: "Fit Index",
      subtitle: "Match score + missing-fact list",
      kind: "chart",
      items: ["Skills match", "Gaps found", "Facts needed"],
      chartValue: "78%",
      chartNote: "3 facts missing",
    },
  ],
  // 03 — Grounded Agents
  [
    {
      accent: "#e69393",
      heading: "RAG over your evidence",
      subtitle: "Retrieves approved memory only",
      kind: "flow",
      items: ["Query memory", "Pull citations", "Draft answer"],
    },
    {
      accent: "#e69393",
      heading: "Cited drafts",
      subtitle: "Every sentence shows its source",
      kind: "table",
      items: ["Cover letter", "Why this role?", "Project example"],
    },
    {
      accent: "#e69393",
      heading: "No evidence → no claim",
      subtitle: "Unknowns become review items",
      kind: "pills",
      items: ["Flag unknown", "Ask you", "Never invent"],
    },
  ],
  // 04 — Control & Safety
  [
    {
      accent: "#eadc8f",
      heading: "Approval workflows",
      subtitle: "You approve every answer & doc",
      kind: "table",
      items: ["Draft ready", "Your review", "Approved"],
    },
    {
      accent: "#eadc8f",
      heading: "Extension vs platform",
      subtitle: "Fill on host sites · submit on 1-Apply",
      kind: "pills",
      items: ["Extension fills", "Host: you submit", "Platform auto-submit"],
    },
    {
      accent: "#eadc8f",
      heading: "Full audit trail",
      subtitle: "Every action logged & traceable",
      kind: "flow",
      items: ["Edit answer", "Zuhaib Akhtar", "Timestamp"],
    },
  ],
];

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function mapRange(value: number, inMin: number, inMax: number, outMin: number, outMax: number) {
  const t = clamp01((value - inMin) / (inMax - inMin));
  return outMin + (outMax - outMin) * t;
}

function pickLayout(phase: number): BoxSpec[] {
  return phase % 2 === 0 ? LAYOUT_A : LAYOUT_B;
}

function outwardPositions(specs: BoxSpec[]): BoxSpec[] {
  return specs.map((spec) => {
    const [x, y, z] = spec.pos;
    const [w, h] = spec.size;
    const len = Math.hypot(x, y);
    if (len === 0) return spec;
    const nx = x / len;
    const ny = y / len;
    const extent = Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2);
    const dist = len + extent * 0.22;
    return { ...spec, pos: [nx * dist, ny * dist, z] };
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawHatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, accent: string) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 6);
  ctx.clip();
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  for (let i = -h; i < w + h; i += 7) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + h, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFace(ctx: CanvasRenderingContext2D, face: FaceContent, variant: number) {
  const w = TEX_W;
  const h = TEX_H;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#151414";
  ctx.fillRect(0, 0, w, h);

  // Inner panel border (Nominal-style thin frame)
  ctx.strokeStyle = "rgba(118,118,118,0.55)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  ctx.fillStyle = "#fdfff8";
  ctx.font = "400 34px Georgia, 'Times New Roman', serif";
  ctx.textAlign = "left";
  ctx.fillText(face.heading, 24, 54);

  if (face.subtitle) {
    ctx.fillStyle = "rgba(187,187,187,0.95)";
    ctx.font = "500 18px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(face.subtitle, 24, 82);
  }

  const accent = face.accent;
  const contentTop = face.subtitle ? 108 : 92;

  if (face.kind === "bars") {
    face.items.forEach((label, i) => {
      const y = contentTop + i * 64;
      ctx.fillStyle = "rgba(253,255,248,0.75)";
      ctx.font = "600 20px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(label, 24, y);
      const barW = w - 48;
      const fillW = barW * (0.42 + ((variant + i) % 4) * 0.1);
      if (i === variant % face.items.length) {
        ctx.fillStyle = accent;
        roundRect(ctx, 24, y + 12, fillW, 18, 7);
        ctx.fill();
      } else {
        drawHatch(ctx, 24, y + 12, barW, 18, accent);
        ctx.strokeStyle = "rgba(118,118,118,0.6)";
        ctx.lineWidth = 1;
        roundRect(ctx, 24, y + 12, barW, 18, 7);
        ctx.stroke();
      }
    });
  }

  if (face.kind === "pills") {
    face.items.forEach((label, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const px = 24 + col * 296;
      const py = contentTop + row * 58;
      const active = i === variant % face.items.length;
      if (active) {
        ctx.fillStyle = accent;
        roundRect(ctx, px, py, 272, 46, 23);
        ctx.fill();
        ctx.fillStyle = "#151414";
      } else {
        ctx.fillStyle = "rgba(21,20,20,0.9)";
        roundRect(ctx, px, py, 272, 46, 23);
        ctx.fill();
        ctx.strokeStyle = "rgba(118,118,118,0.65)";
        ctx.lineWidth = 1;
        roundRect(ctx, px, py, 272, 46, 23);
        ctx.stroke();
        ctx.fillStyle = "rgba(253,255,248,0.8)";
      }
      ctx.font = "600 18px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(label, px + 16, py + 30);
    });
  }

  if (face.kind === "grid") {
    const gx = 24;
    const gy = contentTop;
    const cell = 78;
    const labels = face.items.slice(0, 4);
    for (let i = 0; i < 4; i += 1) {
      const cx = gx + (i % 2) * (cell + 12);
      const cy = gy + Math.floor(i / 2) * (cell + 12);
      if (i === variant % 4) {
        ctx.fillStyle = accent;
        ctx.fillRect(cx, cy, cell, cell);
      } else {
        drawHatch(ctx, cx, cy, cell, cell, accent);
        ctx.strokeStyle = "rgba(118,118,118,0.6)";
        ctx.strokeRect(cx, cy, cell, cell);
      }
    }
    ctx.fillStyle = "rgba(253,255,248,0.85)";
    ctx.font = "600 17px ui-sans-serif, system-ui, sans-serif";
    labels.forEach((label, i) => ctx.fillText(label, gx + 180, contentTop + 10 + i * 26));
  }

  if (face.kind === "chart") {
    const cy = h / 2 + 28;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(w / 2, cy, 82, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(w / 2, cy, 82, -Math.PI / 2, Math.PI * 0.55);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = accent;
    ctx.font = "700 42px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(face.chartValue ?? "78%", w / 2, cy + 14);
    ctx.textAlign = "left";
    if (face.chartNote) {
      ctx.fillStyle = "rgba(253,255,248,0.65)";
      ctx.font = "600 17px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(face.chartNote, w / 2, cy + 44);
      ctx.textAlign = "left";
    }
    face.items.forEach((label, i) => {
      ctx.fillStyle = i === variant % face.items.length ? accent : "rgba(187,187,187,0.9)";
      ctx.font = "600 17px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(`• ${label}`, 24, contentTop + i * 28);
    });
  }

  if (face.kind === "flow") {
    const nodes = face.items.slice(0, 3);
    nodes.forEach((label, i) => {
      const px = 24 + i * 196;
      const py = contentTop + 36;
      const active = i === variant % nodes.length;
      if (active) {
        ctx.fillStyle = accent;
        roundRect(ctx, px, py, 176, 50, 25);
        ctx.fill();
        ctx.fillStyle = "#151414";
      } else {
        ctx.strokeStyle = "rgba(118,118,118,0.65)";
        ctx.lineWidth = 1;
        roundRect(ctx, px, py, 176, 50, 25);
        ctx.stroke();
        ctx.fillStyle = "rgba(253,255,248,0.85)";
      }
      ctx.font = "600 17px ui-sans-serif, system-ui, sans-serif";
      const text = label.length > 14 ? `${label.slice(0, 13)}…` : label;
      ctx.fillText(text, px + 14, py + 32);
      if (i < nodes.length - 1) {
        ctx.strokeStyle = "rgba(118,118,118,0.55)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px + 180, py + 25);
        ctx.lineTo(px + 192, py + 25);
        ctx.stroke();
      }
    });
  }

  if (face.kind === "table") {
    face.items.forEach((label, i) => {
      const y = contentTop + i * 62;
      ctx.strokeStyle = "rgba(39,44,43,0.9)";
      ctx.beginPath();
      ctx.moveTo(24, y + 46);
      ctx.lineTo(w - 24, y + 46);
      ctx.stroke();
      ctx.fillStyle = "rgba(253,255,248,0.75)";
      ctx.font = "600 18px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(label, 24, y + 26);
      const pillX = w - 132;
      const pillLabel = i === variant % face.items.length ? "Approved" : i === 0 ? "Pending" : "Review";
      if (i === variant % face.items.length) {
        ctx.fillStyle = accent;
        roundRect(ctx, pillX, y + 4, 104, 34, 17);
        ctx.fill();
        ctx.fillStyle = "#151414";
        ctx.font = "700 15px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(pillLabel, pillX + 16, y + 27);
      } else {
        ctx.strokeStyle = "rgba(118,118,118,0.55)";
        roundRect(ctx, pillX, y + 4, 104, 34, 17);
        ctx.stroke();
        ctx.fillStyle = "rgba(187,187,187,0.9)";
        ctx.font = "700 15px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(pillLabel, pillX + 16, y + 27);
      }
    });
  }
}

/** Build Nominal-style wireframe prism: front panel + thin depth edges + subtle top/right faces */
function createWireframePrism(width: number, height: number, depth: number) {
  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;

  const group = new Group();

  // 8 corners: front face at z=+hd, back at z=-hd
  const corners = [
    [-hw, -hh, hd],
    [hw, -hh, hd],
    [hw, hh, hd],
    [-hw, hh, hd],
    [-hw, -hh, -hd],
    [hw, -hh, -hd],
    [hw, hh, -hd],
    [-hw, hh, -hd],
  ] as const;

  const edgePairs: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  const positions: number[] = [];
  edgePairs.forEach(([a, b]) => {
    const ca = corners[a]!;
    const cb = corners[b]!;
    positions.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2]);
  });

  const wireGeo = new BufferGeometry();
  wireGeo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const wire = new LineSegments(
    wireGeo,
    new LineBasicMaterial({ color: WIRE, transparent: true, opacity: 0.95 }),
  );

  // Subtle top face (visible in isometric view)
  const topGeo = new BufferGeometry();
  topGeo.setAttribute(
    "position",
    new Float32BufferAttribute(
      [
        corners[3]![0], corners[3]![1], corners[3]![2],
        corners[2]![0], corners[2]![1], corners[2]![2],
        corners[6]![0], corners[6]![1], corners[6]![2],
        corners[3]![0], corners[3]![1], corners[3]![2],
        corners[6]![0], corners[6]![1], corners[6]![2],
        corners[7]![0], corners[7]![1], corners[7]![2],
      ],
      3,
    ),
  );
  const topFace = new Mesh(
    topGeo,
    new MeshBasicMaterial({
      color: SIDE_FILL,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: DoubleSide,
    }),
  );

  // Subtle right face
  const rightGeo = new BufferGeometry();
  rightGeo.setAttribute(
    "position",
    new Float32BufferAttribute(
      [
        corners[1]![0], corners[1]![1], corners[1]![2],
        corners[2]![0], corners[2]![1], corners[2]![2],
        corners[6]![0], corners[6]![1], corners[6]![2],
        corners[1]![0], corners[1]![1], corners[1]![2],
        corners[6]![0], corners[6]![1], corners[6]![2],
        corners[5]![0], corners[5]![1], corners[5]![2],
      ],
      3,
    ),
  );
  const rightFace = new Mesh(
    rightGeo,
    new MeshBasicMaterial({
      color: SIDE_FILL,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      side: DoubleSide,
    }),
  );

  // Front panel backing (slightly inset)
  const backPanel = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ color: FACE_BG }),
  );
  backPanel.position.z = hd + 0.001;

  group.add(topFace, rightFace, backPanel, wire);
  return group;
}

type CubeParts = {
  root: Group;
  prism: Group;
  texture: CanvasTexture;
  canvas: HTMLCanvasElement;
  faceMesh: Mesh;
  faceIndex: number;
};

function createBox(faceIndex: number): CubeParts {
  const root = new Group();
  const [w, h, d] = [1.3, 0.82, 0.4];
  const prism = createWireframePrism(w, h, d);

  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;

  const faceMesh = new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({ map: texture, transparent: false, depthWrite: true }),
  );
  faceMesh.position.z = d / 2 + 0.004;

  root.add(prism, faceMesh);
  root.visible = false;
  return { root, prism, texture, canvas, faceMesh, faceIndex };
}

function setGroupOpacity(group: Group, opacity: number) {
  group.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.material && "opacity" in mesh.material) {
      const mat = mesh.material as MeshBasicMaterial | LineBasicMaterial;
      mat.transparent = true;
      mat.opacity = opacity;
    }
  });
}

function paintPhase(boxes: CubeParts[], phase: number) {
  const faces = PHASE_FACES[phase] ?? PHASE_FACES[0]!;
  boxes.forEach((box, i) => {
    const face = faces[i] ?? faces[0]!;
    const ctx = box.canvas.getContext("2d");
    if (!ctx) return;
    drawFace(ctx, face, i);
    box.texture.needsUpdate = true;
  });
}

function applyBoxSpec(box: CubeParts, spec: BoxSpec) {
  const [w, h, d] = spec.size;
  box.root.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
  box.root.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
  box.root.scale.set(w / 1.3, h / 0.82, d / 0.4);
  box.faceMesh.scale.set(1, 1, 1);
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
    const camera = new PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0.35, 0.25, 6.5);
    camera.lookAt(0, 0, 0);

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

    const hideGroup = (group: Group) => {
      group.visible = false;
      group.scale.setScalar(0.001);
    };

    const layoutPhase = (phase: number, boxes: CubeParts[]) => {
      const specs = outwardPositions(pickLayout(phase));
      boxes.forEach((box, i) => {
        const spec = specs[i];
        if (!spec) {
          box.root.visible = false;
          return;
        }
        box.root.visible = true;
        applyBoxSpec(box, spec);
      });
      paintPhase(boxes, phase);
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
          }
        } else if (phaseB !== k) {
          phaseB = k;
          layoutPhase(k, boxes);
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
