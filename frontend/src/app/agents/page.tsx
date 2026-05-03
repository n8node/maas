"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { billingMeRequest, deleteAgent, listAgents, listInstances, meRequest, type AgentDTO, type MeUser } from "@/lib/api";
import { clearToken, getToken } from "@/lib/token";

export default function AgentsPage() {
  const router = useRouter();
  const token = getToken() ?? "";
  const [user, setUser] = useState<MeUser | null>(null);
  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [instancesCount, setInstancesCount] = useState(0);
  const [planLabel, setPlanLabel] = useState("Free plan");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setErr(null);
    try {
      const [list, ic, bill] = await Promise.all([
        listAgents(token),
        listInstances(token).catch(() => []),
        billingMeRequest(token).catch(() => null),
      ]);
      setAgents(Array.isArray(list) ? list : []);
      setInstancesCount(Array.isArray(ic) ? ic.length : 0);
      if (bill?.plan) setPlanLabel(`${bill.plan.name} plan`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load agents");
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    meRequest(token)
      .then(setUser)
      .catch(() => {
        clearToken();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (user && token) void load();
  }, [user, token, load]);

  useEffect(() => {
    if (!loading && !user && !getToken()) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  function logout() {
    clearToken();
    setUser(null);
    router.refresh();
  }

  async function remove(id: string) {
    if (!token || !window.confirm("Delete this agent? Memory instances stay; they revert to standalone.")) return;
    try {
      await deleteAgent(token, id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg3">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-bg3 pl-[220px]">
      <DashboardSidebar
        userEmail={user.email}
        planLabel={planLabel}
        instanceCount={instancesCount}
        agentCount={agents.length}
        isSuperadmin={user.role === "superadmin"}
        onLogout={logout}
      />
      <div className="min-h-screen px-7 py-7">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-6">
          <div>
            <h1 className="text-[15px] font-medium text-ink">Agents</h1>
            <p className="mt-1 text-[13px] text-muted">Unified gateway over several memory layers with one ingest/query route.</p>
          </div>
          <Link
            href="/agents/new"
            className="rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-bg hover:opacity-90"
          >
            New agent
          </Link>
        </header>

        {err ? <div className="mb-4 rounded-lg border border-error-border bg-error-bg px-4 py-2 text-[12px] text-error">{err}</div> : null}

        {agents.length === 0 ? (
          <div className="rounded-lg border border-border bg-bg p-8 text-center text-[13px] text-muted">
            No agents yet.&nbsp;
            <Link href="/agents/new" className="font-medium text-accent underline">
              Create one
            </Link>
            &nbsp;and attach standalone instances first.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-bg">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-border bg-bg2">
                  <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wide text-subtle">Name</th>
                  <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wide text-subtle">Status</th>
                  <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wide text-subtle" />
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0 hover:bg-bg2">
                    <td className="px-4 py-3">
                      <Link href={`/agents/${encodeURIComponent(a.id)}`} className="font-medium text-ink underline-offset-4 hover:text-accent hover:underline">
                        {a.name}
                      </Link>
                      {a.description ? <div className="mt-0.5 text-[11px] text-subtle">{a.description}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-muted">{a.status}</td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => void remove(a.id)} className="text-[11px] text-error hover:underline">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
