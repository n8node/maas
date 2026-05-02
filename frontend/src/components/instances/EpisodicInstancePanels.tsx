"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
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
  { id: "working", label: "Working", href: "#", col: "#854f0b", bg: "#faeeda", soon: true },
  { id: "graph", label: "Graph", href: "#", col: "#993c1d", bg: "#faece7", soon: true },
  { id: "reflective", label: "Reflective", href: "#", col: "#fbeaf0", bg: "#993556", soon: true },
  { id: "agent", label: "Agent (unified)", href: "#", col: "#1a1a1a", bg: "#f3f2ef", soon: true },
] as const;

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
  return new Date(iso).toLocaleDateString();
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
  const [episodesUserFilter, setEpisodesUserFilter] = useState("");

  const [ingestText, setIngestText] = useState("");
  const [ingestUser, setIngestUser] = useState("");
  const [ingestSession, setIngestSession] = useState("");
  const [ingestValidDate, setIngestValidDate] = useState("");
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

  const [settingsBusy, setSettingsBusy] = useState(false);
  const decayCfg = ((inst.config?.decay ?? {}) as Record<string, unknown>) ?? {};
  const initialDailyFactor =
    typeof decayCfg.daily_factor === "number" && Number.isFinite(decayCfg.daily_factor) ? decayCfg.daily_factor : 0.05;
  const [decayDailyFactor, setDecayDailyFactor] = useState(Math.max(0.01, Math.min(0.3, initialDailyFactor)));
  const [decayThreshold, setDecayThreshold] = useState(
    typeof decayCfg.retrieval_threshold === "number" && Number.isFinite(decayCfg.retrieval_threshold)
      ? decayCfg.retrieval_threshold
      : 0.12,
  );

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
          user_id: episodesUserFilter.trim() || undefined,
          limit: 180,
        }),
      );
    } catch {
      setEpisodes([]);
    } finally {
      setEpisodesLoading(false);
    }
  }, [token, instanceId, episodesUserFilter]);

  useEffect(() => {
    void loadStats();
    void loadEpisodes();
  }, [loadStats, loadEpisodes]);

  async function onIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setIngestBusy(true);
    setIngestMsg(null);
    try {
      const r = await ingestInstance(token, instanceId, {
        text: ingestText,
        user_id: ingestUser.trim() || undefined,
        session_id: ingestSession.trim() || undefined,
        valid_from: ingestValidDate ? `${ingestValidDate}T00:00:00Z` : undefined,
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

  async function onQuery(e: React.FormEvent) {
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

  const tabs: [EpisodicTab, string][] = [
    ["playground", "Playground"],
    ["episodes", "Episodes"],
    ["timeline", "Timeline"],
    ["decay", "Decay"],
    ["settings", "Settings"],
  ];

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
          <span className="text-border">›</span>
          <span className="font-medium text-ink">{inst.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            <span className={clsx("h-2 w-2 rounded-full", inst.status === "active" ? "bg-[#639922]" : "bg-[#ba7517]")} />
            {inst.status}
          </span>
          <button
            type="button"
            onClick={() => setTab("settings")}
            className="rounded-lg border border-border2 bg-bg px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-bg2"
          >
            Settings
          </button>
        </div>
      </div>

      <div className="grid w-full min-w-0 grid-cols-2 border-b border-border bg-bg sm:grid-cols-3 lg:grid-cols-5">
        <KpiCell label="Episodes" value={stats?.episodes_count ?? "—"} sub="bi-temporal ready" />
        <KpiCell label="Avg decay" value={stats ? stats.avg_decay.toFixed(2) : "—"} sub={`rate ${decayDailyFactor.toFixed(2)}/day`} />
        <KpiCell label="Users today" value={stats?.users_count ?? "—"} sub="user scoped" />
        <KpiCell label="Oldest entry" value={stats?.oldest_entry ?? "—"} sub={`${episodes.length} loaded`} />
        <KpiCell label="Coverage" value={stats ? `${stats.coverage}%` : "—"} sub="anchored episodes" className="lg:border-r-0" />
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
                tab === id ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink",
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
            <section className="min-w-0 rounded-[12px] border border-border bg-bg p-4 sm:p-5">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Record episode</h2>
              <form onSubmit={onIngest} className="mt-3 space-y-3">
                <textarea
                  value={ingestText}
                  onChange={(e) => setIngestText(e.target.value)}
                  rows={6}
                  className="w-full resize-y rounded-lg border border-border2 bg-bg3 px-3 py-2 text-[13px] outline-none focus:border-[#888]"
                  placeholder="User mentioned sleep issues this week..."
                  required
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input value={ingestUser} onChange={(e) => setIngestUser(e.target.value)} className="rounded-md border border-border bg-bg3 px-3 py-2 text-[12px]" placeholder="user_id" />
                  <input value={ingestSession} onChange={(e) => setIngestSession(e.target.value)} className="rounded-md border border-border bg-bg3 px-3 py-2 text-[12px]" placeholder="session_id" />
                  <input type="date" value={ingestValidDate} onChange={(e) => setIngestValidDate(e.target.value)} className="rounded-md border border-border bg-bg3 px-3 py-2 text-[12px]" />
                </div>
                <button type="submit" disabled={ingestBusy} className="w-full rounded-lg bg-ink px-4 py-2.5 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50">
                  {ingestBusy ? "Recording…" : "Record"}
                </button>
                {ingestMsg ? <p className={clsx("text-[12px]", ingestMsg.includes("Recorded") ? "text-success-text" : "text-error")}>{ingestMsg}</p> : null}
              </form>
            </section>

            <section className="min-w-0 rounded-[12px] border border-border bg-bg p-4 sm:p-5">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Semantic search with decay</h2>
              <form onSubmit={onQuery} className="mt-3 space-y-3">
                <input value={queryText} onChange={(e) => setQueryText(e.target.value)} className="w-full rounded-md border border-border bg-bg3 px-3 py-2 text-[13px]" placeholder="What did user mention about sleep?" required />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input value={queryUser} onChange={(e) => setQueryUser(e.target.value)} className="rounded-md border border-border bg-bg3 px-3 py-2 text-[12px]" placeholder="user_id (optional)" />
                  <input value={querySession} onChange={(e) => setQuerySession(e.target.value)} className="rounded-md border border-border bg-bg3 px-3 py-2 text-[12px]" placeholder="session_id (optional)" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <input type="date" value={queryAsOf} onChange={(e) => setQueryAsOf(e.target.value)} className="rounded-md border border-border bg-bg px-3 py-2 text-[12px]" />
                  <select value={queryTopK} onChange={(e) => setQueryTopK(Number(e.target.value))} className="rounded-md border border-border bg-bg px-2 py-2 text-[12px]">
                    {[3, 5, 8, 12].map((k) => (
                      <option key={k} value={k}>
                        top_k = {k}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" disabled={queryBusy} className="w-full rounded-lg bg-[#3b6d11] px-4 py-2.5 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50">
                  {queryBusy ? "Searching…" : "Run decay query"}
                </button>
                {queryMsg ? <p className="text-[12px] text-error">{queryMsg}</p> : null}
                {queryBody ? (
                  <div className="space-y-2 border-t border-border pt-3">
                    <p className="text-[12px] text-ink">{queryBody.message}</p>
                    <p className="text-[11px] text-subtle">Tokens: {formatTokens(queryBody.tokens_used)}</p>
                    {queryBody.citations.map((c, idx) => (
                      <div key={c.chunk_id || idx} className="rounded-md border border-border2 bg-bg3 px-3 py-2">
                        <div className="mb-1 flex items-center justify-between text-[10px]">
                          <span className="rounded px-1.5 py-0.5 font-medium uppercase" style={{ background: "#eaf3de", color: "#3b6d11" }}>
                            {c.chunk_id.slice(0, 10)}
                          </span>
                          <span className="text-subtle">weight {(typeof c.score === "number" ? c.score : 0).toFixed(2)}</span>
                        </div>
                        <p className="text-[12px] text-ink">{c.snippet}</p>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg2">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(4, Math.min(100, Math.round((c.score ?? 0) * 100)))}%`, backgroundColor: weightColor(c.score ?? 0) }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </form>
            </section>
          </div>
        ) : null}

        {tab === "episodes" ? (
          <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-7">
            <div className="mb-3 flex flex-wrap gap-2">
              <input
                value={episodesUserFilter}
                onChange={(e) => setEpisodesUserFilter(e.target.value)}
                className="min-w-[220px] flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-[13px]"
                placeholder="Filter by user_id"
              />
              <button type="button" onClick={() => void loadEpisodes()} className="rounded-lg border border-border px-3 py-2 text-[12px] hover:bg-bg2">
                Search
              </button>
            </div>
            {episodesLoading ? (
              <p className="text-[13px] text-muted">Loading…</p>
            ) : episodes.length === 0 ? (
              <div className="rounded-[12px] border border-border bg-bg px-6 py-10 text-center text-[13px] text-muted">
                No episodes yet.
              </div>
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
                    {episodes.map((ep) => (
                      <tr key={ep.id} className="border-b border-border last:border-0 hover:bg-bg2/50">
                        <td className="font-mono text-[11px] text-[#3b6d11] px-4 py-3">{ep.id.slice(0, 10)}…</td>
                        <td className="max-w-[340px] truncate px-4 py-3 text-[12px] text-ink" title={ep.content}>
                          {ep.content}
                        </td>
                        <td className="px-4 py-3 text-[11px] font-mono text-muted">{ep.user_scope ?? "—"}</td>
                        <td className="px-4 py-3 text-[11px] text-subtle">{formatRelativeTime(ep.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-bg2">
                              <div className="h-full rounded-full" style={{ width: `${Math.round((ep.decay_weight ?? 0) * 100)}%`, backgroundColor: weightColor(ep.decay_weight ?? 0) }} />
                            </div>
                            <span className="text-[11px]">{(ep.decay_weight ?? 0).toFixed(2)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        {tab === "timeline" ? (
          <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-7">
            <div className="rounded-[12px] border border-border bg-bg p-4">
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
            </div>
          </div>
        ) : null}

        {tab === "decay" ? (
          <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-7">
            <div className="rounded-[12px] border border-border bg-bg p-4">
              <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Decay configuration</div>
              <div className="mb-1 flex items-center justify-between text-[12px] text-muted">
                <span>Daily decay factor</span>
                <span className="font-medium text-[#3b6d11]">{decayDailyFactor.toFixed(2)} / day</span>
              </div>
              <input type="range" min={1} max={30} value={Math.round(decayDailyFactor * 100)} onChange={(e) => setDecayDailyFactor(Number(e.target.value) / 100)} className="w-full accent-[#3b6d11]" />
              <div className="mt-3 mb-1 flex items-center justify-between text-[12px] text-muted">
                <span>Retrieval threshold</span>
                <span className="font-medium text-[#3b6d11]">≥ {decayThreshold.toFixed(2)}</span>
              </div>
              <input type="range" min={1} max={40} value={Math.round(decayThreshold * 100)} onChange={(e) => setDecayThreshold(Number(e.target.value) / 100)} className="w-full accent-[#3b6d11]" />
              <div className="mt-4">
                <button onClick={() => void onSaveDecay()} disabled={settingsBusy} className="rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-bg hover:opacity-90 disabled:opacity-50">
                  {settingsBusy ? "Saving…" : "Save decay config"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "settings" ? (
          <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-7">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <section className="rounded-[12px] border border-border bg-bg p-4">
                <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Basic</div>
                <div className="space-y-2 text-[12px]">
                  <div className="flex justify-between border-b border-border py-1.5"><span className="text-subtle">Name</span><span className="font-medium">{inst.name}</span></div>
                  <div className="flex justify-between border-b border-border py-1.5"><span className="text-subtle">Type</span><span className="font-medium">Episodic</span></div>
                  <div className="flex justify-between border-b border-border py-1.5"><span className="text-subtle">Created</span><span className="font-medium">{new Date(inst.created_at).toLocaleDateString()}</span></div>
                  <div className="flex justify-between py-1.5"><span className="text-subtle">Instance ID</span><span className="font-mono text-[11px]">{inst.id}</span></div>
                </div>
              </section>
              <section className="rounded-[12px] border border-border bg-bg p-4">
                <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Danger zone</div>
                <p className="text-[12px] text-muted">Pausing stops writes. Deleting is permanent.</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => void onPauseToggle()} disabled={settingsBusy} className="rounded-lg border border-border2 bg-bg px-3 py-1.5 text-[12px] hover:bg-bg2 disabled:opacity-50">
                    {inst.status === "active" ? "Pause instance" : "Resume instance"}
                  </button>
                  <button onClick={() => void onDeleteInstance()} className="rounded-lg border border-[#f09595] bg-[#fcebeb] px-3 py-1.5 text-[12px] text-[#a32d2d] hover:opacity-90">
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
