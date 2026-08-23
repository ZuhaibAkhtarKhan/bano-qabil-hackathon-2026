"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import * as THREE from "three";

import { cn } from "@/lib/cn";

export type QueueItem = {
  id: string;
  title: string;
  detail: string;
  status: string;
  tone: "sand" | "teal" | "mint" | "violet";
  action: string;
  deadline: string;
  orbit: number;
  phase: number;
};

type OrbitalQueueSceneProps = {
  items: QueueItem[];
  activeId: string;
  paused: boolean;
  onSelect: (id: string) => void;
  onHoverChange: (hovering: boolean) => void;
  reduceMotion: boolean;
};

type ProjectedNode = {
  id: string;
  x: number;
  y: number;
  depth: number;
  title: string;
  detail: string;
};

function createEarthTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const ocean = ctx.createLinearGradient(0, 0, 0, 512);
  ocean.addColorStop(0, "#b9d9ea");
  ocean.addColorStop(0.5, "#8ec4dc");
  ocean.addColorStop(1, "#a8d0e4");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, 1024, 512);

  const landPatches: Array<[number, number, number, number, string]> = [
    [180, 160, 140, 90, "#9cba7f"],
    [260, 210, 100, 70, "#8faf70"],
    [420, 180, 160, 110, "#a3c086"],
    [560, 250, 90, 60, "#97b678"],
    [700, 150, 180, 100, "#8eac73"],
    [820, 280, 120, 80, "#a8c490"],
    [120, 320, 80, 50, "#9bb87d"],
    [480, 120, 70, 40, "#b2c99a"],
  ];

  for (const [x, y, w, h, color] of landPatches) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i += 1) {
    const y = (512 / 8) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1024, y);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function EarthGlobe({ reduceMotion }: { reduceMotion: boolean }) {
  const globeRef = useRef<Group>(null);
  const texture = useMemo(() => createEarthTexture(), []);

  useFrame((_, delta) => {
    if (reduceMotion || !globeRef.current) return;
    globeRef.current.rotation.y += delta * 0.12;
  });

  return (
    <group ref={globeRef}>
      <mesh>
        <sphereGeometry args={[1.05, 64, 64]} />
        <meshStandardMaterial
          map={texture ?? undefined}
          color={texture ? "#ffffff" : "#8ec4dc"}
          roughness={0.55}
          metalness={0.05}
        />
      </mesh>
      <mesh scale={1.08}>
        <sphereGeometry args={[1.05, 48, 48]} />
        <meshBasicMaterial color="#cfe8f5" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh scale={1.18}>
        <sphereGeometry args={[1.05, 32, 32]} />
        <meshBasicMaterial color="#e8f4fb" transparent opacity={0.12} depthWrite={false} />
      </mesh>
    </group>
  );
}

function SoftOrbit({
  radius,
  tilt,
  speed,
  reduceMotion,
}: {
  radius: number;
  tilt: [number, number, number];
  speed: number;
  reduceMotion: boolean;
}) {
  const ref = useRef<Group>(null);
  useFrame((_, delta) => {
    if (reduceMotion || !ref.current) return;
    ref.current.rotation.z += delta * speed;
  });

  return (
    <group ref={ref} rotation={tilt}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.008, 10, 180]} />
        <meshBasicMaterial color="#94a3b8" transparent opacity={0.32} />
      </mesh>
    </group>
  );
}

