"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { billingMeRequest, listAgents, listInstances, createApiKey, deleteApiKey, listApiKeys, meRequest, type ApiKeyDTO, type MeUser } from "@/lib/api";
import { clearToken, getToken } from "@/lib/token";

export default function ApiKeysPage() {
  const router = useRouter();
  const token = getToken() ?? "";

  const [user, setUser] = useState<MeUser | null>(null);
  const [keys, setKeys] = useState<ApiKeyDTO[]>([]);
  const [instances, setInstances] = useState(0);
  const [agents, setAgents] = useState(0);
  const [planLabel, setPlanLabel] = useState("Free plan");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadKeys = useCallback(async () => {
    if (!token) return;
    setErr(null);
    try {
      const [k, inst, ag, bill] = await Promise.all([
        listApiKeys(token),
        listInstances(token).catch(() => []),
        listAgents(token).catch(() => []),
        billingMeRequest(token).catch(() => null),
      ]);
      setKeys(k);
      setInstances(Array.isArray(inst) ? inst.length : 0);
      setAgents(Array.isArray(ag) ? ag.length : 0);
      if (bill?.plan) setPlanLabel(`${bill.plan.name} plan`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load keys");
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
    if (user && token) void loadKeys();
  }, [user, token, loadKeys]);

  useEffect(() => {
    if (!loading && !user && !getToken()) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !nameDraft.trim()) return;
    setCreating(true);
    setErr(null);
    try {
      const k = await createApiKey(token, nameDraft.trim());
      setNewSecret(k.key);
      setNameDraft("");
      await loadKeys();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(id: string) {
    if (!token || !window.confirm("Revoke this API key? Integrations using it will stop.")) return;
    setErr(null);
    try {
      await deleteApiKey(token, id);
      await loadKeys();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Revoke failed");
    }
  }

  function logout() {
    clearToken();
    setUser(null);
    router.refresh();
  }

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg3">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }

  const isSuperadmin = user.role === "superadmin";

  return (
    <div className="min-h-screen bg-bg3 pl-[220px]">
      <DashboardSidebar
        userEmail={user.email}
        planLabel={planLabel}
        instanceCount={instances}
        agentCount={agents}
        isSuperadmin={isSuperadmin}
        onLogout={logout}
      />

      <div className="min-h-screen">
        <header className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-border bg-bg px-7">
          <span className="text-[15px] font-medium text-ink">API keys</span>
          <Link href="/" className="text-[12px] font-medium text-accent hover:underline">
            Overview
          </Link>
        </header>

        <div className="max-w-3xl px-7 py-7 text-[13px]">
          <p className="text-[13px] text-muted">
            Use Mnemoniqa programmatically via <code className="rounded bg-bg2 px-1 font-mono text-[12px]">Authorization: Bearer mnq_*</code>{" "}
            on the REST API (<code className="font-mono text-[12px]">/api/v1</code>).
          </p>

          <form onSubmit={(e) => void onCreate(e)} className="mt-6 flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-[11px] text-subtle">Key name</label>
              <input
                className="h-[38px] w-full rounded-lg border border-border2 bg-bg px-3 text-[13px] outline-none focus:border-muted"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Production bot"
              />
            </div>
            <button
              type="submit"
              disabled={creating || !nameDraft.trim()}
              className="rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create key"}
            </button>
          </form>

          {err ? <div className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-2 text-[12px] text-error">{err}</div> : null}

          {newSecret ? (
            <div className="mt-6 rounded-lg border border-accent-bg bg-accent-bg px-4 py-3 text-[12px] text-accent">
              <strong className="text-ink">Copy this secret now —</strong> it will not be shown again.
              <pre className="mt-2 break-all rounded bg-bg p-3 font-mono text-[11px] text-ink">{newSecret}</pre>
              <button type="button" className="mt-2 text-[11px] font-medium underline" onClick={() => setNewSecret(null)}>
                I’ve copied it
              </button>
            </div>
          ) : null}

          <h2 className="mb-2 mt-8 text-[10px] font-medium uppercase tracking-[0.1em] text-subtle">Active keys</h2>
          <div className="overflow-hidden rounded-lg border border-border bg-bg">
            {keys.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-muted">No keys yet.</div>
            ) : (
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-bg2">
                    <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-subtle">Name</th>
                    <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-subtle">Prefix</th>
                    <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-subtle">Created</th>
                    <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-subtle" />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id} className="border-b border-border text-[12px] last:border-0">
                      <td className="px-4 py-2.5 font-medium text-ink">{k.name}</td>
                      <td className="px-4 py-2.5 font-mono text-muted">{k.key_prefix}…</td>
                      <td className="px-4 py-2.5 text-muted">{new Date(k.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-2.5">
                        <button type="button" onClick={() => void onDelete(k.id)} className="text-[11px] text-error hover:underline">
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p className="mt-6 text-[11px] text-subtle">
            Tip: JWT from the dashboard is separate from API keys — use dedicated keys for your agents in production ({agents}{" "}
            agent(s) configured).
          </p>
          <Link href="/docs/quickstart" className="mt-4 inline-block text-[12px] font-medium text-accent hover:underline">
            Quick start →
          </Link>
        </div>
      </div>
    </div>
  );
}
