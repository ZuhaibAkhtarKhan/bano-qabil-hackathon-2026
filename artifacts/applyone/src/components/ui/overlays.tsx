"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function Dialog({
  title,
  trigger,
  children,
}: {
  title: string;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        className="inline-flex"
        onClick={() => dialogRef.current?.showModal()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            dialogRef.current?.showModal();
          }
        }}
      >
        {trigger}
      </span>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="w-[min(32rem,calc(100%-2rem))] rounded-3xl border border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/40"
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current.close();
        }}
      >
        <div className="p-6">
          <h2 id={titleId} className="font-display text-2xl">
            {title}
          </h2>
          <div className="mt-4">{children}</div>
          <form method="dialog" className="mt-6">
            <Button type="submit" variant="secondary">
              Close
            </Button>
          </form>
        </div>
      </dialog>
    </>
  );
}

export function Drawer({
  title,
  open,
  onClose,
  children,
  id,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  id?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      id={id}
      className="fixed inset-y-0 left-0 m-0 h-full max-h-none w-[min(20rem,100%)] max-w-none rounded-none border-r border-line bg-white p-0 text-ink backdrop:bg-ink/40"
      onClose={onClose}
    >
      <div className="flex h-full flex-col p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="font-display text-2xl">
            {title}
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="mt-6 min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </dialog>
  );
}

export function Dropdown({
  label,
  items,
}: {
  label: string;
  items: Array<{ href: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="relative">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </Button>
      {open ? (
        <ul
          id={id}
          role="menu"
          className="absolute right-0 z-20 mt-2 min-w-44 rounded-2xl border border-line bg-white p-1 shadow-lg"
        >
          {items.map((item) => (
            <li key={item.href} role="none">
              <a
                role="menuitem"
                href={item.href}
                className="block rounded-xl px-3 py-2 text-sm hover:bg-canvas"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="group relative inline-flex">
      <span aria-describedby={id}>{children}</span>
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-xs text-white opacity-0 transition-opacity",
          "group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        {label}
      </span>
    </span>
  );
}

export function Tabs({
  tabs,
}: {
  tabs: Array<{ id: string; label: string; panel: ReactNode }>;
}) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const listId = useId();

  return (
    <div>
      <div role="tablist" aria-label="Sections" id={listId} className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${listId}-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${listId}-${tab.id}-panel`}
              tabIndex={selected ? 0 : -1}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-xs font-semibold",
                selected ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-muted hover:text-ink",
              )}
              onClick={() => setActive(tab.id)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                const ids = tabs.map((item) => item.id);
                const index = ids.indexOf(tab.id);
                const next =
                  event.key === "ArrowRight"
                    ? ids[(index + 1) % ids.length]
                    : ids[(index - 1 + ids.length) % ids.length];
                if (next) setActive(next);
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) =>
        tab.id === active ? (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${listId}-${tab.id}-panel`}
            aria-labelledby={`${listId}-${tab.id}`}
            className="mt-6"
          >
            {tab.panel}
          </div>
        ) : null,
      )}
    </div>
  );
}
