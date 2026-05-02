"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";

import { ingestInstance, patchInstance, queryInstance, type MemoryInstanceDTO, type QueryResultDTO } from "@/lib/api";
import { getToken } from "@/lib/token";

type GraphTab = "playground" | "settings";

const gCol = "#993c1d";
const gBg = "#faece7";

const MEMORY_PILLS = [
  { id: "rag", label: "RAG", href: "/instances/new?type=rag", col: "#185fa5", bg: "#e6f1fb", soon: false },
  { id: "wiki", label: "Wiki", href: "/instances/new?type=wiki", col: "#534ab7", bg: "#eeedfe", soon: false },
  { id: "episodic", label: "Episodic", href: "/instances/new?type=episodic", col: "#3b6d11", bg: "#eaf3de", soon: false },
  { id: "working", label: "Working", href: "/instances/new?type=working", col: "#854f0b", bg: "#faeeda", soon: false },
  { id: "graph", label: "Graph", href: "#", col: gCol, bg: gBg, soon: false },
  { id: "reflective", label: "Reflective", href: "#", col: "#993556", bg: "#fbeaf0", soon: true },
  { id: "agent", label: "Agent (unified)", href: "#", col: "#1a1a1a", bg: "#f3f2ef", soon: true },
] as const;

export function GraphInstancePanels({
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
  const [tab, setTab] = useState<GraphTab>("playground");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [instName, setInstName] = useState(inst.name);

  useEffect(() => {
    setInstName(inst.name);
  }, [inst.name]);

  const [ingestText, setIngestText] = useState("");
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);

  const [queryText, setQueryText] = useState("");
  const [queryBusy, setQueryBusy] = useState(false);
  const [queryBody, setQueryBody] = useState<QueryResultDTO | null>(null);
  const [queryMsg, setQueryMsg] = useState<string | null>(null);

  const statusLabel = inst.status ? inst.status.charAt(0).toUpperCase() + inst.status.slice(1) : "—";

  const saveSettings = useCallback(async () => {
    if (!token || !instName.trim()) return;
    setSettingsBusy(true);
    try {
      await patchInstance(token, instanceId, { name: instName.trim() });
      await onRefreshInstance();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSettingsBusy(false);
    }
  }, [token, instanceId, instName, onRefreshInstance]);

  async function runIngest() {
    if (!token) return;
    const t = ingestText.trim();
    if (!t) return;
    setIngestBusy(true);
    setIngestMsg(null);
    try {
      await ingestInstance(token, instanceId, {
        text: t,
        source_label: "playground",
      });
      setIngestText("");
      setIngestMsg("Ingest request accepted. Processing may run asynchronously.");
    } catch (e) {
      setIngestMsg(e instanceof Error ? e.message : "Ingest failed");
    } finally {
      setIngestBusy(false);
    }
  }

  async function runQuery() {
    if (!token) return;
    const q = queryText.trim();
    if (!q) return;
    setQueryBusy(true);
    setQueryMsg(null);
    setQueryBody(null);
    try {
      const r = await queryInstance(token, instanceId, { query: q, top_k: 5 });
      setQueryBody(r);
    } catch (e) {
      setQueryMsg(e instanceof Error ? e.message : "Query failed");
    } finally {
      setQueryBusy(false);
    }
  }

  const tabs: [GraphTab, string][] = [
    ["playground", "Playground"],
    ["settings", "Settings"],
  ];

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col bg-bg3">
      <div className="border-b border-border bg-bg px-4 py-3 sm:px-6 lg:px-7">
        <div className="flex flex-wrap gap-2">
          {MEMORY_PILLS.map((p) => {
            const active = p.id === "graph";
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
          <span className="font-semibold text-ink">{inst.name}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border2 bg-bg px-2.5 py-1 text-[12px] text-muted">
            <span className={clsx("h-2 w-2 rounded-full", inst.status === "active" ? "bg-[#639922]" : "bg-[#ba7517]")} />
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={() => void onDeleteInstance()}
            className="rounded-lg border border-error-border bg-error-bg px-3 py-1.5 text-[12px] font-medium text-error hover:opacity-90"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="border-b border-border bg-bg px-4 sm:px-6 lg:px-7">
        <nav className="flex gap-8">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={clsx(
                "relative py-3 text-[13px] font-medium",
                tab === id ? "text-ink" : "text-muted hover:text-ink",
              )}
            >
              {label}
              {tab === id ? (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-ink" aria-hidden />
              ) : null}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-7">
        {tab === "playground" ? (
          <div className="mx-auto max-w-3xl space-y-6">
            <div className="rounded-[12px] border border-border bg-bg px-4 py-3 text-[12px] leading-relaxed text-muted">
              Graph memory uses the same ingest and query endpoints as other types. Entity extraction,{" "}
              <code className="rounded bg-bg2 px-1 font-mono text-[11px]">POST …/traverse</code>, and repair queue UIs will
              appear here as the API surface grows.
            </div>

            <section>
              <h2 className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">Ingest</h2>
              <textarea
                className="min-h-[100px] w-full rounded-lg border border-border2 bg-bg px-3 py-2 text-[13px] text-ink outline-none focus:border-[#c04d25]"
                placeholder="Paste text to extract entities and relations…"
                value={ingestText}
                onChange={(e) => setIngestText(e.target.value)}
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  disabled={ingestBusy || !ingestText.trim()}
                  onClick={() => void runIngest()}
                  className="rounded-lg px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: gCol }}
                >
                  {ingestBusy ? "Sending…" : "Ingest"}
                </button>
                {ingestMsg ? <span className="text-[12px] text-muted">{ingestMsg}</span> : null}
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">Query</h2>
              <input
                type="search"
                className="mb-2 h-[38px] w-full rounded-lg border border-border2 bg-bg px-3 text-[13px] text-ink outline-none focus:border-[#c04d25]"
                placeholder="Semantic search over the instance…"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runQuery();
                }}
              />
              <button
                type="button"
                disabled={queryBusy || !queryText.trim()}
                onClick={() => void runQuery()}
                className="rounded-lg border border-border2 bg-bg px-4 py-2 text-[13px] font-medium text-ink hover:bg-bg2 disabled:opacity-50"
              >
                {queryBusy ? "Querying…" : "Run query"}
              </button>
              {queryMsg ? (
                <p className="mt-2 text-[12px] text-error">{queryMsg}</p>
              ) : queryBody?.message ? (
                <div className="mt-4 rounded-lg border border-border bg-bg2 px-3 py-2.5 text-[13px] leading-relaxed text-ink">
                  {queryBody.message}
                </div>
              ) : null}
            </section>
          </div>
        ) : (
          <div className="mx-auto max-w-xl space-y-4">
            <label className="block text-[12px] text-muted">
              Instance name
              <input
                className="mt-1 h-[38px] w-full rounded-lg border border-border2 bg-bg px-3 text-[13px] text-ink outline-none focus:border-[#c04d25]"
                value={instName}
                onChange={(e) => setInstName(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={settingsBusy || !instName.trim()}
              onClick={() => void saveSettings()}
              className="rounded-lg px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: gCol }}
            >
              {settingsBusy ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
