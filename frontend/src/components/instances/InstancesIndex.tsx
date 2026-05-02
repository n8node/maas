"use client";

import { Database, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { InstancesShell } from "@/components/instances/InstancesShell";
import { listInstances, type MeUser, type MemoryInstanceDTO } from "@/lib/api";
import { getToken } from "@/lib/token";

function typeLabel(t: string): string {
  return t === "rag" ? "RAG" : t;
}

export function InstancesIndex({ user, onLogout }: { user: MeUser; onLogout?: () => void }) {
  const token = getToken() ?? "";
  const [items, setItems] = useState<MemoryInstanceDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setErr(null);
    try {
      const list = await listInstances(token);
      setItems(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load instances");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <InstancesShell
      user={user}
      onLogout={onLogout}
      title="Memory instances"
      headerRight={
        <Link
          href="/instances/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-bg hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          New instance
        </Link>
      }
    >
      <div className="max-w-5xl p-7 text-[13px]">
        <p className="mb-6 text-sm text-muted">
          RAG instances store chunked text for retrieval-augmented workflows. Ingest content, then query with full-text search —
          citations appear without LLM synthesis (coming later).
        </p>

        {err ? (
          <div className="mb-5 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-xs text-error">{err}</div>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted">Loading instances…</p>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-border bg-bg px-6 py-14 text-center">
            <Database className="mx-auto mb-3 h-8 w-8 text-muted opacity-60" strokeWidth={1.25} aria-hidden />
            <p className="text-[13px] font-medium text-ink">No instances yet</p>
            <p className="mt-1 text-[12px] text-muted">Create a RAG instance to start ingesting and querying.</p>
            <Link
              href="/instances/new"
              className="mt-4 inline-flex rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-bg hover:opacity-90"
            >
              Create instance
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-bg">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-border bg-bg2/50 text-[10px] font-medium uppercase tracking-wide text-subtle">
                <tr>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const updated = (() => {
                    try {
                      return new Date(row.updated_at).toLocaleString();
                    } catch {
                      return row.updated_at;
                    }
                  })();
                  return (
                    <tr key={row.id} className="border-b border-border last:border-0 hover:bg-bg2/40">
                      <td className="px-4 py-3">
                        <Link href={`/instances/${row.id}`} className="font-medium text-accent hover:underline">
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted">{typeLabel(row.memory_type)}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-text">
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-[12px] text-subtle">{updated}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </InstancesShell>
  );
}
