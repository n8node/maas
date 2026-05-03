"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  addAgentLayer,
  agentQuery,
  getAgent,
  listInstances,
  meRequest,
  removeAgentLayer,
  type AgentDTO,
  type AgentLayerDTO,
  type MemoryInstanceDTO,
  type MeUser,
} from "@/lib/api";
import { clearToken, getToken } from "@/lib/token";

export default function AgentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const token = getToken() ?? "";

  const [user, setUser] = useState<MeUser | null>(null);
  const [agent, setAgent] = useState<AgentDTO | null>(null);
  const [instances, setInstances] = useState<MemoryInstanceDTO[]>([]);
  const [attachId, setAttachId] = useState("");
  const [role, setRole] = useState("layer");
  const [priority, setPriority] = useState(1);
  const [q, setQ] = useState("What does our memory contain?");
  const [qOut, setQOut] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const layers = agent?.layers ?? [];

  const load = useCallback(async () => {
    if (!token || !id) return;
    const [ag, inst] = await Promise.all([
      getAgent(token, id),
      listInstances(token).catch(() => [] as MemoryInstanceDTO[]),
    ]);
    setAgent(ag);
    setInstances(inst);
    return ag;
  }, [token, id]);

  useEffect(() => {
    if (!token) return;
    meRequest(token)
      .then(setUser)
      .catch(() => {
        clearToken();
        setUser(null);
      });
  }, [token]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    load().catch(() => setErr("Could not load")).finally(() => setLoading(false));
  }, [router, load]);

  const attachOptions = useMemo(() => instances.filter(() => true), [instances]);

  async function attach() {
    if (!token || !attachId.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await addAgentLayer(token, id, {
        instance_id: attachId,
        role: role.trim(),
        priority,
      });
      setAttachId("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Attach failed");
    } finally {
      setBusy(false);
    }
  }

  async function detach(iid: string) {
    if (!token || !window.confirm("Detach instance from this agent?")) return;
    setBusy(true);
    setErr(null);
    try {
      await removeAgentLayer(token, id, iid);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Detach failed");
    } finally {
      setBusy(false);
    }
  }

  async function runQuery() {
    if (!token || !q.trim()) return;
    setBusy(true);
    setErr(null);
    setQOut("");
    try {
      const data = await agentQuery(token, id, { query: q, top_k: 5 });
      setQOut(JSON.stringify(data, null, 2));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Query failed");
    } finally {
      setBusy(false);
    }
  }

  if (!user || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg3">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }

  if (!agent) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg3">
        <p className="text-sm text-muted">Agent not found.</p>
        <Link href="/agents" className="text-sm text-accent underline">
          Back to agents
        </Link>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-bg3 px-7 py-7">
      <nav className="mb-6 text-[12px] text-muted">
        <Link href="/agents" className="text-accent hover:underline">
          Agents
        </Link>
        <span className="mx-1 text-border2">/</span>
        <span className="text-ink">{agent.name}</span>
      </nav>

      <h1 className="text-[18px] font-medium text-ink">{agent.name}</h1>
      {agent.description ? <p className="mt-1 text-[13px] text-muted">{agent.description}</p> : null}

      {err ? <div className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-2 text-[12px] text-error">{err}</div> : null}

      <section className="mt-8">
        <h2 className="mb-3 text-[10px] font-medium uppercase tracking-[0.1em] text-subtle">Layers</h2>
        <div className="flex flex-wrap gap-2">
          <select
            value={attachId}
            onChange={(e) => setAttachId(e.target.value)}
            className="h-[36px] min-w-[200px] rounded-lg border border-border2 bg-bg px-2 text-[13px]"
          >
            <option value="">Select instance…</option>
            {attachOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.memory_type})
              </option>
            ))}
          </select>
          <input
            className="h-[36px] w-[120px] rounded-lg border border-border2 bg-bg px-2 text-[13px]"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="role"
          />
          <input
            type="number"
            min={1}
            className="h-[36px] w-[70px] rounded-lg border border-border2 bg-bg px-2 text-[13px]"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value) || 1)}
          />
          <button
            type="button"
            disabled={busy || !attachId}
            onClick={() => void attach()}
            className="rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-bg disabled:opacity-50"
          >
            Attach
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-bg">
          {layers.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-muted">Attach at least one instance.</div>
          ) : (
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-border bg-bg2">
                  <th className="px-3 py-2">Instance</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Priority</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {layers.map((l: AgentLayerDTO) => (
                  <tr key={`${agent.id}:${l.instance_id}`} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium">{l.name}</td>
                    <td className="px-3 py-2 text-muted">{l.memory_type}</td>
                    <td className="px-3 py-2">{l.priority}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" disabled={busy} onClick={() => void detach(l.instance_id)} className="text-error hover:underline">
                        Detach
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-[10px] font-medium uppercase tracking-[0.1em] text-subtle">Query playground</h2>
        <p className="mb-3 text-[12px] text-muted">
          POST <span className="font-mono">/api/v1/agents/&lt;id&gt;/query</span> — merges enabled layers without an extra synthesis step yet.
        </p>
        <textarea
          className="mb-3 min-h-[80px] w-full max-w-2xl rounded-lg border border-border2 bg-bg p-3 font-mono text-[12px]"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void runQuery()}
          className="rounded-lg bg-[#534ab7] px-4 py-2 text-[12px] font-medium text-bg hover:opacity-90"
        >
          Run query
        </button>
        {qOut ? (
          <pre className="mt-4 max-w-4xl overflow-x-auto rounded-lg border border-border bg-bg p-4 font-mono text-[11px] text-ink">{qOut}</pre>
        ) : null}
      </section>
    </div>
  );
}
