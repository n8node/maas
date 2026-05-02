"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import {
  approveWikiProposal,
  billingMeRequest,
  getWikiActionLog,
  getWikiConcepts,
  getWikiHealth,
  getWikiProposals,
  getWikiRepairConcepts,
  ingestInstance,
  ingestInstanceFile,
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
} from "@/lib/api";
import { getToken } from "@/lib/token";
import { formatTokens } from "@/lib/format";
import { WikiHighlightedSnippet } from "@/components/instances/WikiHighlightedSnippet";

type WikiTab = "playground" | "concepts" | "actionlog" | "gardener" | "settings";

const wikiAccent = "#534ab7";
const wikiAccentBg = "#eeedfe";

const MEMORY_PILLS = [
  { id: "rag", label: "RAG", href: "/instances/new?type=rag", col: "#185fa5", bg: "#e6f1fb", soon: false },
  { id: "wiki", label: "Wiki", href: "#", col: "#534ab7", bg: "#eeedfe", soon: false },
  { id: "episodic", label: "Episodic", href: "#", col: "#3b6d11", bg: "#eaf3de", soon: true },
  { id: "working", label: "Working", href: "#", col: "#854f0b", bg: "#faeeda", soon: true },
  { id: "graph", label: "Graph", href: "#", col: "#993c1d", bg: "#faece7", soon: true },
  { id: "reflective", label: "Reflective", href: "#", col: "#993556", bg: "#fbeaf0", soon: true },
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
  return new Date(iso).toLocaleDateString();
}

function actionVisual(action: string): { dot: string; chipBg: string; chipText: string } {
  const a = (action ?? "").toLowerCase();
  if (a.includes("create")) return { dot: "#639922", chipBg: "#eaf3de", chipText: "#3b6d11" };
  if (a.includes("attach")) return { dot: "#185fa5", chipBg: "#e6f1fb", chipText: "#185fa5" };
  if (a.includes("refine")) return { dot: "#534ab7", chipBg: "#eeedfe", chipText: "#534ab7" };
  if (a.includes("reject")) return { dot: "#888780", chipBg: "#f3f2ef", chipText: "#5f5e5a" };
  return { dot: "#888780", chipBg: "#f3f2ef", chipText: "#5f5e5a" };
}

function typeDotClass(t: string): string {
  const x = t.toLowerCase();
  if (x === "fact" || x === "entity") return "bg-[#185fa5]";
  if (x === "project" || x === "goal") return "bg-[#534ab7]";
  if (x === "event") return "bg-[#ba7517]";
  return "bg-[#5f5e5a]";
}

function typeBadgeClass(t: string): string {
  const x = t.toLowerCase();
  if (x === "fact") return "bg-[#e6f1fb] text-[#185fa5]";
  if (x === "project") return "bg-[#eeedfe] text-[#534ab7]";
  if (x === "event") return "bg-[#faeeda] text-[#633806]";
  if (x === "entity") return "bg-[#faece7] text-[#993c1d]";
  return "bg-bg2 text-muted";
}

function stateBadgeClass(s: string): string {
  const x = s.toLowerCase();
  if (x === "active") return "bg-[#eaf3de] text-[#3b6d11]";
  if (x === "stale" || x === "weak") return "bg-[#faeeda] text-[#633806]";
  if (x === "disputed") return "bg-[#fcebeb] text-[#a32d2d]";
  return "bg-bg2 text-muted";
}

function proposalTagStyle(t: string): { bg: string; text: string } {
  const x = t.toLowerCase();
  if (x.includes("merge")) return { bg: "#fbeaf0", text: "#993556" };
  if (x.includes("split")) return { bg: "#e6f1fb", text: "#185fa5" };
  if (x.includes("set_concept") || x === "set_concept_state") return { bg: "#faeeda", text: "#633806" };
  if (x.includes("noise")) return { bg: "#f3f2ef", text: "#5f5e5a" };
  return { bg: "#eeedfe", text: "#534ab7" };
}

