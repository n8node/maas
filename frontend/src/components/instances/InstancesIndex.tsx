"use client";

import {
  Database,
  HelpCircle,
  LayoutGrid,
  LayoutList,
  Plus,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import { InstancesShell } from "@/components/instances/InstancesShell";
import {
  billingMeRequest,
  getRagStats,
  getWikiHealth,
  listInstances,
  type BillingMeData,
  type MeUser,
  type MemoryInstanceDTO,
  type RAGStatsDTO,
  type WikiHealthDTO,
} from "@/lib/api";
import { getToken } from "@/lib/token";

type FilterType = "all" | "rag" | "wiki" | "episodic";
type SortKey = "updated" | "name";
type ViewMode = "grid" | "list";

type CardMetrics =
  | { kind: "rag"; stats: RAGStatsDTO }
  | { kind: "wiki"; health: WikiHealthDTO };

const TYPE_META: Record<
  string,
  { label: string; short: string; color: string; bg: string }
> = {
  rag: { label: "RAG", short: "RAG", color: "#185fa5", bg: "#e6f1fb" },
  wiki: { label: "Wiki", short: "Wiki", color: "#534ab7", bg: "#eeedfe" },
  episodic: { label: "Episodic", short: "Episodic", color: "#3b6d11", bg: "#eaf3de" },
  working: { label: "Working", short: "Working", color: "#854f0b", bg: "#faeeda" },
  graph: { label: "Graph", short: "Graph", color: "#993c1d", bg: "#faece7" },
  reflective: { label: "Reflective", short: "Reflective", color: "#993556", bg: "#fbeaf0" },
};

function typeMeta(t: string) {
  const k = t.toLowerCase();
  return TYPE_META[k] ?? { label: t, short: t, color: "#5f5e5a", bg: "#f3f2ef" };
}

function formatUpdated(iso: string): string {
  try {
    const d = new Date(iso);
    const t = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return `Updated ${t} · ${date}`;
  } catch {
    return iso;
  }
}

function ragHealthPercent(stats: RAGStatsDTO): number | null {
  if (stats.high_conf_percent != null && !Number.isNaN(stats.high_conf_percent)) {
    return Math.min(100, Math.max(0, Math.round(stats.high_conf_percent)));
  }
  if (stats.coverage_percent != null && !Number.isNaN(stats.coverage_percent)) {
    return Math.min(100, Math.max(0, Math.round(stats.coverage_percent)));
  }
  return null;
}

function wikiHealthPercent(h: WikiHealthDTO): number {
  const cov = Math.min(1, Math.max(0, h.coverage));
  const stale = Math.min(1, Math.max(0, h.stale_ratio));
  const score = cov * (1 - stale * 0.5) + (h.purity ?? 0) * 0.25;
  return Math.min(100, Math.max(0, Math.round(score * 100)));
}

export function InstancesIndex({ user, onLogout }: { user: MeUser; onLogout?: () => void }) {
  const token = getToken() ?? "";
  const [items, setItems] = useState<MemoryInstanceDTO[]>([]);
  const [billing, setBilling] = useState<BillingMeData | null>(null);
  const [metricsById, setMetricsById] = useState<Record<string, CardMetrics>>({});
  const [loading, setLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [view, setView] = useState<ViewMode>("grid");
  const [infoOpen, setInfoOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setErr(null);
    setLoading(true);
    try {
      const [list, bill] = await Promise.all([listInstances(token), billingMeRequest(token)]);
      setItems(list);
      setBilling(bill);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load instances");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!token || items.length === 0) {
      setMetricsById({});
      return;
    }
    let cancelled = false;
    setMetricsLoading(true);
    (async () => {
      const next: Record<string, CardMetrics> = {};
      await Promise.all(
        items.map(async (inst) => {
          try {
            if (inst.memory_type === "rag") {
              const stats = await getRagStats(token, inst.id);
              next[inst.id] = { kind: "rag", stats };
            } else if (inst.memory_type === "wiki") {
              const health = await getWikiHealth(token, inst.id);
              next[inst.id] = { kind: "wiki", health };
            }
          } catch {
            /* ignore per-instance errors */
          }
        }),
      );
      if (!cancelled) setMetricsById(next);
      if (!cancelled) setMetricsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, items]);

  const maxInstances = billing?.plan?.max_instances ?? 2;
  const planName = billing?.plan?.name ?? "Free";

  const filteredSorted = useMemo(() => {
    let rows = items.slice();
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    if (filterType !== "all") rows = rows.filter((r) => r.memory_type.toLowerCase() === filterType);
    if (activeOnly) rows = rows.filter((r) => r.status.toLowerCase() === "active");
    rows.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return rows;
  }, [items, search, filterType, activeOnly, sortKey]);

  const kpis = useMemo(() => {
    let queriesToday = 0;
    let totalChunksConcepts = 0;
    const healthSamples: number[] = [];

    for (const inst of items) {
      const m = metricsById[inst.id];
      if (!m) continue;
      if (m.kind === "rag") {
        queriesToday += Number(m.stats.queries_today ?? 0);
        totalChunksConcepts += Number(m.stats.chunk_count ?? 0);
        const hp = ragHealthPercent(m.stats);
        if (hp != null) healthSamples.push(hp);
      }
      if (m.kind === "wiki") {
        totalChunksConcepts += Number(m.health.concept_count ?? 0);
        healthSamples.push(wikiHealthPercent(m.health));
      }
    }

    const avgHealth =
      healthSamples.length > 0
        ? Math.round(healthSamples.reduce((a, b) => a + b, 0) / healthSamples.length)
        : null;

    return {
      instanceFraction: `${items.length} / ${maxInstances}`,
      instancePct: maxInstances > 0 ? Math.min(100, Math.round((items.length / maxInstances) * 100)) : 0,
      queriesToday,
      avgHealth,
      totalChunksConcepts,
    };
  }, [items, metricsById, maxInstances]);

  const atInstanceLimit = maxInstances > 0 && items.length >= maxInstances;

  return (
    <InstancesShell
      user={user}
      onLogout={onLogout}
      title="Memory instances"
      headerRight={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border2 bg-bg px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-bg2"
          >
            <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            What is this?
          </button>
          <Link
            href="/instances/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-bg hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            New instance
          </Link>
        </div>
      }
    >
      <div className="w-full min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-7">
        <div
          className="mb-5 rounded-[12px] border px-4 py-3 text-[12px] leading-relaxed text-ink"
          style={{ borderColor: "#b5d4f4", backgroundColor: "#e6f1fb" }}
        >
          <strong className="font-medium">Memory instances</strong> are isolated stores you attach to agents or apps.{" "}
          <span className="text-muted">RAG</span> keeps chunked text for retrieval (optional LLM synthesis on query).{" "}
          <span className="text-muted">Wiki</span> builds concept hypotheses with lineage and gardener workflows. Other memory types ship
          over time.
        </div>

        {err ? (
          <div className="mb-5 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-xs text-error">{err}</div>
        ) : null}

        {atInstanceLimit ? (
          <div
            className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-[12px]"
            style={{ borderColor: "#e8c48a", backgroundColor: "#faeeda", color: "#633806" }}
          >
            <span>
              You&apos;re using <strong>{items.length}</strong> / <strong>{maxInstances}</strong> instances on{" "}
              <strong>{planName}</strong>. Upgrade for a higher limit.
            </span>
            <Link href="/billing" className="font-medium underline hover:opacity-90">
              Billing
            </Link>
          </div>
        ) : null}

        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search instances…"
            className="w-full max-w-md rounded-lg border border-border2 bg-bg px-3 py-2 text-[13px] outline-none focus:border-[#888] lg:flex-1"
          />
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "rag", "wiki", "episodic"] as const).map((ft) => (
              <button
                key={ft}
                type="button"
                onClick={() => setFilterType(ft)}
                className={clsx(
                  "rounded-full border px-3 py-1 text-[11px] font-medium capitalize",
                  filterType === ft
                    ? "border-ink bg-bg2 text-ink"
                    : "border-border bg-bg text-muted hover:bg-bg2",
                )}
              >
                {ft === "all" ? "All" : typeMeta(ft).label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setActiveOnly((v) => !v)}
              className={clsx(
                "rounded-full border px-3 py-1 text-[11px] font-medium",
                activeOnly ? "border-ink bg-bg2 text-ink" : "border-border bg-bg text-muted hover:bg-bg2",
              )}
            >
              Active
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <label className="flex items-center gap-2 text-[11px] text-muted">
              Sort
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-ink"
              >
                <option value="updated">Recently updated</option>
                <option value="name">Name A–Z</option>
              </select>
            </label>
            <div className="flex rounded-md border border-border p-0.5">
              <button
                type="button"
                title="Grid view"
                onClick={() => setView("grid")}
                className={clsx(
                  "rounded px-2 py-1",
                  view === "grid" ? "bg-bg2 text-ink" : "text-muted hover:bg-bg2/80",
                )}
              >
                <LayoutGrid className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </button>
              <button
                type="button"
                title="List view"
                onClick={() => setView("list")}
                className={clsx(
                  "rounded px-2 py-1",
                  view === "list" ? "bg-bg2 text-ink" : "text-muted hover:bg-bg2/80",
                )}
              >
                <LayoutList className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label={`Instances (plan limit)`}
            value={kpis.instanceFraction}
            bar={{ pct: kpis.instancePct, variant: "gold" }}
          />
          <KpiCard label="Queries today" value={String(kpis.queriesToday)} />
          <KpiCard
            label="Avg health"
            value={kpis.avgHealth != null ? `${kpis.avgHealth}%` : "—"}
            bar={kpis.avgHealth != null ? { pct: kpis.avgHealth, variant: "ink" } : undefined}
          />
          <KpiCard label="Total concepts / chunks" value={String(kpis.totalChunksConcepts)} />
        </div>

        {loading ? (
          <p className="text-[13px] text-muted">Loading instances…</p>
        ) : filteredSorted.length === 0 && items.length === 0 ? (
          <div className="rounded-[12px] border border-border bg-bg px-6 py-14 text-center">
            <Database className="mx-auto mb-3 h-8 w-8 text-muted opacity-60" strokeWidth={1.25} aria-hidden />
            <p className="text-[13px] font-medium text-ink">No instances yet</p>
            <p className="mt-1 text-[12px] text-muted">Create your first memory instance to start ingesting and querying.</p>
            <Link
              href="/instances/new"
              className="mt-4 inline-flex rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-bg hover:opacity-90"
            >
              New instance
            </Link>
          </div>
        ) : filteredSorted.length === 0 ? (
          <p className="text-[13px] text-muted">No instances match your filters.</p>
        ) : view === "grid" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredSorted.map((inst) => (
              <InstanceCard key={inst.id} inst={inst} metrics={metricsById[inst.id]} metricsLoading={metricsLoading} />
            ))}
            <NewInstancePlaceholder />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[12px] border border-border bg-bg">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="border-b border-border bg-bg2 text-[10px] font-medium uppercase tracking-wide text-subtle">
                <tr>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Queries / day</th>
                  <th className="px-4 py-2.5 text-right">Chunks / concepts</th>
                  <th className="px-4 py-2.5">Health</th>
                  <th className="px-4 py-2.5 text-right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filteredSorted.map((inst) => (
                  <InstanceRow key={inst.id} inst={inst} metrics={metricsById[inst.id]} metricsLoading={metricsLoading} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {infoOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="instances-info-title"
            onClick={() => setInfoOpen(false)}
          >
            <div
              className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-[12px] border border-border bg-bg p-6 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="instances-info-title" className="text-[15px] font-medium text-ink">
                Memory instances
              </h2>
              <p className="mt-3 text-[13px] leading-relaxed text-muted">
                Each instance is a dedicated memory store with its own API endpoints. Choose a memory type when you create it: RAG for
                documents and similarity search, Wiki for evolving concepts and lineage. You can create multiple instances up to your plan
                limit and route different agents or environments to different instances.
              </p>
              <button
                type="button"
                className="mt-6 rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-bg hover:opacity-90"
                onClick={() => setInfoOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </InstancesShell>
  );
}

function KpiCard({
  label,
  value,
  sub,
  bar,
}: {
  label: string;
  value: string;
  sub?: string;
  bar?: { pct: number; variant: "gold" | "ink" };
}) {
  const barBg = bar?.variant === "gold" ? "rgba(184,147,62,0.35)" : "#e8e7e3";
  const barFill = bar?.variant === "gold" ? "#c9a227" : "#1a1a1a";
  return (
    <div className="rounded-[12px] border border-border bg-bg px-4 py-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">{label}</div>
      <div className="mt-2 text-2xl font-medium tracking-tight text-ink">{value}</div>
      {sub ? <div className="mt-1 text-[11px] text-muted">{sub}</div> : null}
      {bar ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: barBg }}>
          <div className="h-full rounded-full transition-[width]" style={{ width: `${bar.pct}%`, backgroundColor: barFill }} />
        </div>
      ) : null}
    </div>
  );
}

function InstanceCard({
  inst,
  metrics,
  metricsLoading,
}: {
  inst: MemoryInstanceDTO;
  metrics?: CardMetrics;
  metricsLoading: boolean;
}) {
  const meta = typeMeta(inst.memory_type);
  const active = inst.status.toLowerCase() === "active";

  let queries = "—";
  let bulk = "—";
  let bulkLabel = "Chunks";
  let healthPct: number | null = null;

  if (metrics?.kind === "rag") {
    queries = String(metrics.stats.queries_today ?? 0);
    bulk = String(metrics.stats.chunk_count ?? 0);
    bulkLabel = "Chunks";
    healthPct = ragHealthPercent(metrics.stats);
  } else if (metrics?.kind === "wiki") {
    queries = "—";
    bulk = String(metrics.health.concept_count ?? 0);
    bulkLabel = "Concepts";
    healthPct = wikiHealthPercent(metrics.health);
  }

  const healthColor =
    healthPct == null ? "#888780" : healthPct >= 70 ? "#3b6d11" : healthPct >= 40 ? "#ba7517" : "#a32d2d";

  return (
    <Link
      href={`/instances/${inst.id}`}
      className="flex flex-col rounded-[12px] border border-border bg-bg p-4 transition-colors hover:border-border2 hover:bg-bg2/30"
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: meta.bg, color: meta.color }}
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[14px] font-medium text-ink">{inst.name}</span>
            <span
              className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ backgroundColor: meta.bg, color: meta.color }}
            >
              {meta.short}
            </span>
            <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
              <span
                className="absolute h-2 w-2 rounded-full"
                style={{ backgroundColor: active ? "#639922" : "#888780" }}
                aria-hidden
              />
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-[10px] uppercase tracking-wide text-subtle">
            <div>
              <div>Queries / day</div>
              <div className="mt-1 text-[15px] font-medium normal-case tracking-normal text-ink">
                {metricsLoading ? "…" : queries}
              </div>
            </div>
            <div>
              <div>{bulkLabel}</div>
              <div className="mt-1 text-[15px] font-medium normal-case tracking-normal text-ink">
                {metricsLoading ? "…" : bulk}
              </div>
            </div>
            <div>
              <div>Health</div>
              <div className="mt-1.5">
                {metricsLoading ? (
                  <span className="text-[13px] text-muted">…</span>
                ) : healthPct != null ? (
                  <>
                    <div className="text-[15px] font-medium normal-case tracking-normal text-ink">{healthPct}%</div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-bg3">
                      <div className="h-full rounded-full" style={{ width: `${healthPct}%`, backgroundColor: healthColor }} />
                    </div>
                  </>
                ) : (
                  <span className="text-[13px] text-muted">—</span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 text-[11px] text-subtle">{formatUpdated(inst.updated_at)}</div>
        </div>
      </div>
    </Link>
  );
}

