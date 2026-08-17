import type { ReactNode } from "react";

export function Progress({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="flex justify-between text-xs text-ink-muted">
        <span>{label}</span>
        <span className="font-mono">{clamped}%</span>
      </div>
      <progress
        className="mt-2 h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-canvas [&::-webkit-progress-value]:bg-ink [&::-moz-progress-bar]:bg-ink"
        max={100}
        value={clamped}
      >
        {clamped}%
      </progress>
    </div>
  );
}

export function ScoreIndicator({
  score,
  label = "Fit Index",
}: {
  score: number | null;
  label?: string;
}) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">{label}</p>
      <p className="mt-1 font-mono text-3xl tracking-tight">{score ?? "—"}</p>
      {typeof score === "number" ? <Progress value={score} label="Match from verified evidence" /> : null}
    </div>
  );
}

export function Timeline({
  items,
}: {
  items: Array<{ id: string; title: string; body?: string; at?: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span className="absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full border border-ink bg-white" aria-hidden="true" />
          <p className="text-sm font-medium">{item.title}</p>
          {item.body ? <p className="mt-1 text-sm text-ink-muted">{item.body}</p> : null}
          {item.at ? <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">{item.at}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-line bg-canvas">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-line last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-3 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
