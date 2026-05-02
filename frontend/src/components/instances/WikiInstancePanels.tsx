"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";

import {
  approveWikiProposal,
  billingMeRequest,
  getWikiActionLog,
  getWikiConcepts,
  getWikiHealth,
  getWikiProposals,
  getWikiSources,
  ingestInstance,
  patchInstance,
  postWikiGardenerTriage,
  queryInstance,
  rejectWikiProposal,
  type MemoryInstanceDTO,
  type QueryResultDTO,
  type WikiActionLogEntryDTO,
  type WikiConceptDTO,
  type WikiHealthDTO,
  type WikiProposalDTO,
  type WikiSourceDTO,
} from "@/lib/api";
import { getToken } from "@/lib/token";
import { formatTokens } from "@/lib/format";

type WikiTab = "playground" | "concepts" | "sources" | "actionlog" | "gardener";

const wikiAccent = "#534ab7";
const wikiAccentBg = "#eeedfe";

export function WikiInstancePanels({
  instanceId,
  inst,
  onRefreshInstance,
}: {
  instanceId: string;
  inst: MemoryInstanceDTO;
  onRefreshInstance: () => void;
}) {
  const token = getToken() ?? "";
  const [tab, setTab] = useState<WikiTab>("playground");
  const [health, setHealth] = useState<WikiHealthDTO | null>(null);
  const [tokensMonth, setTokensMonth] = useState<number | null>(null);

  const [ingestText, setIngestText] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [userScopeIngest, setUserScopeIngest] = useState("");
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);

  const [queryText, setQueryText] = useState("");
  const [queryUserScope, setQueryUserScope] = useState("");
  const [topK, setTopK] = useState(5);
  const [queryBusy, setQueryBusy] = useState(false);
  const [queryBody, setQueryBody] = useState<QueryResultDTO | null>(null);
  const [queryMsg, setQueryMsg] = useState<string | null>(null);

  const [concepts, setConcepts] = useState<WikiConceptDTO[]>([]);
  const [conceptSearch, setConceptSearch] = useState("");
  const [sources, setSources] = useState<WikiSourceDTO[]>([]);
  const [actions, setActions] = useState<WikiActionLogEntryDTO[]>([]);
  const [proposals, setProposals] = useState<WikiProposalDTO[]>([]);
  const [triageBusy, setTriageBusy] = useState(false);

  const autoExtract =
    typeof inst.config?.auto_extract === "boolean" ? (inst.config.auto_extract as boolean) : false;

  const loadHealth = useCallback(async () => {
    if (!token) return;
    try {
      const h = await getWikiHealth(token, instanceId);
      setHealth(h);
    } catch {
      setHealth(null);
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

  const loadTabData = useCallback(async () => {
    if (!token) return;
    try {
      if (tab === "concepts") {
        const list = await getWikiConcepts(token, instanceId, conceptSearch || undefined);
        setConcepts(list);
      } else if (tab === "sources") {
        setSources(await getWikiSources(token, instanceId));
      } else if (tab === "actionlog") {
        setActions(await getWikiActionLog(token, instanceId));
      } else if (tab === "gardener") {
        setProposals(await getWikiProposals(token, instanceId, "pending"));
      }
    } catch {
      /* ignore */
    }
  }, [token, instanceId, tab, conceptSearch]);

  useEffect(() => {
    void loadHealth();
    void loadBilling();
  }, [loadHealth, loadBilling, instanceId]);

  useEffect(() => {
    void loadTabData();
  }, [loadTabData]);

  async function onToggleAutoExtract() {
    if (!token) return;
    try {
      await patchInstance(token, instanceId, {
        config: { ...inst.config, auto_extract: !autoExtract },
      });
      onRefreshInstance();
    } catch {
      /* ignore */
    }
  }

  async function onIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setIngestBusy(true);
    setIngestMsg(null);
    try {
      const r = await ingestInstance(token, instanceId, {
        text: ingestText,
        source_title: sourceTitle.trim() || undefined,
        user_id: userScopeIngest.trim() || undefined,
      });
      setIngestMsg(`Ingested ${r.chunks_added} segment(s), ${formatTokens(r.tokens_consumed)} tokens.`);
      setIngestText("");
      void loadHealth();
      void loadTabData();
    } catch (e) {
      setIngestMsg(e instanceof Error ? e.message : "Ingest failed");
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
        top_k: topK,
        user_id: queryUserScope.trim() || undefined,
      });
      setQueryBody({ message: r.message, tokens_used: r.tokens_used, citations: r.citations });
    } catch (e) {
      setQueryMsg(e instanceof Error ? e.message : "Query failed");
    } finally {
      setQueryBusy(false);
    }
  }

  async function onTriage() {
    if (!token) return;
    setTriageBusy(true);
    try {
      await postWikiGardenerTriage(token, instanceId);
      setProposals(await getWikiProposals(token, instanceId, "pending"));
      void loadHealth();
      setActions(await getWikiActionLog(token, instanceId));
    } finally {
      setTriageBusy(false);
    }
  }

  const tabs: [WikiTab, string][] = [
    ["playground", "Playground"],
    ["concepts", "Concepts"],
    ["sources", "Sources"],
    ["actionlog", "Action log"],
    ["gardener", "Gardener"],
  ];

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-border px-7 py-4" style={{ background: `linear-gradient(90deg, ${wikiAccentBg} 0%, #ffffff 45%)` }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color: wikiAccent }}>
            Wiki memory
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={autoExtract} onChange={() => void onToggleAutoExtract()} />
            Auto-extract concepts (LLM on ingest)
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Concepts"
            value={health?.concept_count ?? "—"}
            sub={health ? `${Math.round(health.stale_ratio * 100)}% inactive / weak / stale` : undefined}
          />
          <StatCard label="Sources" value={health?.source_count ?? "—"} sub={health ? `${health.segment_count} segments` : undefined} />
          <StatCard label="Coverage" value={health ? `${Math.round(health.coverage * 100)}%` : "—"} sub="segments with concepts" />
          <StatCard label="Tokens (month)" value={tokensMonth != null ? formatTokens(tokensMonth) : "—"} sub="from buckets" />
        </div>
      </div>

      <div className="border-b border-border bg-bg px-7">
        <nav className="flex flex-wrap gap-1 pt-1">
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

      <div className="flex-1 overflow-y-auto">
        {tab === "playground" ? (
          <div className="grid gap-6 p-7 lg:grid-cols-2 lg:gap-8">
            <section className="rounded-[12px] border border-border bg-bg p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Ingest</h2>
                <div className="flex rounded-lg border border-border p-0.5 text-[11px]">
                  <span className="rounded-md bg-bg2 px-2 py-1 font-medium text-ink">Text</span>
                  <span className="px-2 py-1 text-subtle" title="Use a RAG instance for file vectors">
                    File
                  </span>
                  <span className="px-2 py-1 text-subtle">URL</span>
                </div>
              </div>
              <p className="mt-1 text-[12px] text-muted">
                FTS segments; optional LLM extraction when auto-extract is on and OpenRouter is configured.
              </p>
              <form onSubmit={onIngest} className="mt-4 space-y-3">
                <textarea
                  value={ingestText}
                  onChange={(e) => setIngestText(e.target.value)}
                  rows={12}
                  className="mt-1 w-full resize-y rounded-lg border border-border2 bg-bg3 px-3 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[#888]"
                  placeholder="Paste text or markdown…"
                  required
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="text-[11px] text-subtle">user_id (optional)</label>
                    <input
                      value={userScopeIngest}
                      onChange={(e) => setUserScopeIngest(e.target.value)}
                      className="mt-1 w-full rounded-md border border-border bg-bg3 px-3 py-2 text-[13px] outline-none focus:ring-1 focus:ring-accent"
                      placeholder="Scope by end-user"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-subtle">Source title</label>
                    <input
                      value={sourceTitle}
                      onChange={(e) => setSourceTitle(e.target.value)}
                      className="mt-1 w-full rounded-md border border-border bg-bg3 px-3 py-2 text-[13px] outline-none focus:ring-1 focus:ring-accent"
                      placeholder="e.g. API overview"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={ingestBusy}
                  className="w-full rounded-lg bg-ink px-4 py-2.5 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
                >
                  {ingestBusy ? "Ingesting…" : "↑ Ingest"}
                </button>
                {ingestMsg ? (
                  <p className={`text-[12px] ${ingestMsg.includes("segment") ? "text-success-text" : "text-error"}`}>{ingestMsg}</p>
                ) : null}
              </form>
            </section>

            <section className="rounded-[12px] border border-border bg-bg p-5">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Query</h2>
              <p className="mt-1 text-[12px] text-muted">Full-text over segments; citations = segment IDs.</p>
              <form onSubmit={onQuery} className="mt-4 space-y-3">
                <textarea
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  rows={4}
                  className="mt-1 w-full resize-y rounded-lg border border-border2 bg-bg3 px-3 py-2 text-[13px] outline-none focus:border-[#888]"
                  placeholder="Ask anything about the knowledge base…"
                  required
                />
                <div className="flex flex-wrap gap-2">
                  <input
                    value={queryUserScope}
                    onChange={(e) => setQueryUserScope(e.target.value)}
                    className="min-w-[140px] flex-1 rounded-md border border-border bg-bg3 px-3 py-2 text-[12px]"
                    placeholder="user_id (optional)"
                  />
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
                </div>
                <button
                  type="submit"
                  disabled={queryBusy}
                  className="w-full rounded-lg px-4 py-2.5 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: wikiAccent }}
                >
                  {queryBusy ? "Searching…" : "Run query"}
                </button>
                <p className="text-[11px] text-subtle">Ingest first; answers are citation-only (no synthesis).</p>
                {queryMsg ? <p className="text-[12px] text-error">{queryMsg}</p> : null}
                {queryBody ? (
                  <div className="space-y-3 border-t border-border pt-4">
                    <p className="text-[12px] leading-relaxed text-ink">{queryBody.message}</p>
                    <p className="text-[11px] text-subtle">Tokens: {formatTokens(queryBody.tokens_used)}</p>
                    {queryBody.citations.length > 0 ? (
                      <ul className="space-y-2">
                        {queryBody.citations.map((c) => (
                          <li key={c.chunk_id} className="rounded-md border border-border2 bg-bg3 px-3 py-2 text-[11px] text-muted">
                            <span className="font-mono text-[10px] text-subtle">{c.chunk_id.slice(0, 8)}…</span>
                            <span className="mx-2 text-border">·</span>
                            {c.score.toFixed(3)}
                            <p className="mt-1 text-[12px] text-ink">{c.snippet}</p>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </form>
            </section>
          </div>
        ) : null}

        {tab === "concepts" ? (
          <div className="p-7">
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="flex-1">
                <label className="text-[11px] text-subtle">Search</label>
                <input
                  value={conceptSearch}
                  onChange={(e) => setConceptSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void loadTabData()}
                  className="mt-1 w-full max-w-md rounded-lg border border-border bg-bg px-3 py-2 text-[13px]"
                  placeholder="Title or description"
                />
              </div>
              <button
                type="button"
                onClick={() => void loadTabData()}
                className="rounded-lg border border-border px-3 py-2 text-[12px] hover:bg-bg2"
              >
                Search
              </button>
            </div>
            <div className="overflow-x-auto rounded-[12px] border border-border bg-bg">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="border-b border-border bg-bg2 text-[10px] font-medium uppercase tracking-wide text-subtle">
                  <tr>
                    <th className="px-4 py-2">Title</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">State</th>
                    <th className="px-4 py-2">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {concepts.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-medium text-ink">{c.title}</td>
                      <td className="px-4 py-2 text-muted">{c.concept_type}</td>
                      <td className="px-4 py-2 text-muted">{c.state}</td>
                      <td className="px-4 py-2 text-muted">{c.confidence.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {concepts.length === 0 ? (
                <p className="p-6 text-[13px] text-muted">No concepts yet — enable auto-extract and ingest, or use API.</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "sources" ? (
          <div className="p-7">
            <div className="overflow-x-auto rounded-[12px] border border-border bg-bg">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-border bg-bg2 text-[10px] font-medium uppercase tracking-wide text-subtle">
                  <tr>
                    <th className="px-4 py-2">Title</th>
                    <th className="px-4 py-2">Segments</th>
                    <th className="px-4 py-2">user_scope</th>
                    <th className="px-4 py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-medium">{s.title}</td>
                      <td className="px-4 py-2 text-muted">{s.segment_count}</td>
                      <td className="px-4 py-2 font-mono text-[11px] text-muted">{s.user_scope ?? "—"}</td>
                      <td className="px-4 py-2 text-[12px] text-muted">{new Date(s.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sources.length === 0 ? <p className="p-6 text-[13px] text-muted">No sources yet.</p> : null}
            </div>
          </div>
        ) : null}

        {tab === "actionlog" ? (
          <div className="space-y-3 p-7">
            {actions.map((a) => (
              <div key={a.id} className="rounded-[12px] border border-border bg-bg px-4 py-3 text-[13px]">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium text-ink">{a.action}</span>
                  <span className="text-[11px] text-subtle">{new Date(a.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-[12px] text-muted">
                  actor <span className="font-mono text-[11px]">{a.actor}</span>
                  {a.target_kind ? <> · {a.target_kind}</> : null}
                </p>
                {a.rationale ? <p className="mt-1 text-[11px] text-subtle">{a.rationale}</p> : null}
              </div>
            ))}
            {actions.length === 0 ? <p className="text-[13px] text-muted">No actions logged yet.</p> : null}
          </div>
        ) : null}

        {tab === "gardener" ? (
          <div className="p-7">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={triageBusy}
                onClick={() => void onTriage()}
                className="rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
              >
                {triageBusy ? "Running…" : "Run triage (duplicate titles)"}
              </button>
              <p className="text-[12px] text-muted">Creates merge proposals when active concepts share a title.</p>
            </div>
            <ul className="space-y-3">
              {proposals.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-col gap-2 rounded-[12px] border border-border bg-bg px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{p.proposal_type}</div>
                    <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-[11px] text-muted">
                      {JSON.stringify(p.payload, null, 2)}
                    </pre>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await approveWikiProposal(token, instanceId, p.id);
                        setProposals(await getWikiProposals(token, instanceId, "pending"));
                        void loadHealth();
                      }}
                      className="rounded-lg border border-border px-3 py-1.5 text-[12px] hover:bg-bg2"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await rejectWikiProposal(token, instanceId, p.id);
                        setProposals(await getWikiProposals(token, instanceId, "pending"));
                      }}
                      className="rounded-lg border border-error-border px-3 py-1.5 text-[12px] text-error hover:bg-error-bg"
                    >
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {proposals.length === 0 ? <p className="text-[13px] text-muted">No pending proposals.</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-bg px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">{label}</div>
      <div className="mt-1 text-xl font-medium tracking-tight text-ink">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}