function InstanceRow({
  inst,
  metrics,
  metricsLoading,
}: {
  inst: MemoryInstanceDTO;
  metrics?: CardMetrics;
  metricsLoading: boolean;
}) {
  const meta = typeMeta(inst.memory_type);
  let queries = "—";
  let bulk = "—";
  let healthPct: number | null = null;
  if (metrics?.kind === "rag") {
    queries = String(metrics.stats.queries_today ?? 0);
    bulk = String(metrics.stats.chunk_count ?? 0);
    healthPct = ragHealthPercent(metrics.stats);
  } else if (metrics?.kind === "wiki") {
    bulk = String(metrics.health.concept_count ?? 0);
    healthPct = wikiHealthPercent(metrics.health);
  }
  const healthColor =
    healthPct == null ? "#888780" : healthPct >= 70 ? "#3b6d11" : healthPct >= 40 ? "#ba7517" : "#a32d2d";

  return (
    <tr className="border-b border-border last:border-0 hover:bg-bg2/40">
      <td className="px-4 py-3">
        <Link href={`/instances/${inst.id}`} className="font-medium text-accent hover:underline">
          {inst.name}
        </Link>
      </td>
      <td className="px-4 py-3">
        <span className="rounded-md px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: meta.bg, color: meta.color }}>
          {meta.label}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="rounded-md bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-text">{inst.status}</span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">{metricsLoading ? "…" : queries}</td>
      <td className="px-4 py-3 text-right tabular-nums">{metricsLoading ? "…" : bulk}</td>
      <td className="px-4 py-3">
        {metricsLoading ? (
          "…"
        ) : healthPct != null ? (
          <div className="flex items-center gap-2">
            <span className="tabular-nums text-[12px]">{healthPct}%</span>
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-bg3">
              <div className="h-full rounded-full" style={{ width: `${healthPct}%`, backgroundColor: healthColor }} />
            </div>
          </div>
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-3 text-right text-[12px] text-subtle">{formatUpdated(inst.updated_at)}</td>
    </tr>
  );
}

function NewInstancePlaceholder() {
  return (
    <Link
      href="/instances/new"
      className="flex min-h-[180px] flex-col items-center justify-center rounded-[12px] border-2 border-dashed border-border2 bg-bg3/50 px-4 py-8 text-center transition-colors hover:border-border hover:bg-bg2/40"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border2 bg-bg">
        <Plus className="h-5 w-5 text-muted" strokeWidth={2} aria-hidden />
      </div>
      <div className="mt-3 text-[14px] font-medium text-ink">New instance</div>
      <div className="mt-2 text-[11px] leading-snug text-muted">
        <span className="text-accent">RAG</span>
        {", "}
        <span style={{ color: "#534ab7" }}>Wiki</span>
        {", Episodic, Working, Graph, Reflective"}
      </div>
    </Link>
  );
}
