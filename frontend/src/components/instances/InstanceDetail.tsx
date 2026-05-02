"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { InstancesShell } from "@/components/instances/InstancesShell";
import { RagInstancePanels } from "@/components/instances/RagInstancePanels";
import { WikiInstancePanels } from "@/components/instances/WikiInstancePanels";
import { deleteInstance, getInstance, type MeUser, type MemoryInstanceDTO } from "@/lib/api";
import { getToken } from "@/lib/token";

type Props = { user: MeUser; onLogout?: () => void; instanceId: string };

export function InstanceDetail({ user, onLogout, instanceId }: Props) {
  const router = useRouter();
  const token = getToken() ?? "";
  const [inst, setInst] = useState<MemoryInstanceDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

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

  async function onDelete() {
    if (!token || !inst) return;
    if (!window.confirm(`Delete instance “${inst.name}”? This removes all data for this instance.`)) return;
    try {
      await deleteInstance(token, instanceId);
      router.push("/instances");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
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
  const fullBleed = isWiki || isRag;

  return (
    <InstancesShell
      user={user}
      onLogout={onLogout}
      title={fullBleed ? "" : inst.name}
      omitHeader={fullBleed}
      headerRight={
        fullBleed ? null : (
          <div className="flex items-center gap-3">
            <span className="hidden text-[12px] text-muted sm:inline">
              {typeBadge} · {inst.status}
            </span>
            <button type="button" onClick={onDelete} className="text-[12px] font-medium text-error hover:underline">
              Delete
            </button>
            <Link href="/instances" className="text-[12px] font-medium text-accent hover:underline">
              List
            </Link>
          </div>
        )
      }
    >
      {isWiki ? (
        <WikiInstancePanels
          instanceId={instanceId}
          inst={inst}
          onRefreshInstance={load}
          onDeleteInstance={onDelete}
        />
      ) : isRag ? (
        <RagInstancePanels
          instanceId={instanceId}
          inst={inst}
          onRefreshInstance={load}
          onDeleteInstance={onDelete}
        />
      ) : (
        <div className="p-7">
          <p className="text-[13px] text-muted">
            Dashboard for memory type <span className="font-medium text-ink">{typeBadge}</span> is not available in this build.
          </p>
          <Link href="/instances" className="mt-4 inline-block text-[12px] font-medium text-accent hover:underline">
            ← All instances
          </Link>
        </div>
      )}
    </InstancesShell>
  );
}
