"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import clsx from "clsx";

import {
  getEpisodicStats,
  ingestInstance,
  listEpisodicEpisodes,
  patchInstance,
  queryInstance,
  type EpisodicEpisodeDTO,
  type EpisodicStatsDTO,
  type MemoryInstanceDTO,
  type QueryResultDTO,
} from "@/lib/api";
import { formatTokens } from "@/lib/format";
import { getToken } from "@/lib/token";

type EpisodicTab = "playground" | "episodes" | "timeline" | "decay" | "settings";

const MEMORY_PILLS = [
  { id: "rag", label: "RAG", href: "/instances/new?type=rag", col: "#185fa5", bg: "#e6f1fb", soon: false },
  { id: "wiki", label: "Wiki", href: "/instances/new?type=wiki", col: "#534ab7", bg: "#eeedfe", soon: false },
  { id: "episodic", label: "Episodic", href: "#", col: "#3b6d11", bg: "#eaf3de", soon: false },
  { id: "working", label: "Working", href: "/instances/new?type=working", col: "#854f0b", bg: "#faeeda", soon: false },
  { id: "graph", label: "Graph", href: "/instances/new?type=graph", col: "#993c1d", bg: "#faece7", soon: false },
  { id: "reflective", label: "Reflective", href: "#", col: "#993556", bg: "#fbeaf0", soon: true },
  { id: "agent", label: "Agent (unified)", href: "#", col: "#1a1a1a", bg: "#f3f2ef", soon: true },
] as const;

function formatCompactCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.floor(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    const s = k >= 10 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, "");
    return `${s}K`;
  }
  const m = n / 1_000_000;
  const s = m >= 10 ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, "");
  return `${s}M`;
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const d = Date.now() - t;
  const sec = Math.floor(d / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const dd = Math.floor(h / 24);
  if (dd < 30) return `${dd}d ago`;
  const mo = Math.floor(dd / 30);
  if (mo < 12) return `${mo}mo ago`;
  return new Date(iso).toLocaleDateString();
}

/** e.g. "2 days old" for decay impact preview */
function formatAgeNatural(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "1 day old";
  if (days < 7) return `${days} days old`;
  const w = Math.floor(days / 7);
  if (w === 1) return "1 week old";
  if (w < 5) return `${w} weeks old`;
  const mo = Math.floor(days / 30);
  if (mo === 1) return "1 month old";
  return `${mo} months old`;
}

function episodeShortId(raw: unknown): string {
  const compact = String(raw ?? "").replace(/-/g, "");
  const head = compact.slice(0, 6) || compact;
  return `ep_${head}`;
}

function effectiveRetrievalWeight(createdAtIso: string, decayWeight: number, dailyFactor: number): number {
  const ageDays = Math.max(0, (Date.now() - new Date(createdAtIso).getTime()) / 86400000);
  const envDecay = Math.exp(-dailyFactor * ageDays);
  return Math.min(1, Math.max(0, decayWeight * envDecay));
}

function weightColor(v: number): string {
  if (v >= 0.6) return "#639922";
  if (v >= 0.3) return "#ba7517";
  return "#e24b4a";
}

