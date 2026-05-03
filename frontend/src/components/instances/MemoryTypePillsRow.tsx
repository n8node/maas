"use client";

import Link from "next/link";
import clsx from "clsx";

/** Cross-links between instance detail pages + create flows. Graph is disabled until APIs ship. */
export const MEMORY_INSTANCE_PILL_SPECS = [
  { id: "rag", label: "RAG", href: "/instances/new?type=rag", col: "#185fa5", bg: "#e6f1fb", soon: false },
  { id: "wiki", label: "Wiki", href: "/instances/new?type=wiki", col: "#534ab7", bg: "#eeedfe", soon: false },
  {
    id: "episodic",
    label: "Episodic",
    href: "/instances/new?type=episodic",
    col: "#3b6d11",
    bg: "#eaf3de",
    soon: false,
  },
  {
    id: "working",
    label: "Working",
    href: "/instances/new?type=working",
    col: "#854f0b",
    bg: "#faeeda",
    soon: false,
  },
  { id: "graph", label: "Graph", href: "#", col: "#993c1d", bg: "#faece7", soon: true },
  { id: "reflective", label: "Reflective", href: "#", col: "#993556", bg: "#fbeaf0", soon: true },
  { id: "agent", label: "Agent (unified)", href: "/agents", col: "#1a1a1a", bg: "#f3f2ef", soon: false },
] as const;

export type MemoryInstancePillId = (typeof MEMORY_INSTANCE_PILL_SPECS)[number]["id"];

type Props = {
  activeId: MemoryInstancePillId;
  /** Rag uses slightly richer link hover */
  hoverStyle?: "default" | "rag";
};

/** Top-of-page memory pills: current type highlighted; "soon" skips link unless it is the active page. */
export function MemoryTypePillsRow({ activeId, hoverStyle = "default" }: Props) {
  const linkClass =
    hoverStyle === "rag"
      ? "inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-border2 hover:bg-bg2 hover:text-ink"
      : "inline-flex items-center gap-1.5 rounded-full border border-border2 bg-bg px-3 py-1.5 text-[12px] text-muted hover:bg-bg2 hover:text-ink";

  return (
    <div className="flex flex-wrap gap-2">
      {MEMORY_INSTANCE_PILL_SPECS.map((p) => {
        if (p.id === activeId) {
          return (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium text-ink shadow-sm"
              style={{ borderColor: p.col, backgroundColor: p.bg }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.col }} aria-hidden />
              {p.label}
            </span>
          );
        }
        if (p.soon) {
          return (
            <span
              key={p.id}
              title="Coming soon"
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-border bg-bg2 px-3 py-1.5 text-[12px] text-muted opacity-60"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-border2" aria-hidden />
              {p.label}
            </span>
          );
        }
        return (
          <Link key={p.id} href={p.href} className={linkClass}>
            <span
              className={clsx(
                "h-1.5 w-1.5 rounded-full",
                hoverStyle === "rag" && "opacity-40",
              )}
              style={{ backgroundColor: p.col }}
              aria-hidden
            />
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}
