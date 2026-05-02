"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import {
  billingMeRequest,
  deleteRagSource,
  getRagStats,
  getRagTopics,
  ingestInstance,
  ingestInstanceFile,
  listSources,
  patchInstance,
  queryInstance,
  type MemoryInstanceDTO,
  type QueryResultDTO,
  type RAGStatsDTO,
  type RAGTopicClusterDTO,
  type RAGSourceDTO,
} from "@/lib/api";
import { getToken } from "@/lib/token";
import { formatFileSize, formatTokens } from "@/lib/format";
import { WikiHighlightedSnippet } from "@/components/instances/WikiHighlightedSnippet";

type RagTab = "playground" | "documents" | "topics" | "settings";

const ragAccent = "#185fa5";
const ragAccentBg = "#e6f1fb";

const MEMORY_PILLS = [
  { id: "rag", label: "RAG", href: "#", col: "#185fa5", bg: "#e6f1fb", soon: false },
  { id: "wiki", label: "Wiki", href: "/instances/new?type=wiki", col: "#534ab7", bg: "#eeedfe", soon: false },
  { id: "episodic", label: "Episodic", href: "#", col: "#3b6d11", bg: "#eaf3de", soon: true },
  { id: "working", label: "Working", href: "#", col: "#854f0b", bg: "#faeeda", soon: true },
  { id: "graph", label: "Graph", href: "#", col: "#993c1d", bg: "#faece7", soon: true },
  { id: "reflective", label: "Reflective", href: "#", col: "#993556", bg: "#fbeaf0", soon: true },
  { id: "agent", label: "Agent (unified)", href: "#", col: "#1a1a1a", bg: "#f3f2ef", soon: true },
] as const;

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const d = Date.now() - t;
  const sec = Math.floor(d / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function roughChunkPreview(text: string, max = 480): { n: number; body: string }[] {
  const t = text.trim();
  if (!t) return [];
  const out: { n: number; body: string }[] = [];
  let i = 0;
  let n = 0;
  while (i < t.length && n < 3) {
    const end = Math.min(i + max, t.length);
    out.push({ n: n + 1, body: t.slice(i, end) });
    n++;
    i = end;
  }
  return out;
}

function estTokens(s: string): number {
  return Math.max(1, Math.ceil([...s].length / 4));
}

export function RagInstancePanels({
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
  const [tab, setTab] = useState<RagTab>("playground");
  const [stats, setStats] = useState<RAGStatsDTO | null>(null);
  const [tokensMonth, setTokensMonth] = useState<number | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);

  const [ingestText, setIngestText] = useState("");
  const [userScope, setUserScope] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileMsg, setFileMsg] = useState<string | null>(null);

  const [queryText, setQueryText] = useState("");
  const [topK, setTopK] = useState(5);
  const [synthesizeAnswer, setSynthesizeAnswer] = useState(true);
  const [queryBusy, setQueryBusy] = useState(false);
  const [queryBody, setQueryBody] = useState<QueryResultDTO | null>(null);
  const [queryMsg, setQueryMsg] = useState<string | null>(null);
  const [queryAvg, setQueryAvg] = useState<number | null>(null);

  const [sources, setSources] = useState<RAGSourceDTO[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [topics, setTopics] = useState<RAGTopicClusterDTO[]>([]);

  const loadStats = useCallback(async () => {
    if (!token) return;
    try {
      setStats(await getRagStats(token, instanceId));
    } catch {
      setStats(null);
    }
  }, [token, instanceId]);

  const loadBilling = useCallback(async () => {
    if (!token) return;
    try {
      const b = await billingMeRequest(token);
      let used = 0;
      for (const bucket of b.buckets) {
        used += bucket.tokens_used ?? 0;
      }
      setTokensMonth(used);
    } catch {
      setTokensMonth(null);
    }
  }, [token]);

  const loadDocuments = useCallback(async () => {
    if (!token) return;
    setSourcesLoading(true);
    try {
      setSources(await listSources(token, instanceId));
    } catch {
      setSources([]);
    } finally {
      setSourcesLoading(false);
    }
  }, [token, instanceId]);

  const onDeleteSource = useCallback(
    async (sourceId: string, filename: string) => {
      if (!token) return;
      if (
        !window.confirm(
          `Delete "${filename}" and all its text chunks and embedding vectors? This cannot be undone.`,
        )
      ) {
        return;
      }
      setDeletingSourceId(sourceId);
      setFileMsg(null);
      try {
        await deleteRagSource(token, instanceId, sourceId);
        await loadDocuments();
        void loadStats();
        void loadTopics();
      } catch (e) {
        setFileMsg(e instanceof Error ? e.message : "Delete failed");
      } finally {
        setDeletingSourceId(null);
      }
    },
    [token, instanceId, loadDocuments, loadStats, loadTopics],
  );

  const loadTopics = useCallback(async () => {
    if (!token) return;
    try {
      setTopics(await getRagTopics(token, instanceId));
    } catch {
      setTopics([]);
    }
  }, [token, instanceId]);

  useEffect(() => {
    void loadStats();
    void loadBilling();
  }, [loadStats, loadBilling, instanceId]);

  useEffect(() => {
    if (tab === "documents") void loadDocuments();
    if (tab === "topics") void loadTopics();
  }, [tab, loadDocuments, loadTopics]);

  useEffect(() => {
    if (tab === "playground" && (ingestMsg || fileMsg)) {
      void loadStats();
      if (ingestMsg?.includes("chunk") || fileMsg?.includes("chunk")) void loadDocuments();
    }
  }, [ingestMsg, fileMsg, tab, loadStats, loadDocuments]);

  const chunkPreview = useMemo(() => roughChunkPreview(ingestText, 500), [ingestText]);

  async function onIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setIngestBusy(true);
    setIngestMsg(null);
    try {
      const r = await ingestInstance(token, instanceId, {
        text: ingestText,
        source_label: sourceLabel.trim() || undefined,
        user_id: userScope.trim() || undefined,
      });
      setIngestMsg(`Ingested ${r.chunks_added} chunk(s), ${formatTokens(r.tokens_consumed)} tokens.`);
      setIngestText("");
      void loadStats();
    } catch (e) {
      setIngestMsg(e instanceof Error ? e.message : "Ingest failed");
    } finally {
      setIngestBusy(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !token) return;
    setFileBusy(true);
    setFileMsg(null);
    try {
      const scope = userScope.trim() || undefined;
      const r = await ingestInstanceFile(token, instanceId, file, scope);
      setFileMsg(
        `${file.name}: ${r.chunks_added} chunk(s), ${formatTokens(r.tokens_consumed)} tokens · ${r.embedding_model}`,
      );
      void loadStats();
      void loadDocuments();
    } catch (ex) {
      setFileMsg(ex instanceof Error ? ex.message : "Upload failed");
    } finally {
      setFileBusy(false);
    }
  }

  async function onQuery(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setQueryBusy(true);
    setQueryMsg(null);
    setQueryBody(null);
    setQueryAvg(null);
    try {
      const r = await queryInstance(token, instanceId, {
        query: queryText,
        top_k: topK,
        user_id: userScope.trim() || undefined,
        synthesize: synthesizeAnswer,
      });
      setQueryBody({
        message: r.message,
        tokens_used: r.tokens_used,
        citations: r.citations,
        wiki_related_concepts: r.wiki_related_concepts,
        synthesized: r.synthesized,
      });
      if (r.citations.length > 0) {
        const sum = r.citations.reduce((a, c) => a + (typeof c.score === "number" ? c.score : 0), 0);
        setQueryAvg(sum / r.citations.length);
      }
    } catch (e) {
      setQueryMsg(e instanceof Error ? e.message : "Query failed");
    } finally {
      setQueryBusy(false);
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

  const tabs: [RagTab, string][] = [
    ["playground", "Playground"],
    ["documents", "Documents"],
    ["topics", "Topics"],
    ["settings", "Settings"],
  ];

  const lastDocSub =
    stats?.last_ingest_at && stats.source_count > 0
      ? `last: ${formatRelativeTime(stats.last_ingest_at)}`
      : stats?.source_count === 0
        ? "upload a file or ingest text"
        : "—";

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col bg-bg3">
      <div className="border-b border-border bg-bg px-4 py-3 sm:px-6 lg:px-7">
        <div className="flex flex-wrap gap-2">
          {MEMORY_PILLS.map((p) => {
            const active = p.id === "rag";
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
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-border2 hover:bg-bg2 hover:text-ink"
              >
                <span className="h-1.5 w-1.5 rounded-full opacity-40" style={{ backgroundColor: p.col }} aria-hidden />
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            <span
              className={clsx("h-2 w-2 rounded-full", inst.status === "active" ? "bg-[#639922]" : "bg-[#ba7517]")}
              aria-hidden
            />
            {inst.status === "active" ? "Active" : inst.status}
          </span>
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
          label="Chunks"
          value={stats?.chunk_count ?? "—"}
          sub={
            stats
              ? `${stats.topic_cluster_count} topic${stats.topic_cluster_count === 1 ? "" : "s"} clustered`
              : undefined
          }
        />
        <KpiCell label="Documents" value={stats?.source_count ?? "—"} sub={lastDocSub} />
        <KpiCell label="Queries today" value={stats?.queries_today != null && stats.queries_today > 0 ? stats.queries_today : "—"} sub="Analytics coming soon" />
        <KpiCell
          label="Avg score"
          value={
            queryAvg != null
              ? queryAvg.toFixed(2)
              : stats?.avg_topk_score != null
                ? stats.avg_topk_score.toFixed(2)
                : "—"
          }
          sub="top-5 results"
        />
        <KpiCell
          label="Coverage"
          value={
            stats?.coverage_percent != null ? `${Math.round(stats.coverage_percent)}%` : "—"
          }
          sub={
            stats?.high_conf_percent != null
              ? `high_conf: ${Math.round(stats.high_conf_percent)}%`
              : "estimate after clustering"
          }
          className="lg:border-r-0"
        />
      </div>

      <div className="relative z-20 border-b border-border bg-bg px-4 sm:px-6 lg:px-7">
        <nav className="flex flex-wrap gap-1 pt-1" aria-label="RAG sections">
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "playground" ? (
          <div className="grid w-full min-w-0 grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-2 lg:gap-8 sm:px-6 lg:px-7">
            <div className="flex min-w-0 flex-col gap-6">
              <section className="rounded-[12px] border border-border bg-bg p-4 sm:p-5">
                <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Ingest document</h2>
                <p className="mt-1 text-[12px] text-muted">
                  Paste text or markdown. For vector embeddings and larger files, upload from the Documents tab.
                </p>
                <form onSubmit={onIngest} className="mt-4 space-y-3">
                  <textarea
                    value={ingestText}
                    onChange={(e) => setIngestText(e.target.value)}
                    rows={8}
                    className="mt-1 w-full resize-y rounded-lg border border-border2 bg-bg3 px-3 py-2 text-[13px] outline-none focus:border-[#888]"
                    placeholder="Paste text, markdown or drop a file…"
                  />
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={userScope}
                      onChange={(e) => setUserScope(e.target.value)}
                      className="min-w-[120px] flex-1 rounded-md border border-border bg-bg3 px-3 py-2 text-[12px]"
                      placeholder="user_id (optional)"
                    />
                    <input
                      value={sourceLabel}
                      onChange={(e) => setSourceLabel(e.target.value)}
                      className="min-w-[120px] flex-1 rounded-md border border-border bg-bg3 px-3 py-2 text-[12px]"
                      placeholder="source label (optional)"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={ingestBusy}
                    className="w-full rounded-lg bg-ink px-4 py-2.5 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
                  >
                    {ingestBusy ? "Ingesting…" : "Ingest"}
                  </button>
                  {ingestMsg ? (
                    <p
                      className={clsx(
                        "text-[12px]",
                        ingestMsg.startsWith("Ingested") ? "text-[#3b6d11]" : "text-error",
                      )}
                    >
                      {ingestMsg}
                    </p>
                  ) : null}
                </form>
              </section>

              <section className="rounded-[12px] border border-border bg-bg p-4 sm:p-5">
                <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Chunk preview</h2>
                <p className="mt-1 text-[12px] text-muted">Approximate split for display (actual chunking happens on the server).</p>
                {chunkPreview.length === 0 ? (
                  <p className="mt-4 text-[12px] text-muted">Type or paste content to preview chunks.</p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {chunkPreview.map((c, i) => (
                      <li
                        key={c.n}
                        className="rounded-lg border border-border px-3 py-2 text-[12px]"
                        style={{
                          backgroundColor: i % 2 === 0 ? ragAccentBg : "#eaf3de",
                        }}
                      >
                        <div className="font-mono text-[10px] text-subtle">
                          Chunk {c.n} — ~{estTokens(c.body)} tok
                        </div>
                        <p className="mt-1 line-clamp-4 text-ink">{c.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <section className="rounded-[12px] border border-border bg-bg p-4 sm:p-5">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Query</h2>
              <form onSubmit={onQuery} className="mt-4 space-y-3">
                <textarea
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  rows={4}
                  className="w-full resize-y rounded-lg border border-border2 bg-bg3 px-3 py-2 text-[13px] outline-none focus:border-[#888]"
                  placeholder="Ask about your indexed content…"
                  required
                />
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink">
                  <input
                    type="checkbox"
                    className="rounded border-border2"
                    checked={synthesizeAnswer}
                    onChange={(e) => setSynthesizeAnswer(e.target.checked)}
                  />
                  Synthesize answer (LLM)
                </label>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={topK}
                    onChange={(e) => setTopK(Number(e.target.value))}
                    className="rounded-md border border-border bg-bg px-2 py-2 text-[12px]"
                  >
                    {[3, 5, 8, 12].map((k) => (
                      <option key={k} value={k}>
                        top_k = {k}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={queryBusy}
                    className="flex-1 rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-bg hover:opacity-90 disabled:opacity-50 sm:flex-none"
                  >
                    {queryBusy ? "Searching…" : "Search"}
                  </button>
                </div>
                {queryMsg ? <p className="text-[12px] text-error">{queryMsg}</p> : null}
                {queryBody ? (
                  <div className="space-y-3 border-t border-border pt-4">
                    {queryBody.synthesized ? (
                      <span
                        className="inline-block rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                        style={{ backgroundColor: ragAccentBg, color: ragAccent }}
                      >
                        Synthesized answer
                      </span>
                    ) : null}
                    <p className="text-[12px] leading-relaxed text-ink">{queryBody.message}</p>
                    <p className="text-[11px] text-subtle">Tokens: {formatTokens(queryBody.tokens_used)}</p>
                    {queryBody.citations.length > 0 ? (
                      <div>
                        <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-subtle">Results</div>
                        <ul className="space-y-2">
                          {queryBody.citations.map((c, i) => (
                            <li
                              key={c.chunk_id || `c-${i}`}
                              className="flex items-start justify-between gap-2 rounded-md border border-border2 bg-bg3 px-3 py-2 text-[11px]"
                            >
                              <div className="min-w-0">
                                <span
                                  className="mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase text-bg"
                                  style={{ backgroundColor: ragAccent }}
                                >
                                  RAG
                                </span>
                                <span className="font-mono text-[10px] text-subtle">{(c.chunk_id ?? "").slice(0, 10)}…</span>
                                <p className="mt-1 text-[12px] leading-relaxed text-ink">
                                  <WikiHighlightedSnippet text={c.snippet ?? ""} />
                                </p>
                              </div>
                              <span className="shrink-0 text-[11px] text-muted">
                                {(typeof c.score === "number" ? c.score : 0).toFixed(2)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </form>
            </section>
          </div>
        ) : null}

        {tab === "documents" ? (
          <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-7">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-[15px] font-medium text-ink">Documents</h2>
                <p className="mt-1 text-[12px] text-muted">Files with embeddings · vectors used for similarity search.</p>
              </div>
              <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-border2 bg-bg px-4 py-2 text-[12px] font-medium text-ink hover:bg-bg2 disabled:opacity-50">
                <input
                  type="file"
                  className="sr-only"
                  accept=".txt,.md,.markdown,.html,.htm,.csv,.json,.docx"
                  onChange={onPickFile}
                  disabled={fileBusy}
                />
                {fileBusy ? "Uploading…" : "Upload file"}
              </label>
            </div>
            {fileMsg ? (
              <p className={clsx("mb-4 text-[12px]", fileMsg.includes("chunk") ? "text-[#3b6d11]" : "text-error")}>{fileMsg}</p>
            ) : null}
            {sourcesLoading ? (
              <p className="text-[13px] text-muted">Loading…</p>
            ) : sources.length === 0 ? (
              <div className="rounded-[12px] border border-border bg-bg px-6 py-12 text-center text-[13px] text-muted">
                No documents yet. Upload a file to create embeddings and chunks.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-[12px] border border-border bg-bg">
                <table className="w-full min-w-[720px] text-left text-[13px]">
                  <thead className="border-b border-border bg-bg2 text-[10px] font-medium uppercase tracking-wide text-subtle">
                    <tr>
                      <th className="px-4 py-2.5">Name</th>
                      <th className="px-4 py-2.5">Size</th>
                      <th className="px-4 py-2.5">Chunks</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Indexed</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((s) => (
                      <tr key={s.id} className="border-b border-border last:border-0 hover:bg-bg2/50">
                        <td className="max-w-[240px] truncate px-4 py-3 font-medium text-ink" title={s.filename}>
                          {s.filename}
                        </td>
                        <td className="px-4 py-3 text-muted">{formatFileSize(s.byte_size)}</td>
                        <td className="px-4 py-3">{s.chunk_count}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full bg-[#eaf3de] px-2 py-0.5 text-[11px] font-medium text-[#3b6d11]">
                            Active
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-subtle">
                          {formatRelativeTime(s.created_at)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Link
                              href={`/instances/${instanceId}/files/${s.id}`}
                              className="rounded-md border border-border2 bg-bg px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-bg2"
                            >
                              Vectors
                            </Link>
                            <button
                              type="button"
                              disabled={deletingSourceId === s.id}
                              onClick={() => void onDeleteSource(s.id, s.filename)}
                              className="rounded-md border border-[#f09595] bg-[#fcebeb] px-2.5 py-1 text-[11px] font-medium text-[#a32d2d] hover:opacity-90 disabled:opacity-50"
                            >
                              {deletingSourceId === s.id ? "…" : "Delete"}
                            </button>
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

        {tab === "topics" ? (
          <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-7">
            <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Hierarchical clusters</h2>
            <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-muted">
              Each cluster groups chunks from one uploaded source (document). Full semantic clustering across all chunks is planned;
              today’s view matches your ingested files so you can see how content is split before deeper topic discovery ships.
            </p>
            {topics.length === 0 ? (
              <p className="mt-8 text-[13px] text-muted">
                No document clusters yet. Upload files on the Documents tab — each file becomes a cluster with tags derived from its
                name.
              </p>
            ) : (
              <ul className="mt-6 space-y-4">
                {topics.map((t) => (
                  <li
                    key={t.id}
                    className="rounded-[12px] border border-border bg-bg px-4 py-4 sm:px-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-[14px] font-medium text-ink">{t.title}</h3>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {t.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-block rounded-full border border-border bg-bg2 px-2 py-0.5 text-[11px] text-ink"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-[12px] text-muted">
                        {t.chunk_count} chunks · score {t.score.toFixed(2)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {tab === "settings" ? (
          <div className="grid w-full min-w-0 grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-2 lg:px-7">
            <section className="min-w-0 rounded-[12px] border border-border bg-bg p-4 sm:p-5">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Basic</h2>
              <dl className="mt-4 space-y-3 text-[13px]">
                <div className="flex justify-between gap-4 border-b border-border pb-3">
                  <dt className="text-muted">Name</dt>
                  <dd className="font-medium text-ink">{inst.name}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-border pb-3">
                  <dt className="text-muted">Type</dt>
                  <dd className="font-medium text-ink">RAG</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-border pb-3">
                  <dt className="text-muted">Created</dt>
                  <dd className="text-ink">{new Date(inst.created_at).toLocaleDateString()}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-border pb-3">
                  <dt className="text-muted">Instance ID</dt>
                  <dd className="font-mono text-[11px] text-ink">{inst.id}</dd>
                </div>
              </dl>
              <p className="mt-4 text-[11px] text-subtle">
                Tokens (month, all instances): {tokensMonth != null ? formatTokens(tokensMonth) : "—"}
              </p>
            </section>

            <section className="min-w-0 rounded-[12px] border border-border bg-bg p-4 sm:p-5">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Danger zone</h2>
              <p className="mt-2 text-[12px] text-muted">Pausing stops ingest/query. Deleting is permanent.</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={settingsBusy}
                  onClick={() => void onPauseToggle()}
                  className="rounded-lg border border-border2 px-4 py-2 text-[12px] font-medium text-ink hover:bg-bg2 disabled:opacity-50"
                >
                  {inst.status === "active" ? "Pause instance" : "Resume instance"}
                </button>
                <button
                  type="button"
                  onClick={() => void onDeleteInstance()}
                  className="rounded-lg border border-[#f09595] bg-[#fcebeb] px-4 py-2 text-[12px] font-medium text-[#a32d2d] hover:opacity-90"
                >
                  Delete instance
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function KpiCell({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: string | number;
  sub?: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "min-w-0 border-b border-border px-3 py-3 sm:px-4 sm:py-4 lg:border-b-0 lg:border-r lg:py-4 lg:last:border-r-0",
        className,
      )}
    >
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">{label}</div>
      <div className="mt-1 text-2xl font-medium tracking-tight text-ink">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}
