"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { InstancesShell } from "@/components/instances/InstancesShell";
import {
  deleteInstanceChunk,
  listSourceChunks,
  listSources,
  type MeUser,
  type RAGSourceDTO,
  type SourceChunkDTO,
} from "@/lib/api";
import { formatTokens } from "@/lib/format";
import { getToken } from "@/lib/token";

type Props = {
  user: MeUser;
  onLogout?: () => void;
  instanceId: string;
  sourceId: string;
};

export function SourceEmbeddingsPage({ user, onLogout, instanceId, sourceId }: Props) {
  const token = getToken() ?? "";
  const [source, setSource] = useState<RAGSourceDTO | null>(null);
  const [chunks, setChunks] = useState<SourceChunkDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setErr(null);
    setLoading(true);
    try {
      const sources = await listSources(token, instanceId);
      const s = sources.find((x) => x.id === sourceId) ?? null;
      setSource(s);
      const off = page * pageSize;
      const r = await listSourceChunks(token, instanceId, sourceId, pageSize, off);
      setChunks(r.chunks);
      setTotal(r.total);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load");
      setSource(null);
      setChunks([]);
    } finally {
      setLoading(false);
    }
  }, [token, instanceId, sourceId, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  async function onDeleteChunk(id: string) {
    if (!token || !window.confirm("Delete this chunk from the vector store?")) return;
    try {
      await deleteInstanceChunk(token, instanceId, id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function previewVec(v: number[] | null): string {
    if (!v || v.length === 0) return "—";
    const head = v.slice(0, 12).map((x) => x.toFixed(6));
    return `[${head.join(", ")}, …] (${v.length} dims)`;
  }

  const title = "Document embeddings";
  const fileLabel = source?.filename ?? "—";

  return (
    <InstancesShell
      user={user}
      onLogout={onLogout}
      title={title}
      headerRight={
        <Link href={`/instances/${instanceId}`} className="text-[12px] font-medium text-accent hover:underline">
          ← Instance
        </Link>
      }
    >
      <div className="max-w-6xl p-7 text-[13px]">
        <nav className="mb-5 text-[12px] text-muted">
          <Link href="/instances" className="text-accent hover:underline">
            Instances
          </Link>
          <span className="mx-2 text-border">/</span>
          <Link href={`/instances/${instanceId}`} className="text-accent hover:underline">
            Detail
          </Link>
          <span className="mx-2 text-border">/</span>
          <span className="text-ink">Document embeddings</span>
        </nav>

        {source ? (
          <p className="mb-1 text-[15px] font-medium text-ink">{fileLabel}</p>
        ) : !loading ? (
          <p className="mb-1 text-[13px] text-muted">Source not found or was deleted.</p>
        ) : null}
        {source ? (
          <p className="mb-6 text-[12px] text-muted">
            {source.chunk_count} chunk(s) · {formatTokens(source.tokens_total)} tokens · {source.embedding_model || "—"}
          </p>
        ) : null}

        {err ? (
          <div className="mb-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-xs text-error">{err}</div>
        ) : null}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[12px] text-muted">
            Rows per page
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              className="rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-ink"
            >
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="text-[12px] text-subtle">
            {total === 0 ? "0" : `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)}`} of {total}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-md border border-border px-3 py-1 text-[12px] disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={(page + 1) * pageSize >= total}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-border px-3 py-1 text-[12px] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-bg">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-border bg-bg2/50 text-[10px] font-medium uppercase tracking-wide text-subtle">
                <tr>
                  <th className="w-10 px-2 py-2.5"> </th>
                  <th className="px-3 py-2.5">№</th>
                  <th className="min-w-[200px] px-3 py-2.5">Text</th>
                  <th className="hidden min-w-[240px] px-3 py-2.5 md:table-cell">Vector</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5 text-right"> </th>
                </tr>
              </thead>
              <tbody>
                {chunks.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-bg2/30">
                    <td className="px-2 py-3">
                      <span className="inline-block h-3 w-3 rounded border border-border bg-bg2" aria-hidden />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted">{c.ordinal}</td>
                    <td className="max-w-md px-3 py-3 align-top text-[12px] leading-relaxed text-ink">{c.content}</td>
                    <td className="hidden max-w-xl px-3 py-3 align-top font-mono text-[10px] text-muted md:table-cell">
                      {previewVec(c.embedding)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-[11px] text-subtle">
                      {(() => {
                        try {
                          return new Date(c.created_at).toLocaleString(undefined, {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          });
                        } catch {
                          return c.created_at;
                        }
                      })()}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onDeleteChunk(c.id)}
                        className="inline-flex text-error hover:opacity-80"
                        title="Delete chunk"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && chunks.length === 0 && !err ? (
          <p className="mt-6 text-center text-[12px] text-muted">No chunks for this source.</p>
        ) : null}
      </div>
    </InstancesShell>
  );
}