function payloadTitle(payload: Record<string, unknown>): string | undefined {
  const title = payload.title;
  if (typeof title === "string" && title) return title;
  const nrm = payload.normalized_title;
  if (typeof nrm === "string" && nrm) return nrm;
  const cid = payload.concept_id;
  if (typeof cid === "string" && cid) {
    const ns = payload.new_state;
    return typeof ns === "string" ? `Concept ${cid.slice(0, 8)}… → ${ns}` : `Concept ${cid.slice(0, 8)}…`;
  }
  const t0 = payload.titles;
  if (Array.isArray(t0) && t0.length && typeof t0[0] === "string") return String(t0[0]);
  return undefined;
}

/** Filenames queued in create-instance wizard (stored in instance config). */
function readWizardQueuedFiles(cfg: Record<string, unknown>): string[] {
  const q = cfg.wizard_queued_files;
  if (!Array.isArray(q)) return [];
  return q.filter((x): x is string => typeof x === "string" && x.length > 0);
}

export function WikiInstancePanels({
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
  const [tab, setTab] = useState<WikiTab>("playground");
  const [health, setHealth] = useState<WikiHealthDTO | null>(null);
  const [tokensMonth, setTokensMonth] = useState<number | null>(null);
  const [pendingProposalCount, setPendingProposalCount] = useState(0);

  const [ingestText, setIngestText] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [userScopeIngest, setUserScopeIngest] = useState("");
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);
  const [fileIngestBusy, setFileIngestBusy] = useState(false);
  const [fileIngestMsg, setFileIngestMsg] = useState<string | null>(null);

  const [queryText, setQueryText] = useState("");
  const [queryUserScope, setQueryUserScope] = useState("");
  const [topK, setTopK] = useState(5);
  const [queryBusy, setQueryBusy] = useState(false);
  const [queryBody, setQueryBody] = useState<QueryResultDTO | null>(null);
  const [queryMsg, setQueryMsg] = useState<string | null>(null);

  const [concepts, setConcepts] = useState<WikiConceptDTO[]>([]);
  const [conceptSearch, setConceptSearch] = useState("");
  const [conceptFilter, setConceptFilter] = useState<"all" | "active" | "stale">("all");
  const [previewConcepts, setPreviewConcepts] = useState<WikiConceptDTO[]>([]);
  const [actions, setActions] = useState<WikiActionLogEntryDTO[]>([]);
  const [proposals, setProposals] = useState<WikiProposalDTO[]>([]);
  const [repairConcepts, setRepairConcepts] = useState<WikiConceptDTO[]>([]);
  const [triageBusy, setTriageBusy] = useState(false);
  const [gardenerPlanOk, setGardenerPlanOk] = useState<boolean | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);

  const autoExtract =
    typeof inst.config?.auto_extract === "boolean"
      ? (inst.config.auto_extract as boolean)
      : true;

  const loadHealth = useCallback(async () => {
    if (!token) return;
    try {
      const h = await getWikiHealth(token, instanceId);
      setHealth(h);
    } catch {
      setHealth(null);
    }
  }, [token, instanceId]);

  const loadPendingProposals = useCallback(async () => {
    if (!token) return;
    try {
      const p = await getWikiProposals(token, instanceId, "pending");
      setPendingProposalCount(p.length);
    } catch {
      setPendingProposalCount(0);
    }
  }, [token, instanceId]);

  const loadBilling = useCallback(async () => {
    if (!token) return;
    try {
      const b = await billingMeRequest(token);
      setGardenerPlanOk(b.plan?.gardener_enabled === true);
      let used = 0;
      for (const bucket of b.buckets) {
        used += bucket.tokens_used ?? 0;
      }
      setTokensMonth(used);
    } catch {
      setTokensMonth(null);
      setGardenerPlanOk(null);
    }
  }, [token]);

  const loadTabData = useCallback(async () => {
    if (!token) return;
    try {
      if (tab === "concepts") {
        const list = await getWikiConcepts(token, instanceId, conceptSearch || undefined);
        setConcepts(list);
      } else if (tab === "actionlog") {
        setActions(await getWikiActionLog(token, instanceId));
      } else if (tab === "gardener") {
        const [p, rc] = await Promise.all([
          getWikiProposals(token, instanceId, "pending"),
          getWikiRepairConcepts(token, instanceId),
        ]);
        setProposals(p);
        setRepairConcepts(rc);
        setPendingProposalCount(p.length);
      } else if (tab === "playground") {
        const list = await getWikiConcepts(token, instanceId);
        setPreviewConcepts(list.slice(0, 8));
      }
    } catch {
      /* ignore */
    }
  }, [token, instanceId, tab, conceptSearch]);

  useEffect(() => {
    void loadHealth();
    void loadBilling();
    void loadPendingProposals();
  }, [loadHealth, loadBilling, loadPendingProposals, instanceId]);

  useEffect(() => {
    void loadTabData();
  }, [loadTabData]);

  useEffect(() => {
    if (tab === "playground" && (ingestMsg || fileIngestMsg)) {
      void loadTabData();
    }
  }, [ingestMsg, fileIngestMsg, tab, loadTabData]);

  async function onToggleAutoExtract() {
    if (!token) return;
    setSettingsBusy(true);
    try {
      await patchInstance(token, instanceId, {
        config: { ...inst.config, auto_extract: !autoExtract },
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
      setIngestMsg(
        [
          `Ingested ${r.chunks_added} segment(s), ${formatTokens(r.tokens_consumed)} tokens.`,
          typeof r.wiki_concepts_added === "number" && r.wiki_concepts_added > 0
            ? ` Added ${r.wiki_concepts_added} concept hypothesis(es).`
            : "",
          r.wiki_extraction_note ? ` ${r.wiki_extraction_note}` : "",
        ].join(""),
      );
      setIngestText("");
      void loadHealth();
      void loadTabData();
      void loadPendingProposals();
    } catch (e) {
      setIngestMsg(e instanceof Error ? e.message : "Ingest failed");
    } finally {
      setIngestBusy(false);
    }
  }

  async function onPickWikiFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !token) return;
    setFileIngestBusy(true);
    setFileIngestMsg(null);
    try {
      const scope = userScopeIngest.trim() || undefined;
      const r = await ingestInstanceFile(token, instanceId, file, scope);
      const extraConcepts =
        typeof r.wiki_concepts_added === "number" && r.wiki_concepts_added > 0
          ? ` Added ${r.wiki_concepts_added} concept hypothesis(es).`
          : "";
      const note = r.wiki_extraction_note ? ` ${r.wiki_extraction_note}` : "";
      setFileIngestMsg(
        `Ingested ${file.name}: ${r.chunks_added} segment(s), ${formatTokens(r.tokens_consumed)} tokens.${extraConcepts}${note} Open the Concepts tab to review.`,
      );
      void loadHealth();
      void loadTabData();
      void loadPendingProposals();
    } catch (err) {
      setFileIngestMsg(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setFileIngestBusy(false);
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
      const [p, rc] = await Promise.all([
        getWikiProposals(token, instanceId, "pending"),
        getWikiRepairConcepts(token, instanceId),
      ]);
      setProposals(p);
      setRepairConcepts(rc);
      setPendingProposalCount(p.length);
      void loadHealth();
      setActions(await getWikiActionLog(token, instanceId));
    } finally {
      setTriageBusy(false);
    }
  }

  const wizardQueuedFiles = useMemo(() => readWizardQueuedFiles(inst.config ?? {}), [inst.config]);

  const filteredConcepts = useMemo(() => {
    return (concepts ?? []).filter((c) => {
      if (conceptFilter === "all") return true;
      const s = (c.state ?? "").toLowerCase();
      if (conceptFilter === "active") return s === "active";
      return s === "stale" || s === "weak" || s === "disputed";
    });
  }, [concepts, conceptFilter]);

  const staleN = health?.stale_concept_count ?? 0;
  const disputedN = health?.disputed_concept_count ?? 0;

  const tabs: [WikiTab, string][] = [
    ["playground", "Playground"],
    ["concepts", "Concepts"],
    ["actionlog", "Action log"],
    ["gardener", "Gardener"],
    ["settings", "Settings"],
  ];

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col bg-bg3">
      {/* Memory kind pills */}
      <div className="border-b border-border bg-bg px-4 py-3 sm:px-6 lg:px-7">
        <div className="flex flex-wrap gap-2">
          {MEMORY_PILLS.map((p) => {
            const isWiki = p.id === "wiki";
            const active = isWiki;
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

      {/* Breadcrumb + actions */}
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

      {/* KPI row */}
      <div className="grid w-full min-w-0 grid-cols-2 border-b border-border bg-bg sm:grid-cols-3 lg:grid-cols-5">
        <KpiCell
          label="Concepts"
          value={health?.concept_count ?? "—"}
          sub={
            health
              ? `${staleN} stale · ${disputedN} disputed`
              : undefined
          }
        />
        <KpiCell
          label="Sources"
          value={health?.source_count ?? "—"}
          sub={health ? `${health.segment_count} segments` : undefined}
        />
        <KpiCell label="Queries today" value="—" sub="Analytics coming soon" />
        <KpiCell
          label="Purity"
          value={health ? health.purity.toFixed(2) : "—"}
          sub={health ? `coverage ${Math.round(health.coverage * 100)}%` : undefined}
        />
        <KpiCell
          label="Stale ratio"
          value={health ? `${Math.round(health.stale_ratio * 100)}%` : "—"}
          sub={
            pendingProposalCount > 0
              ? `${pendingProposalCount} proposals pending`
              : "gardener pending"
          }
          className="lg:border-r-0"
        />
      </div>

      <div className="relative z-20 border-b border-border bg-bg px-4 sm:px-6 lg:px-7">
        <nav className="flex flex-wrap gap-1 pt-1" aria-label="Wiki sections">
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
              <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">
                Ingest — concept extraction (SGR)
              </h2>
              <p className="mt-1 text-[12px] text-muted">
                Text or uploaded documents become wiki segments; auto-extract proposes concepts when enabled (toggle in Settings).
              </p>
              <form onSubmit={onIngest} className="mt-4 space-y-3">
                <textarea
                  value={ingestText}
                  onChange={(e) => setIngestText(e.target.value)}
                  rows={12}
                  className="mt-1 w-full resize-y rounded-lg border border-border2 bg-bg3 px-3 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[#888]"
                  placeholder="Text or markdown — cheap model extracts concept hypotheses…"
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
                  disabled={ingestBusy || fileIngestBusy}
                  className="w-full rounded-lg bg-ink px-4 py-2.5 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
                >
                  {ingestBusy ? "Ingesting…" : "Ingest async"}
                </button>
                {ingestMsg ? (
                  <p className={`text-[12px] ${ingestMsg.includes("segment") ? "text-success-text" : "text-error"}`}>{ingestMsg}</p>
                ) : null}
              </form>

              <div className="mt-4 rounded-lg border border-border2 bg-bg3 px-3 py-3">
                <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Upload document</div>
                <p className="mt-1 text-[11px] text-muted">
                  .txt, .md, .html, .csv, .json, .docx — same pipeline as paste (segments + auto-extract). Legacy{" "}
                  <span className="font-mono">.doc</span> is not supported; save as .docx or paste text.
                </p>
                <label className="mt-3 inline-flex cursor-pointer">
                  <input
                    type="file"
                    className="sr-only"
                    accept=".txt,.md,.markdown,.html,.htm,.csv,.json,.docx"
                    onChange={onPickWikiFile}
                    disabled={fileIngestBusy || ingestBusy}
                  />
                  <span className="rounded-lg border border-border bg-bg px-3 py-2 text-[12px] font-medium text-ink hover:bg-bg2">
                    {fileIngestBusy ? "Uploading…" : "Choose file"}
                  </span>
                </label>
                {fileIngestMsg ? (
                  <p
                    className={`mt-2 text-[12px] ${
                      fileIngestMsg.includes("segment") || fileIngestMsg.includes("Ingested") ? "text-success-text" : "text-error"
                    }`}
                  >
                    {fileIngestMsg}
                  </p>
                ) : null}
              </div>

              <div className="mt-6 border-t border-border pt-4">
                <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Extraction preview</div>
                {wizardQueuedFiles.length > 0 ? (
                  <div className="mt-3 rounded-lg border border-border bg-bg2 px-3 py-2.5">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-subtle">Files from create wizard</div>
                    <p className="mt-1 text-[11px] text-muted">
                      Names from the wizard are reminders only — use Upload document or paste text above to ingest.
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {wizardQueuedFiles.map((name) => (
                        <li
                          key={name}
                          className="flex items-center gap-2 text-[12px] text-ink"
                        >
                          <span className="text-subtle" aria-hidden>
                            ▸
                          </span>
                          <span className="min-w-0 truncate font-mono text-[12px]">{name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <ul className="mt-3 space-y-2">
                  {previewConcepts.length === 0 && wizardQueuedFiles.length === 0 ? (
                    <li className="text-[12px] text-muted">No concepts yet — ingest text or enable auto-extract.</li>
                  ) : null}
                  {previewConcepts.length === 0 && wizardQueuedFiles.length > 0 ? (
                    <li className="text-[12px] text-muted">No extracted concepts yet — run ingest above.</li>
                  ) : null}
                  {previewConcepts.map((c) => {
                    const conf = Number(c.confidence ?? 0);
                    return (
                      <li
                        key={c.id}
                        className="flex items-start gap-3 rounded-lg border border-border bg-bg3 px-3 py-2 text-[12px]"
                      >
                        <span
                          className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                          style={{
                            background: c.state === "active" ? "#eaf3de" : "#f3f2ef",
                            color: c.state === "active" ? "#3b6d11" : "#5f5e5a",
                          }}
                        >
                          {c.state === "active" ? "create" : (c.state ?? "—")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-ink">{c.title ?? "Untitled"}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                            <span className={clsx("rounded px-1.5 py-0.5", typeBadgeClass(c.concept_type ?? "fact"))}>
                              {c.concept_type ?? "—"}
                            </span>
                            <span>{conf.toFixed(2)}</span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>

            <section className="min-w-0 rounded-[12px] border border-border bg-bg p-4 sm:p-5">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Query with citations</h2>
              <p className="mt-1 text-[12px] text-muted">Full-text over segments; citations reference segment IDs.</p>
              <form onSubmit={onQuery} className="mt-4 space-y-3">
                <textarea
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  rows={4}
                  className="mt-1 w-full resize-y rounded-lg border border-border2 bg-bg3 px-3 py-2 text-[13px] outline-none focus:border-[#888]"
                  placeholder="What are the Q3 priorities?"
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
                {queryMsg ? <p className="text-[12px] text-error">{queryMsg}</p> : null}
                {queryBody ? (
                  <div className="space-y-3 border-t border-border pt-4">
                    <p className="text-[12px] leading-relaxed text-ink [&_a]:font-medium [&_a]:text-[#534ab7] [&_a]:underline">
                      {queryBody.message}
                    </p>
                    <p className="text-[11px] text-subtle">Tokens: {formatTokens(queryBody.tokens_used)}</p>
                    {queryBody.citations.length > 0 ? (
                      <div>
                        <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-subtle">Sources</div>
                        <ul className="space-y-2">
                          {queryBody.citations.map((c, i) => (
                            <li
                              key={c.chunk_id || `citation-${i}`}
                              className="flex items-start justify-between gap-2 rounded-md border border-border2 bg-bg3 px-3 py-2 text-[11px]"
                            >
                              <div className="min-w-0">
                                <span
                                  className="mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                                  style={{ background: wikiAccentBg, color: wikiAccent }}
                                >
                                  Wiki
                                </span>
                                <span className="font-mono text-[10px] text-subtle">
                                  {(c.chunk_id ?? "").slice(0, 10)}…
                                </span>
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

        {tab === "concepts" ? (
          <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-7">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <input
                value={conceptSearch}
                onChange={(e) => setConceptSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void loadTabData()}
                className="min-w-[200px] flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-[13px] outline-none focus:border-border2"
                placeholder="Search concepts…"
              />
              <div className="flex rounded-lg border border-border p-0.5">
                {(
                  [
                    ["all", "All"],
                    ["active", "Active"],
                    ["stale", "Stale"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setConceptFilter(id)}
                    className={clsx(
                      "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                      conceptFilter === id ? "bg-bg2 text-ink" : "text-muted hover:text-ink",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void loadTabData()}
                className="rounded-lg border border-border px-3 py-2 text-[12px] hover:bg-bg2"
              >
                Search
              </button>
            </div>
            <div className="overflow-x-auto rounded-[12px] border border-border bg-bg [-webkit-overflow-scrolling:touch]">
              <table className="w-full min-w-[min(100%,560px)] text-left text-[13px] sm:min-w-[640px]">
                <thead className="border-b border-border bg-bg2 text-[10px] font-medium uppercase tracking-wide text-subtle">
                  <tr>
                    <th className="px-4 py-2.5">Concept</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">State</th>
                    <th className="px-4 py-2.5">Confidence</th>
                    <th className="px-4 py-2.5">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredConcepts.map((c) => {
                    const conf = Number(c.confidence ?? 0);
                    return (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={clsx("h-2 w-2 shrink-0 rounded-full", typeDotClass(c.concept_type ?? ""))} aria-hidden />
                          <span className="font-medium text-ink">{c.title ?? "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx("inline-block rounded-full px-2 py-0.5 text-[11px] font-medium", typeBadgeClass(c.concept_type ?? ""))}>
                          {c.concept_type ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx("inline-block rounded-full px-2 py-0.5 text-[11px] font-medium", stateBadgeClass(c.state ?? ""))}>
                          {c.state ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-bg2">
                            <div
                              className={clsx(
                                "h-full rounded-full",
                                conf >= 0.7 ? "bg-[#534ab7]" : conf >= 0.4 ? "bg-[#185fa5]" : "bg-[#a32d2d]",
                              )}
                              style={{ width: `${Math.round(Math.min(1, Math.max(0, conf)) * 100)}%` }}
                            />
                          </div>
                          <span className="text-[12px] text-muted">{conf.toFixed(2)}</span>
                        </div>
                      </td>
                      <td className="max-w-[min(320px,44vw)] px-4 py-3 align-top">
                        <div className="flex flex-col gap-1">
                          {c.source_title?.trim() ? (
                            <span
                              className="text-[12px] font-medium leading-snug text-ink line-clamp-1"
                              title={c.source_title}
                            >
                              {c.source_title}
                            </span>
                          ) : (
                            <span className="text-[12px] text-muted">—</span>
                          )}
                          {c.description?.trim() ? (
                            <p className="line-clamp-3 text-[11px] leading-snug text-muted" title={c.description}>
                              {c.description}
                            </p>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
              {filteredConcepts.length === 0 ? (
                <p className="p-6 text-[13px] text-muted">No concepts match this filter.</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "actionlog" ? (
          <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-7">
            <div className="rounded-[12px] border border-border bg-bg">
            {actions.map((a, idx) => {
              const pl = (a.payload ?? {}) as Record<string, unknown>;
              const vis = actionVisual(a.action ?? "");
              const titleLine =
                (typeof pl.concept_title === "string" && pl.concept_title) ||
                payloadTitle(pl) ||
                a.target_kind ||
                "Entry";
              return (
                <div
                  key={a.id}
                  className={clsx(
                    "flex items-start gap-3 px-4 py-4 sm:gap-4 sm:px-5",
                    idx !== actions.length - 1 ? "border-b border-border" : "",
                  )}
                >
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: vis.dot }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="rounded px-2 py-0.5 text-[11px] font-medium capitalize"
                        style={{ backgroundColor: vis.chipBg, color: vis.chipText }}
                      >
                        {a.action ?? "—"}
                      </span>
                      <span className="text-[13px] font-medium text-ink">{titleLine}</span>
                    </div>
                    {a.rationale ? <p className="mt-1 text-[12px] text-muted">{a.rationale}</p> : null}
                    {!a.rationale && (
                      <p className="mt-1 text-[12px] text-muted">
                        {a.actor === "system" ? "Router decision" : `Actor: ${a.actor}`}
                      </p>
                    )}
                    <p className="mt-2 text-[11px] text-subtle">
                      worker:{a.actor === "system" ? "route" : (a.actor ?? "system")} ·{" "}
                      {a.created_at ? formatRelativeTime(a.created_at) : "—"}
                    </p>
                  </div>
                </div>
              );
            })}
            {actions.length === 0 ? (
              <p className="p-6 text-[13px] text-muted sm:p-8">No actions logged yet.</p>
            ) : null}
            </div>
          </div>
        ) : null}

        {tab === "gardener" ? (
          <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-7">
            {gardenerPlanOk === false ? (
              <div
                className="mb-4 rounded-lg border border-[#b5d4f4] px-4 py-3"
                style={{ background: "#e6f1fb" }}
              >
                <p className="text-[13px] font-medium text-[#185fa5]">Gardener is not on your current plan</p>
                <p className="mt-1 text-[12px] text-[#185fa5]/90">
                  Phase 0 triage and LLM proposals require a plan with Gardener enabled. You can still review the repair
                  list below.
                </p>
                <Link
                  href="/billing"
                  className="mt-2 inline-block text-[12px] font-medium text-[#185fa5] underline hover:opacity-90"
                >
                  View plans &amp; billing
                </Link>
              </div>
            ) : null}
            <div
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e8c9a0] px-4 py-3"
              style={{ background: "#faeeda" }}
            >
              <div>
                <p className="text-[13px] font-medium text-[#633806]">
                  {pendingProposalCount} proposal{pendingProposalCount === 1 ? "" : "s"} pending
                </p>
                <p className="text-[12px] text-[#633806]/90">Phase 0 triage (heuristic + optional LLM) — not applied until approved.</p>
              </div>
              <button
                type="button"
                title={gardenerPlanOk === false ? "Upgrade your plan to run triage" : undefined}
                disabled={triageBusy || gardenerPlanOk === false}
                onClick={() => void onTriage()}
                className="shrink-0 rounded-lg px-4 py-2 text-[12px] font-medium text-[#633806] hover:opacity-90 disabled:opacity-50"
                style={{ background: "#e8c9a0", border: "1px solid #ba7517" }}
              >
                {triageBusy ? "Running…" : "Run triage"}
              </button>
            </div>

            {repairConcepts.length > 0 ? (
              <div className="mb-6 rounded-[12px] border border-border bg-bg px-4 py-4 sm:px-5">
                <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Repair queue</h2>
                <p className="mt-1 text-[12px] text-muted">
                  Concepts in stale, disputed, or weak state ({repairConcepts.length}).
                </p>
                <ul className="mt-3 space-y-2">
                  {repairConcepts.slice(0, 12).map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2 text-[13px] last:border-0 last:pb-0"
                    >
                      <span className="min-w-0 font-medium text-ink">{c.title}</span>
                      <span
                        className={clsx(
                          "shrink-0 rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                          stateBadgeClass(c.state ?? ""),
                        )}
                      >
                        {c.state ?? "—"}
                      </span>
                    </li>
                  ))}
                </ul>
                {repairConcepts.length > 12 ? (
                  <p className="mt-2 text-[11px] text-subtle">Showing 12 of {repairConcepts.length}.</p>
                ) : null}
              </div>
            ) : (
              <p className="mb-6 text-[12px] text-muted">No concepts flagged for repair (stale / disputed / weak).</p>
            )}

            <ul className="space-y-4">
              {proposals.map((p) => {
                const tag = proposalTagStyle(p.proposal_type);
                const pay = p.payload as Record<string, unknown>;
                const titleText =
                  payloadTitle(pay) ||
                  (typeof pay?.concept_ids === "object" ? "Proposal" : p.proposal_type);
                return (
                  <li
                    key={p.id}
                    className="relative min-w-0 rounded-[12px] border border-border bg-bg px-4 py-4 sm:px-5"
                  >
                    <span className="absolute right-3 top-3 text-[11px] text-subtle sm:right-4 sm:top-4">Phase 0</span>
                    <span
                      className="inline-block rounded px-2 py-0.5 text-[11px] font-medium capitalize"
                      style={{ backgroundColor: tag.bg, color: tag.text }}
                    >
                      {p.proposal_type.replace(/_/g, " ")}
                    </span>
                    <h3 className="mt-2 text-[14px] font-medium text-ink">{titleText}</h3>
                    <p className="mt-1 text-[12px] text-muted">
                      {typeof pay?.reason === "string"
                        ? pay.reason
                        : "Review — approve to apply or reject to dismiss."}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await approveWikiProposal(token, instanceId, p.id);
                          const [next, rc] = await Promise.all([
                            getWikiProposals(token, instanceId, "pending"),
                            getWikiRepairConcepts(token, instanceId),
                          ]);
                          setProposals(next);
                          setRepairConcepts(rc);
                          setPendingProposalCount(next.length);
                          void loadHealth();
                        }}
                        className="rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-bg hover:opacity-90"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await rejectWikiProposal(token, instanceId, p.id);
                          const next = await getWikiProposals(token, instanceId, "pending");
                          setProposals(next);
                          setPendingProposalCount(next.length);
                        }}
                        className="rounded-lg border border-border2 bg-bg px-4 py-2 text-[12px] font-medium text-ink hover:bg-bg2"
                      >
                        Reject
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {proposals.length === 0 ? <p className="text-[13px] text-muted">No pending proposals.</p> : null}
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
                  <dd className="font-medium text-ink">Wiki</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-border pb-3">
                  <dt className="text-muted">Created</dt>
                  <dd className="text-ink">{new Date(inst.created_at).toLocaleDateString()}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-border pb-3">
                  <dt className="text-muted">Instance ID</dt>
                  <dd className="font-mono text-[11px] text-ink">{inst.id}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 pt-1">
                  <dt className="text-muted">Auto-extract on ingest</dt>
                  <dd>
                    <button
                      type="button"
                      disabled={settingsBusy}
                      onClick={() => void onToggleAutoExtract()}
                      className={clsx(
                        "relative h-[22px] w-10 rounded-full transition-colors",
                        autoExtract ? "bg-ink" : "bg-border2",
                      )}
                      aria-pressed={autoExtract}
                    >
                      <span
                        className={clsx(
                          "absolute top-[3px] h-4 w-4 rounded-full bg-bg shadow transition-[left]",
                          autoExtract ? "left-[22px]" : "left-[3px]",
                        )}
                      />
                    </button>
                  </dd>
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