export function EpisodicInstancePanels({
  instanceId,
  inst,
  onRefreshInstance,
  onDeleteInstance,
}: {
  instanceId: string;
  inst: MemoryInstanceDTO;
  onRefreshInstance: () => void;
  onDeleteInstance: () => void | Promise<void>;
}) {
  const token = getToken() ?? "";
  const [tab, setTab] = useState<EpisodicTab>("playground");
  const [stats, setStats] = useState<EpisodicStatsDTO | null>(null);
  const [episodes, setEpisodes] = useState<EpisodicEpisodeDTO[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodesTextFilter, setEpisodesTextFilter] = useState("");
  const [userIdFilterDraft, setUserIdFilterDraft] = useState("");
  const [userIdFilterQuery, setUserIdFilterQuery] = useState("");

  const [ingestText, setIngestText] = useState("");
  const [ingestUser, setIngestUser] = useState("");
  const [ingestSession, setIngestSession] = useState("");
  const [ingestValidDate, setIngestValidDate] = useState("");
  const [validTimeUseSystem, setValidTimeUseSystem] = useState(true);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);

  const [queryText, setQueryText] = useState("");
  const [queryUser, setQueryUser] = useState("");
  const [querySession, setQuerySession] = useState("");
  const [queryAsOf, setQueryAsOf] = useState("");
  const [queryTopK, setQueryTopK] = useState(5);
  const [queryBusy, setQueryBusy] = useState(false);
  const [queryMsg, setQueryMsg] = useState<string | null>(null);
  const [queryBody, setQueryBody] = useState<QueryResultDTO | null>(null);

  const [pitDate, setPitDate] = useState("");
  const [pitBusy, setPitBusy] = useState(false);
  const [pitBody, setPitBody] = useState<QueryResultDTO | null>(null);
  const [pitErr, setPitErr] = useState<string | null>(null);

  const [settingsBusy, setSettingsBusy] = useState(false);
  const [decayRunHint, setDecayRunHint] = useState<string | null>(null);

  const decayCfg = ((inst.config?.decay ?? {}) as Record<string, unknown>) ?? {};
  const initialDailyFactor =
    typeof decayCfg.daily_factor === "number" && Number.isFinite(decayCfg.daily_factor) ? decayCfg.daily_factor : 0.05;
  const initialThreshold =
    typeof decayCfg.retrieval_threshold === "number" && Number.isFinite(decayCfg.retrieval_threshold)
      ? decayCfg.retrieval_threshold
      : 0.12;

  const [decayDailyFactor, setDecayDailyFactor] = useState(Math.max(0.01, Math.min(0.3, initialDailyFactor)));
  const [decayThreshold, setDecayThreshold] = useState(initialThreshold);

  useEffect(() => {
    const df =
      typeof decayCfg.daily_factor === "number" && Number.isFinite(decayCfg.daily_factor) ? decayCfg.daily_factor : 0.05;
    const th =
      typeof decayCfg.retrieval_threshold === "number" && Number.isFinite(decayCfg.retrieval_threshold)
        ? decayCfg.retrieval_threshold
        : 0.12;
    setDecayDailyFactor(Math.max(0.01, Math.min(0.3, df)));
    setDecayThreshold(th);
  }, [inst.id, initialDailyFactor, initialThreshold]);

  const biTemporalOn = useMemo(() => {
    const bt = inst.config?.bi_temporal as Record<string, unknown> | undefined;
    return bt?.enabled === true;
  }, [inst.config]);

  const loadStats = useCallback(async () => {
    if (!token) return;
    try {
      setStats(await getEpisodicStats(token, instanceId));
    } catch {
      setStats(null);
    }
  }, [token, instanceId]);

  const loadEpisodes = useCallback(async () => {
    if (!token) return;
    setEpisodesLoading(true);
    try {
      setEpisodes(
        await listEpisodicEpisodes(token, instanceId, {
          user_id: userIdFilterQuery || undefined,
          limit: 180,
        }),
      );
    } catch {
      setEpisodes([]);
    } finally {
      setEpisodesLoading(false);
    }
  }, [token, instanceId, userIdFilterQuery]);

  useEffect(() => {
    const id = window.setTimeout(() => setUserIdFilterQuery(userIdFilterDraft.trim()), 350);
    return () => window.clearTimeout(id);
  }, [userIdFilterDraft]);

  useEffect(() => {
    void loadStats();
    void loadEpisodes();
  }, [loadStats, loadEpisodes]);

  const displayedEpisodes = useMemo(() => {
    const list = episodes ?? [];
    const q = episodesTextFilter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) => String(e.content ?? "").toLowerCase().includes(q));
  }, [episodes, episodesTextFilter]);

  const decayPreviewRows = useMemo(() => {
    const rate = decayDailyFactor;
    const list = episodes ?? [];
    const scored = list.map((ep) => ({
      ep,
      eff: effectiveRetrievalWeight(ep.created_at, ep.decay_weight ?? 1, rate),
    }));
    scored.sort((a, b) => b.eff - a.eff);
    return scored.slice(0, 4);
  }, [episodes, decayDailyFactor]);

  async function onIngest(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!validTimeUseSystem && !ingestValidDate) {
      setIngestMsg("Select a valid time or enable system time.");
      return;
    }
    setIngestBusy(true);
    setIngestMsg(null);
    try {
      const r = await ingestInstance(token, instanceId, {
        text: ingestText,
        user_id: ingestUser.trim() || undefined,
        session_id: ingestSession.trim() || undefined,
        valid_from: !validTimeUseSystem && ingestValidDate ? `${ingestValidDate}T00:00:00Z` : undefined,
      });
      setIngestMsg(`Recorded 1 episode · ${formatTokens(r.tokens_consumed)} tokens.`);
      setIngestText("");
      void loadStats();
      void loadEpisodes();
    } catch (err) {
      setIngestMsg(err instanceof Error ? err.message : "Record failed");
    } finally {
      setIngestBusy(false);
    }
  }

  async function onQuery(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setQueryBusy(true);
    setQueryMsg(null);
    setQueryBody(null);
    try {
      const r = await queryInstance(token, instanceId, {
        query: queryText,
        top_k: queryTopK,
        user_id: queryUser.trim() || undefined,
        session_id: querySession.trim() || undefined,
        as_of: queryAsOf ? `${queryAsOf}T00:00:00Z` : undefined,
        synthesize: false,
      });
      setQueryBody(r);
    } catch (err) {
      setQueryMsg(err instanceof Error ? err.message : "Query failed");
    } finally {
      setQueryBusy(false);
    }
  }

  async function onPointInTimeQuery() {
    if (!token) return;
    setPitBusy(true);
    setPitErr(null);
    setPitBody(null);
    try {
      const r = await queryInstance(token, instanceId, {
        query: "recent",
        top_k: 8,
        as_of: pitDate ? `${pitDate}T00:00:00Z` : undefined,
        synthesize: false,
      });
      setPitBody(r);
    } catch (err) {
      setPitErr(err instanceof Error ? err.message : "Query failed");
    } finally {
      setPitBusy(false);
    }
  }

  async function onSaveDecay() {
    if (!token) return;
    setSettingsBusy(true);
    try {
      await patchInstance(token, instanceId, {
        config: {
          ...inst.config,
          decay: {
            ...((inst.config?.decay ?? {}) as Record<string, unknown>),
            daily_factor: Number(decayDailyFactor.toFixed(2)),
            retrieval_threshold: Number(decayThreshold.toFixed(2)),
          },
        },
      });
      onRefreshInstance();
    } finally {
      setSettingsBusy(false);
    }
  }

  async function onPauseToggle() {
    if (!token) return;
    setSettingsBusy(true);
    try {
      await patchInstance(token, instanceId, {
        status: inst.status === "active" ? "paused" : "active",
      });
      onRefreshInstance();
    } finally {
      setSettingsBusy(false);
    }
  }

  const timelineBars = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const ep of episodes) {
      const d = new Date(ep.created_at);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
    }
    const entries = Array.from(byMonth.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-10);
    const max = entries.reduce((m, x) => Math.max(m, x.count), 1);
    return entries.map((x) => ({
      ...x,
      height: Math.max(8, Math.round((x.count / max) * 72)),
      label: new Date(`${x.key}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short" }),
    }));
  }, [episodes]);

  const timelineTotal = stats?.episodes_count ?? episodes.length;
  const anchoredPct =
    stats && typeof stats.anchored_pct === "number"
      ? stats.anchored_pct
      : stats?.coverage
        ? Math.max(1, Math.round(stats.coverage * 0.894))
        : 0;
  const historyMonths =
    stats && typeof stats.history_months === "number" ? stats.history_months : stats?.oldest_entry ? 1 : 0;
  const queriesToday = stats && typeof stats.queries_today === "number" ? stats.queries_today : 0;

  const tabs: [EpisodicTab, string][] = [
    ["playground", "Playground"],
    ["episodes", "Episodes"],
    ["timeline", "Timeline"],
    ["decay", "Decay"],
    ["settings", "Settings"],
  ];

  const statusLabel = inst.status ? inst.status.charAt(0).toUpperCase() + inst.status.slice(1) : "—";

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col bg-bg3">
      <div className="border-b border-border bg-bg px-4 py-3 sm:px-6 lg:px-7">
        <div className="flex flex-wrap gap-2">
          {MEMORY_PILLS.map((p) => {
            const active = p.id === "episodic";
            if (p.soon) {
              return (
                <span
                  key={p.id}
                  className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-border bg-bg2 px-3 py-1.5 text-[12px] text-muted opacity-60"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-border2" aria-hidden />
                  {p.label}
                </span>
              );
            }
            if (active) {
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
            return (
              <Link
                key={p.id}
                href={p.href}
                className="inline-flex items-center gap-1.5 rounded-full border border-border2 bg-bg px-3 py-1.5 text-[12px] text-muted hover:bg-bg2 hover:text-ink"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.col }} aria-hidden />
                {p.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg px-4 py-3 sm:px-6 lg:px-7">
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <Link href="/instances" className="hover:text-ink">
            Instances
          </Link>
          <span className="text-border">·</span>
          <span className="font-semibold text-ink">{inst.name}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            <span className={clsx("h-2 w-2 rounded-full", inst.status === "active" ? "bg-[#639922]" : "bg-[#ba7517]")} />
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={() => {
              setTab("decay");
              setDecayRunHint(null);
            }}
            className="rounded-lg border border-border2 bg-bg px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-bg2"
          >
            Run decay
          </button>
          <button
            type="button"
            onClick={() => setTab("settings")}
            className="rounded-lg border border-border2 bg-bg px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-bg2"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => setTab("playground")}
            className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-bg hover:opacity-90"
          >
            Ingest
          </button>
        </div>
      </div>

      <div className="grid w-full min-w-0 grid-cols-2 border-b border-border bg-bg sm:grid-cols-3 lg:grid-cols-5">
        <KpiCell
          label="Episodes"
          value={stats ? formatCompactCount(stats.episodes_count) : "—"}
          sub={biTemporalOn ? "bi-temporal on" : "bi-temporal ready"}
        />
        <KpiCell
          label="Avg decay"
          value={
            stats != null && typeof stats.avg_decay === "number" && !Number.isNaN(stats.avg_decay)
              ? stats.avg_decay.toFixed(2)
              : "—"
          }
          sub={`rate: ${decayDailyFactor.toFixed(2)}/day`}
        />
        <KpiCell label="Queries today" value={stats ? String(queriesToday) : "—"} sub={`${stats?.users_count ?? 0} users scoped`} />
        <KpiCell
          label="Oldest entry"
          value={stats?.oldest_entry || "—"}
          sub={historyMonths > 0 ? `${historyMonths} months history` : "—"}
        />
        <KpiCell
          label="Coverage"
          value={stats ? `${stats.coverage}%` : "—"}
          sub={stats ? `anchored ${anchoredPct}%` : undefined}
          className="lg:border-r-0"
        />
      </div>

      <div className="relative z-20 border-b border-border bg-bg px-4 sm:px-6 lg:px-7">
        <nav className="flex flex-wrap gap-1 pt-1" aria-label="Episodic sections">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={clsx(
                "-mb-px border-b-2 px-3 py-3 text-[13px] transition-colors",
                tab === id
                  ? clsx("font-medium text-ink", id === "playground" ? "border-[#3b6d11]" : "border-ink")
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="relative z-0 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {tab === "playground" ? (
          <div className="grid w-full min-w-0 grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:px-7 lg:py-7">
            <div className="flex min-w-0 flex-col gap-4">
              <section className="rounded-[12px] border border-border bg-bg p-4 sm:p-5">
                <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Record episode</h2>
                <form onSubmit={onIngest} className="mt-3 space-y-3">
                  <textarea
                    value={ingestText}
                    onChange={(e) => setIngestText(e.target.value)}
                    rows={6}
                    className="w-full resize-y rounded-lg border border-border2 bg-bg3 px-3 py-2 text-[13px] outline-none focus:border-[#888]"
                    placeholder="User mentioned they struggle with sleep this week..."
                    required
                  />
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                    <input
                      value={ingestUser}
                      onChange={(e) => setIngestUser(e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-border bg-bg3 px-3 py-2 text-[12px]"
                      placeholder="user_id"
                    />
                    <input
                      value={ingestSession}
                      onChange={(e) => setIngestSession(e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-border bg-bg3 px-3 py-2 text-[12px]"
                      placeholder="session_id"
                    />
                    <button
                      type="submit"
                      disabled={ingestBusy}
                      className="shrink-0 rounded-lg bg-ink px-5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50 sm:self-stretch"
                    >
                      {ingestBusy ? "Recording…" : "Record"}
                    </button>
                  </div>
                  {ingestMsg ? (
                    <p className={clsx("text-[12px]", ingestMsg.includes("Recorded") ? "text-success-text" : "text-error")}>{ingestMsg}</p>
                  ) : null}
                </form>
              </section>

              <section className="rounded-[12px] border border-border bg-bg p-4 sm:p-5">
                <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Bi-temporal controls</h2>
                <p className="mt-2 text-[12px] text-muted">Valid time — when did this happen?</p>
                <div className="mt-3 space-y-3">
                  <input
                    type="date"
                    value={ingestValidDate}
                    onChange={(e) => setIngestValidDate(e.target.value)}
                    disabled={validTimeUseSystem}
                    className="w-full rounded-md border border-border bg-bg3 px-3 py-2 text-[12px] disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-xs"
                  />
                  <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink">
                    <input
                      type="radio"
                      name="episodic-valid-time"
                      checked={validTimeUseSystem}
                      onChange={() => setValidTimeUseSystem(true)}
                      className="h-3.5 w-3.5 accent-[#3b6d11]"
                    />
                    System time auto-set to now
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink">
                    <input
                      type="radio"
                      name="episodic-valid-time"
                      checked={!validTimeUseSystem}
                      onChange={() => setValidTimeUseSystem(false)}
                      className="h-3.5 w-3.5 accent-[#3b6d11]"
                    />
                    Set valid time manually (above)
                  </label>
                </div>
              </section>
            </div>

            <section className="min-w-0 rounded-[12px] border border-border bg-bg p-4 sm:p-5">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Semantic search with decay</h2>
              <form onSubmit={onQuery} className="mt-3 space-y-3">
                <input
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  className="w-full rounded-md border border-border bg-bg3 px-3 py-2 text-[13px]"
                  placeholder="What did user mention about sleep?"
                  required
                />
                <details className="rounded-lg border border-border bg-bg2/40 px-3 py-2 text-[12px]">
                  <summary className="cursor-pointer font-medium text-muted">Scope & options</summary>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      value={queryUser}
                      onChange={(e) => setQueryUser(e.target.value)}
                      className="rounded-md border border-border bg-bg px-3 py-2 text-[12px]"
                      placeholder="user_id (optional)"
                    />
                    <input
                      value={querySession}
                      onChange={(e) => setQuerySession(e.target.value)}
                      className="rounded-md border border-border bg-bg px-3 py-2 text-[12px]"
                      placeholder="session_id (optional)"
                    />
                    <input
                      type="date"
                      value={queryAsOf}
                      onChange={(e) => setQueryAsOf(e.target.value)}
                      className="rounded-md border border-border bg-bg px-3 py-2 text-[12px]"
                    />
                    <select
                      value={queryTopK}
                      onChange={(e) => setQueryTopK(Number(e.target.value))}
                      className="rounded-md border border-border bg-bg px-2 py-2 text-[12px]"
                    >
                      {[3, 5, 8, 12].map((k) => (
                        <option key={k} value={k}>
                          top_k = {k}
                        </option>
                      ))}
                    </select>
                  </div>
                </details>
                <button
                  type="submit"
                  disabled={queryBusy}
                  className="w-full rounded-lg bg-ink px-4 py-2.5 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
                >
                  {queryBusy ? "Searching…" : "Search"}
                </button>
                {queryMsg ? <p className="text-[12px] text-error">{queryMsg}</p> : null}
                {queryBody ? (
                  <div className="space-y-2 border-t border-border pt-3">
                    <div className="rounded-lg border border-[#c8e0b8] bg-[#eaf3de] px-3 py-2 text-[12px] text-[#3b6d11]">{queryBody.message}</div>
                    <p className="text-[11px] text-subtle">Tokens: {formatTokens(queryBody.tokens_used)}</p>
                    {queryBody.citations.map((c, idx) => {
                      const sc = typeof c.score === "number" ? c.score : 0;
                      return (
                        <div key={c.chunk_id || idx} className="rounded-md border border-border2 bg-bg3 px-3 py-2">
                          <div className="mb-1 flex items-center justify-between text-[10px]">
                            <span className="rounded px-1.5 py-0.5 font-mono font-medium text-[#3b6d11]" style={{ background: "#eaf3de" }}>
                              {episodeShortId(String(c.chunk_id))}
                            </span>
                            <span className="text-subtle">weight {sc.toFixed(2)}</span>
                          </div>
                          <p className="text-[12px] text-ink">{c.snippet}</p>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg2">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(4, Math.min(100, Math.round(sc * 100)))}%`,
                                backgroundColor: weightColor(sc),
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </form>
            </section>
          </div>
        ) : null}

        {tab === "episodes" ? (
          <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-7">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={episodesTextFilter}
                onChange={(e) => setEpisodesTextFilter(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-[13px]"
                placeholder="Search episodes…"
              />
              <input
                value={userIdFilterDraft}
                onChange={(e) => setUserIdFilterDraft(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] sm:w-52"
                placeholder="user_id"
              />
            </div>
            {episodesLoading ? (
              <p className="text-[13px] text-muted">Loading…</p>
            ) : episodes.length === 0 ? (
              <div className="rounded-[12px] border border-border bg-bg px-6 py-10 text-center text-[13px] text-muted">No episodes yet.</div>
            ) : displayedEpisodes.length === 0 ? (
              <div className="rounded-[12px] border border-border bg-bg px-6 py-10 text-center text-[13px] text-muted">No matches.</div>
            ) : (
              <div className="overflow-x-auto rounded-[12px] border border-border bg-bg">
                <table className="w-full min-w-[760px] text-left text-[13px]">
                  <thead className="border-b border-border bg-bg2 text-[10px] font-medium uppercase tracking-wide text-subtle">
                    <tr>
                      <th className="px-4 py-2.5">ID</th>
                      <th className="px-4 py-2.5">Content</th>
                      <th className="px-4 py-2.5">User</th>
                      <th className="px-4 py-2.5">Age</th>
                      <th className="px-4 py-2.5">Decay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedEpisodes.map((ep) => {
                      const eff = effectiveRetrievalWeight(ep.created_at, ep.decay_weight ?? 1, decayDailyFactor);
                      return (
                        <tr key={ep.id} className="border-b border-border last:border-0 hover:bg-bg2/50">
                          <td className="px-4 py-3 font-mono text-[11px] text-[#3b6d11]">{episodeShortId(ep.id)}</td>
                          <td className="max-w-[340px] truncate px-4 py-3 text-[12px] text-ink" title={ep.content}>
                            {ep.content}
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] text-muted">{ep.user_scope ?? "—"}</td>
                          <td className="px-4 py-3 text-[11px] text-subtle">{formatRelativeTime(ep.created_at)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-bg2">
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${Math.round(eff * 100)}%`, backgroundColor: weightColor(eff) }}
                                />
                              </div>
                              <span className="text-[11px]">{eff.toFixed(2)}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        {tab === "timeline" ? (
          <div className="w-full min-w-0 space-y-4 px-4 py-6 sm:px-6 lg:px-7">
            <div className="rounded-[12px] border border-border bg-bg p-4 sm:p-5">
              <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Episodes per month</div>
              <div className="flex h-[92px] items-end gap-2">
                {timelineBars.length === 0 ? (
                  <p className="text-[12px] text-muted">No data yet.</p>
                ) : (
                  timelineBars.map((b) => (
                    <div key={b.key} className="flex flex-1 flex-col items-center gap-1">
                      <div className="w-full rounded-t-sm border-t-2 border-[#639922] bg-[#eaf3de]" style={{ height: `${b.height}px` }} />
                      <span className="text-[9px] text-subtle">{b.label}</span>
                    </div>
                  ))
                )}
              </div>
              <p className="mt-3 text-[11px] text-muted">
                Total: {timelineTotal} episodes · Users: {stats?.users_count ?? "—"} · Range: {stats?.oldest_entry ? `${stats.oldest_entry} —` : "—"} now
              </p>
            </div>

            <div className="rounded-[12px] border border-border bg-bg p-4 sm:p-5">
              <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Point-in-time query</div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label className="mb-1 block text-[12px] text-muted">Show state as of:</label>
                  <input
                    type="date"
                    value={pitDate}
                    onChange={(e) => setPitDate(e.target.value)}
                    className="w-full max-w-xs rounded-md border border-border2 bg-bg3 px-3 py-2 text-[12px]"
                  />
                </div>
                <button
                  type="button"
                  disabled={pitBusy}
                  onClick={() => void onPointInTimeQuery()}
                  className="rounded-lg bg-ink px-5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
                >
                  {pitBusy ? "…" : "Query"}
                </button>
              </div>
              {pitErr ? <p className="mt-2 text-[12px] text-error">{pitErr}</p> : null}
              {pitBody ? (
                <div className="mt-4 space-y-2 border-t border-border pt-3">
                  <div className="rounded-lg border border-[#c8e0b8] bg-[#eaf3de] px-3 py-2 text-[12px] text-[#3b6d11]">{pitBody.message}</div>
                  {pitBody.citations.slice(0, 8).map((c, idx) => (
                    <div key={c.chunk_id || idx} className="rounded-md border border-border2 bg-bg3 px-3 py-2 text-[12px] text-ink">
                      <span className="font-mono text-[11px] text-[#3b6d11]">{episodeShortId(String(c.chunk_id))}</span>
                      <span className="text-subtle"> · {(typeof c.score === "number" ? c.score : 0).toFixed(2)}</span>
                      <p className="mt-1 text-[12px]">{c.snippet}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "decay" ? (
          <div className="w-full min-w-0 space-y-4 px-4 py-6 sm:px-6 lg:px-7">
            <div className="rounded-[12px] border border-border bg-bg p-4 sm:p-5">
              <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Decay configuration</div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
                <span>Decay rate</span>
                <span className="font-semibold text-[#3b6d11]">
                  {decayDailyFactor.toFixed(2)}/d
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={30}
                value={Math.round(decayDailyFactor * 100)}
                onChange={(e) => setDecayDailyFactor(Number(e.target.value) / 100)}
                className="w-full accent-[#185fa5]"
              />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDecayRunHint(
                      "Decay weights are applied when you search. A separate batch job is not available for this instance yet.",
                    );
                  }}
                  className="rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-bg hover:opacity-90"
                >
                  Run decay now
                </button>
                <span className="text-[11px] text-subtle">Last run: —</span>
              </div>
              {decayRunHint ? <p className="mt-3 text-[11px] text-muted">{decayRunHint}</p> : null}

              <div className="mt-6 border-t border-border pt-4">
                <div className="mb-2 flex items-center justify-between text-[12px] text-muted">
                  <span>Retrieval threshold</span>
                  <span className="font-medium text-[#3b6d11]">≥ {decayThreshold.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={40}
                  value={Math.round(decayThreshold * 100)}
                  onChange={(e) => setDecayThreshold(Number(e.target.value) / 100)}
                  className="w-full accent-[#3b6d11]"
                />
                <button
                  type="button"
                  onClick={() => void onSaveDecay()}
                  disabled={settingsBusy}
                  className="mt-4 rounded-lg border border-border2 bg-bg px-4 py-2 text-[12px] font-medium text-ink hover:bg-bg2 disabled:opacity-50"
                >
                  {settingsBusy ? "Saving…" : "Save configuration"}
                </button>
              </div>
            </div>

            <div className="rounded-[12px] border border-border bg-bg p-4 sm:p-5">
              <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Decay impact preview</div>
              {decayPreviewRows.length === 0 ? (
                <p className="text-[12px] text-muted">Record episodes to see preview.</p>
              ) : (
                <ul className="space-y-3">
                  {decayPreviewRows.map(({ ep, eff }) => (
                    <li key={ep.id} className="flex items-center gap-3 text-[12px]">
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-ink">
                          <span className="font-mono text-[#3b6d11]">{episodeShortId(ep.id)}</span>
                          <span className="text-subtle"> — {formatAgeNatural(ep.created_at)}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg2">
                          <div className="h-full rounded-full" style={{ width: `${Math.round(eff * 100)}%`, backgroundColor: weightColor(eff) }} />
                        </div>
                      </div>
                      <span className="shrink-0 tabular-nums text-[12px] text-ink">{eff.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {tab === "settings" ? (
          <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-7">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <section className="rounded-[12px] border border-border bg-bg p-4 sm:p-5">
                <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Basic</div>
                <div className="space-y-2 text-[12px]">
                  <div className="flex justify-between border-b border-border py-1.5">
                    <span className="text-subtle">Name</span>
                    <span className="font-semibold text-ink">{inst.name}</span>
                  </div>
                  <div className="flex justify-between border-b border-border py-1.5">
                    <span className="text-subtle">Type</span>
                    <span className="font-medium text-ink">Episodic</span>
                  </div>
                  <div className="flex justify-between border-b border-border py-1.5">
                    <span className="text-subtle">Created</span>
                    <span className="font-medium text-ink">{new Date(inst.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-subtle">Instance ID</span>
                    <span className="font-mono text-[11px] text-ink">{inst.id}</span>
                  </div>
                </div>
              </section>
              <section className="rounded-[12px] border border-border bg-bg p-4 sm:p-5">
                <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Danger zone</div>
                <p className="text-[12px] text-muted">Pausing stops all operations. Deleting is permanent.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => void onPauseToggle()}
                    disabled={settingsBusy}
                    className="rounded-lg border border-border2 bg-bg px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-bg2 disabled:opacity-50"
                  >
                    {inst.status === "active" ? "Pause instance" : "Resume instance"}
                  </button>
                  <button
                    onClick={() => void onDeleteInstance()}
                    className="rounded-lg border border-[#a32d2d] bg-bg px-3 py-1.5 text-[12px] font-medium text-[#a32d2d] hover:bg-[#fcebeb]"
                  >
                    Delete instance
                  </button>
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function KpiCell({ label, value, sub, className }: { label: string; value: ReactNode; sub?: string; className?: string }) {
  return (
    <div className={clsx("border-r border-border px-4 py-3 sm:px-5", className)}>
      <div className="text-[22px] font-medium tracking-tight text-ink">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">{label}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}
