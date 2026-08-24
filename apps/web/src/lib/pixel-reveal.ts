type PixelRevealOptions = {
  type?: "reveal" | "hide";
  size?: number;
  fuzziness?: number;
  duration?: number;
  onComplete?: () => void;
};

export function pixelReveal(element: HTMLElement, options: PixelRevealOptions = {}) {
  const type = options.type ?? "reveal";
  const size = options.size ?? 0.05;
  const fuzziness = options.fuzziness ?? 0.5;
  const duration = options.duration ?? 800;

  const { width, height } = element.getBoundingClientRect();
  if (width === 0 || height === 0) {
    element.style.visibility = "visible";
    element.style.clipPath = "";
    options.onComplete?.();
    return () => {};
  }

  const cell = Math.max(5, Math.floor(width * size));
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const fuzzRows = rows * fuzziness;
  const offsets = new Float32Array(rows * cols);

  for (let i = 0; i < offsets.length; i += 1) {
    offsets[i] = Math.random() * fuzzRows;
  }

  const maxY = rows + fuzzRows;
  const minY = -fuzzRows;
  const span = maxY - minY;
  let frame = 0;
  let start: number | null = null;
  let cancelled = false;

  element.style.visibility = "visible";
  element.style.clipPath = type === "hide" ? "inset(0%)" : "inset(100%)";

  const tick = (now: number) => {
    if (cancelled) return;

    if (start === null) start = now;
    const progress = Math.min(1, (now - start) / duration);
    const scan = maxY - span * progress;
    let path = "";

    for (let row = 0; row < rows; row += 1) {
      if (type === "hide" && row > scan + fuzzRows + 1) break;
      if (type === "reveal" && row < scan - fuzzRows - 1) continue;

      for (let col = 0; col < cols; col += 1) {
        const edge = scan + (offsets[row * cols + col] ?? 0);
        const visible = type === "hide" ? row < edge : row > edge;
        if (!visible) continue;

        const x = col * cell;
        const y = row * cell;
        path += `M ${x} ${y} L ${x + cell + 1} ${y} L ${x + cell + 1} ${y + cell + 1} L ${x} ${y + cell + 1} Z `;
      }
    }

    element.style.clipPath = path.length > 0 ? `path('${path.trim()}')` : "inset(100%)";

    if (progress < 1) {
      frame = window.requestAnimationFrame(tick);
      return;
    }

    if (type === "hide") {
      element.style.clipPath = "inset(100%)";
      element.style.visibility = "hidden";
    } else {
      element.style.clipPath = "";
    }

    options.onComplete?.();
  };

  frame = window.requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
  };
}
