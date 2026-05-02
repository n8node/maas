"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  ingestInstanceFile,
  listSources,
  type RAGSourceDTO,
} from "@/lib/api";
import { formatFileSize, formatTokens } from "@/lib/format";
import { getToken } from "@/lib/token";
import clsx from "clsx";

type Props = {
  instanceId: string;
  instanceName: string;
};

export function InstanceFilesPanel({ instanceId, instanceName }: Props) {
  const token = getToken() ?? "";
  const [sources, setSources] = useState<RAGSourceDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setErr(null);
    try {
      const list = await listSources(token, instanceId);
      setSources(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load files");
    } finally {
      setLoading(false);
    }
  }, [token, instanceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !token) return;
    setUploadBusy(true);
    setUploadMsg(null);
    try {
      const r = await ingestInstanceFile(token, instanceId, file);
      setUploadMsg(
        `Ingested ${file.name}: ${r.chunks_added} chunk(s), ${formatTokens(r.tokens_consumed)} tokens · ${r.embedding_model}`,
      );
      await load();
    } catch (ex) {
      setUploadMsg(ex instanceof Error ? ex.message : "Upload failed");
    } finally {
      setUploadBusy(false);
    }
  }

  function formatProcessed(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return iso;
    }
  }

  return (
    <div className="max-w-6xl p-7 text-[13px]">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[15px] font-medium text-ink">Files with embeddings</h2>
          <p className="mt-1 text-[12px] text-muted">
            Instance · <span className="text-ink">{instanceName}</span>. Upload text, Markdown, HTML, or DOCX (PDF coming
            soon). Requires <code className="rounded bg-bg2 px-1 text-[11px]">OPENROUTER_API_KEY</code> on the server.
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-border bg-bg px-4 py-2 text-[12px] font-medium text-ink hover:bg-bg2 disabled:opacity-50">
          <input type="file" className="sr-only" accept=".txt,.md,.markdown,.html,.htm,.csv,.json,.docx" onChange={onPickFile} disabled={uploadBusy} />
          {uploadBusy ? "Uploading…" : "Upload file"}
        </label>
      </div>

      {uploadMsg ? (
        <p className={clsx("mb-4 text-[12px]", uploadMsg.includes("chunk") ? "text-success-text" : "text-error")}>{uploadMsg}</p>
      ) : null}

      {err ? (
        <div className="mb-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-xs text-error">{err}</div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : sources.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg px-6 py-12 text-center text-[13px] text-muted">
          No files yet. Upload a document to chunk and vectorize it.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-bg">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border bg-bg2/50 text-[10px] font-medium uppercase tracking-wide text-subtle">
              <tr>
                <th className="px-4 py-2.5">File</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">Folder</th>
                <th className="px-4 py-2.5">Size</th>
                <th className="hidden px-4 py-2.5 md:table-cell">Tokens</th>
                <th className="hidden px-4 py-2.5 lg:table-cell">Model</th>
                <th className="px-4 py-2.5">Chunks</th>
                <th className="hidden px-4 py-2.5 md:table-cell">Processed</th>
                <th className="px-4 py-2.5 text-right"> </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-bg2/30">
                  <td className="max-w-[200px] truncate px-4 py-3 font-medium text-ink" title={s.filename}>
                    {s.filename}
                  </td>
                  <td className="hidden px-4 py-3 text-accent sm:table-cell">
                    <Link href={`/instances/${instanceId}`} className="hover:underline">
                      {instanceName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">{formatFileSize(s.byte_size)}</td>
                  <td className="hidden px-4 py-3 text-muted md:table-cell">{formatTokens(s.tokens_total)}</td>
                  <td className="hidden px-4 py-3 text-[11px] text-muted lg:table-cell">
                    {s.embedding_model || "—"}
                  </td>
                  <td className="px-4 py-3">{s.chunk_count}</td>
                  <td className="hidden px-4 py-3 text-[12px] text-subtle md:table-cell">{formatProcessed(s.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/instances/${instanceId}/files/${s.id}`}
                      className="inline-flex rounded-full border border-accent bg-accent-bg px-3 py-1 text-[11px] font-medium text-accent hover:opacity-90"
                    >
                      Embeddings →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
