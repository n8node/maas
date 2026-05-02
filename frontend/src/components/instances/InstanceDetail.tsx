"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { InstancesShell } from "@/components/instances/InstancesShell";
import { InstanceFilesPanel } from "@/components/instances/InstanceFilesPanel";
import { WikiInstancePanels } from "@/components/instances/WikiInstancePanels";
import {
  deleteInstance,
  getInstance,
  ingestInstance,
  queryInstance,
  type MeUser,
  type MemoryInstanceDTO,
  type QueryResultDTO,
} from "@/lib/api";
import { getToken } from "@/lib/token";
import { formatTokens } from "@/lib/format";
import clsx from "clsx";

type Props = { user: MeUser; onLogout?: () => void; instanceId: string };

type TabId = "playground" | "files";

export function InstanceDetail({ user, onLogout, instanceId }: Props) {
  const router = useRouter();
  const token = getToken() ?? "";
  const [inst, setInst] = useState<MemoryInstanceDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [ingestText, setIngestText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);

  const [queryText, setQueryText] = useState("");
  const [queryBusy, setQueryBusy] = useState(false);
  const [queryMsg, setQueryMsg] = useState<string | null>(null);
  const [queryBody, setQueryBody] = useState<QueryResultDTO | null>(null);
  const [tab, setTab] = useState<TabId>("playground");

  const load = useCallback(async () => {
    if (!token || !instanceId) return;
    setErr(null);
    setLoading(true);
    try {
      const m = await getInstance(token, instanceId);
      setInst(m);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load instance");
      setInst(null);
    } finally {
      setLoading(false);
    }
  }, [token, instanceId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setTab("playground");
  }, [instanceId]);

  async function onDelete() {
    if (!token || !inst) return;
    if (!window.confirm(`Delete instance “${inst.name}”? This removes all chunks.`)) return;
    try {
      await deleteInstance(token, instanceId);
      router.push("/instances");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function onIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !inst) return;
    setIngestBusy(true);
    setIngestMsg(null);
    try {
      const tid = sourceLabel.trim();
      const rag = inst.memory_type === "rag";
      const r = await ingestInstance(token, instanceId, {
        text: ingestText,
        ...(rag ? { source_label: tid || undefined } : { source_title: tid || undefined }),
      });
      setIngestMsg(`Added ${r.chunks_added} chunk(s), consumed ${formatTokens(r.tokens_consumed)} tokens.`);
      setIngestText("");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ingest failed";
      setIngestMsg(msg);
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
      const r = await queryInstance(token, instanceId, { query: queryText, top_k: 5 });
      setQueryBody({ message: r.message, tokens_used: r.tokens_used, citations: r.citations });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Query failed";
      setQueryMsg(msg);
    } finally {
      setQueryBusy(false);
    }
  }

  if (loading) {
    return (
      <InstancesShell user={user} onLogout={onLogout} title="Instance" headerRight={null}>
        <div className="flex flex-1 items-center justify-center p-7">
          <p className="text-sm text-muted">Loading…</p>
        </div>
      </InstancesShell>
    );
  }

  if (err || !inst) {
    return (
      <InstancesShell user={user} onLogout={onLogout} title="Instance" headerRight={null}>
        <div className="max-w-lg p-7">
          <div className="rounded-lg border border-error-border bg-error-bg px-4 py-3 text-xs text-error">{err ?? "Not found"}</div>
          <Link href="/instances" className="mt-4 inline-block text-[12px] font-medium text-accent hover:underline">
            ← All instances
          </Link>
        </div>
      </InstancesShell>
    );
  }

  const isRag = inst.memory_type === "rag";
  const isWiki = inst.memory_type === "wiki";
  const typeBadge =
    inst.memory_type === "rag" ? "RAG" : inst.memory_type === "wiki" ? "Wiki" : inst.memory_type.toUpperCase();

  return (
    <InstancesShell
      user={user}
      onLogout={onLogout}
      title={inst.name}
      headerRight={
        <div className="flex items-center gap-3">
          <span className="hidden text-[12px] text-muted sm:inline">
            {typeBadge} · {inst.status}
          </span>
          <button
            type="button"
            onClick={onDelete}
            className="text-[12px] font-medium text-error hover:underline"
          >
            Delete
          </button>
          <Link href="/instances" className="text-[12px] font-medium text-accent hover:underline">
            List
          </Link>
        </div>
      }
    >
      {isWiki ? (
        <WikiInstancePanels instanceId={instanceId} inst={inst} onRefreshInstance={load} />
      ) : (
        <>
          <div className="border-b border-border bg-bg px-7">
            <nav className="flex gap-1 pt-1">
              {(
                [
                  ["playground", "Playground"],
                  ...(isRag ? ([["files", "Files & vectors"]] as const) : []),
                ] as const
              ).map(([id, label]) => (
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

          {isRag && tab === "files" ? (
            <InstanceFilesPanel instanceId={instanceId} instanceName={inst.name} />
          ) : null}

          {!isRag || tab === "playground" ? (
            <div className="grid flex-1 gap-6 p-7 lg:grid-cols-2 lg:gap-8">
              <section className="rounded-lg border border-border bg-bg p-5">
                <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Ingest</h2>
                <p className="mt-1 text-[12px] text-muted">
                  Paste or type text. Chunks are indexed for search (no embeddings). Use Files & vectors for uploads with OpenRouter embeddings.
                </p>
                <form onSubmit={onIngest} className="mt-4 space-y-3">
                  <div>
                    <label className="text-[11px] text-subtle" htmlFor="src">
                      Source label (optional)
                    </label>
                    <input
                      id="src"
                      value={sourceLabel}
                      onChange={(e) => setSourceLabel(e.target.value)}
                      className="mt-1 w-full rounded-md border border-border bg-bg3 px-3 py-2 text-[13px] outline-none ring-accent focus:border-accent focus:ring-1"
                      placeholder="e.g. readme.md"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-subtle" htmlFor="ing">
                      Content
                    </label>
                    <textarea
                      id="ing"
                      value={ingestText}
                      onChange={(e) => setIngestText(e.target.value)}
                      rows={10}
                      className="mt-1 w-full resize-y rounded-md border border-border bg-bg3 px-3 py-2 font-mono text-[12px] leading-relaxed outline-none ring-accent focus:border-accent focus:ring-1"
                      placeholder="Paste documents, notes, or transcripts…"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={ingestBusy}
                    className="rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
                  >
                    {ingestBusy ? "Ingesting…" : "Ingest"}
                  </button>
                  {ingestMsg ? (
                    <p className={`text-[12px] ${ingestMsg.startsWith("Added") ? "text-success-text" : "text-error"}`}>{ingestMsg}</p>
                  ) : null}
                </form>
              </section>

              <section className="rounded-lg border border-border bg-bg p-5">
                <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Query</h2>
                <p className="mt-1 text-[12px] text-muted">
                  Uses vector similarity when file embeddings exist; otherwise full-text search. Citations only — no LLM synthesis yet.
                </p>
                <form onSubmit={onQuery} className="mt-4 space-y-3">
                  <div>
                    <label className="text-[11px] text-subtle" htmlFor="q">
                      Question or keywords
                    </label>
                    <textarea
                      id="q"
                      value={queryText}
                      onChange={(e) => setQueryText(e.target.value)}
                      rows={3}
                      className="mt-1 w-full resize-y rounded-md border border-border bg-bg3 px-3 py-2 text-[13px] outline-none ring-accent focus:border-accent focus:ring-1"
                      placeholder="What should we retrieve?"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={queryBusy}
                    className="rounded-lg border border-border bg-bg px-4 py-2 text-[12px] font-medium text-ink hover:bg-bg2 disabled:opacity-50"
                  >
                    {queryBusy ? "Searching…" : "Run query"}
                  </button>
                  {queryMsg ? <p className="text-[12px] text-error">{queryMsg}</p> : null}
                  {queryBody ? (
                    <div className="space-y-3 border-t border-border pt-4">
                      <p className="text-[12px] leading-relaxed text-ink">{queryBody.message}</p>
                      <p className="text-[11px] text-subtle">Tokens used: {formatTokens(queryBody.tokens_used)}</p>
                      {queryBody.citations.length > 0 ? (
                        <div>
                          <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-subtle">Citations</div>
                          <ul className="space-y-2">
                            {queryBody.citations.map((c) => (
                              <li
                                key={c.chunk_id}
                                className="rounded-md border border-border2 bg-bg3 px-3 py-2 text-[11px] leading-snug text-muted"
                              >
                                <span className="font-mono text-[10px] text-subtle">{c.chunk_id.slice(0, 8)}…</span>
                                <span className="mx-2 text-border">·</span>
                                score {c.score.toFixed(3)}
                                <p className="mt-1 text-[12px] text-ink">{c.snippet}</p>
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
        </>
      )}
    </InstancesShell>
  );
}