function OrbitMarkers({
  items,
  activeId,
  paused,
  reduceMotion,
  onProject,
}: {
  items: QueueItem[];
  activeId: string;
  paused: boolean;
  reduceMotion: boolean;
  onProject: (nodes: ProjectedNode[]) => void;
}) {
  const groupRefs = useRef<Record<string, Group | null>>({});
  const angles = useRef<Record<string, number>>(
    Object.fromEntries(items.map((item) => [item.id, item.phase])),
  );
  const { camera, size } = useThree();
  const projection = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const next: ProjectedNode[] = [];

    for (const item of items) {
      if (!paused && !reduceMotion) {
        angles.current[item.id] = (angles.current[item.id] ?? item.phase) + delta * (0.16 + item.orbit * 0.025);
      }
      const angle = angles.current[item.id] ?? item.phase;
      const radius = 1.9 + item.orbit * 0.4;
      const y = Math.sin(angle * 0.65 + item.orbit * 1.1) * 0.34;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius * 0.58;

      const marker = groupRefs.current[item.id];
      if (marker) marker.position.set(x, y, z);

      projection.set(x, y + 0.12, z).project(camera);
      const sx = (projection.x * 0.5 + 0.5) * size.width;
      const sy = (-projection.y * 0.5 + 0.5) * size.height;
      if (projection.z < 1) {
        next.push({
          id: item.id,
          x: sx,
          y: sy,
          depth: projection.z,
          title: item.title.split(" · ")[0] ?? item.title,
          detail: item.detail,
        });
      }
    }

    next.sort((a, b) => b.depth - a.depth);
    onProject(next);
  });

  return (
    <>
      {items.map((item) => (
        <group
          key={item.id}
          ref={(node) => {
            groupRefs.current[item.id] = node;
          }}
        >
          <mesh>
            <sphereGeometry args={[0.045, 12, 12]} />
            <meshBasicMaterial color={item.id === activeId ? "#0e0e0e" : "#94a3b8"} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function SceneContent({
  items,
  activeId,
  paused,
  reduceMotion,
  onProject,
}: {
  items: QueueItem[];
  activeId: string;
  paused: boolean;
  reduceMotion: boolean;
  onProject: (nodes: ProjectedNode[]) => void;
}) {
  return (
    <>
      <color attach="background" args={["#f9faf6"]} />
      <fog attach="fog" args={["#f9faf6", 11, 24]} />
      <ambientLight intensity={0.95} />
      <directionalLight position={[4, 3, 5]} intensity={1.15} color="#ffffff" />
      <directionalLight position={[-3, -1, -2]} intensity={0.35} color="#cfe8f5" />
      <EarthGlobe reduceMotion={reduceMotion} />
      <SoftOrbit radius={1.55} tilt={[0.6, 0.15, 0.08]} speed={0.14} reduceMotion={reduceMotion} />
      <SoftOrbit radius={1.95} tilt={[-0.55, 0.3, 0.25]} speed={-0.1} reduceMotion={reduceMotion} />
      <SoftOrbit radius={2.3} tilt={[0.9, -0.2, 0.4]} speed={0.07} reduceMotion={reduceMotion} />
      <OrbitMarkers
        items={items}
        activeId={activeId}
        paused={paused}
        reduceMotion={reduceMotion}
        onProject={onProject}
      />
      {!reduceMotion && (
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          autoRotate
          autoRotateSpeed={0.28}
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={Math.PI / 1.7}
        />
      )}
    </>
  );
}

export function OrbitalQueueScene({
  items,
  activeId,
  paused,
  onSelect,
  onHoverChange,
  reduceMotion,
}: OrbitalQueueSceneProps) {
  const [projected, setProjected] = useState<ProjectedNode[]>([]);
  const projectedRef = useRef<ProjectedNode[]>([]);

  useEffect(() => {
    // Keep overlay updates out of React render thrash
    const id = window.setInterval(() => {
      setProjected(projectedRef.current);
    }, 48);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className="orbital-canvas relative h-[22rem] w-full sm:h-[26rem]"
      onPointerEnter={() => onHoverChange(true)}
      onPointerLeave={() => onHoverChange(false)}
    >
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0.45, 6.4], fov: 40 }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      >
        <SceneContent
          items={items}
          activeId={activeId}
          paused={paused}
          reduceMotion={reduceMotion}
          onProject={(nodes) => {
            projectedRef.current = nodes;
          }}
        />
      </Canvas>

      <div className="pointer-events-none absolute inset-0">
        {projected.map((node) => {
          const active = node.id === activeId;
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelect(node.id)}
              className={cn(
                "orbital-node pointer-events-auto absolute -translate-x-1/2 -translate-y-full rounded-full border px-2 py-1 text-left transition-colors duration-200",
                active
                  ? "z-20 border-ink/25 bg-white text-ink shadow-sm"
                  : "z-10 border-line bg-white/85 text-ink-muted hover:border-ink/20 hover:text-ink",
              )}
              style={{ left: node.x, top: node.y - 6 }}
              aria-pressed={active}
              aria-label={node.detail ? `${node.title}. ${node.detail}` : node.title}
            >
              <span className="block max-w-[5.75rem] truncate text-[10px] font-medium leading-none">
                {node.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
