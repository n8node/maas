"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { createAgent, meRequest, type MeUser } from "@/lib/api";
import { clearToken, getToken } from "@/lib/token";

export default function NewAgentPage() {
  const router = useRouter();
  const token = getToken() ?? "";
  const [user, setUser] = useState<MeUser | null>(null);
  const [name, setName] = useState("My unified agent");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    }
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      const id = await createAgent(token, name.trim(), desc.trim());
      router.push(`/agents/${id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create");
    } finally {
      setBusy(false);
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
    <div className="min-h-screen bg-bg3">
      <div className="mx-auto max-w-lg px-6 py-14">
        <Link href="/agents" className="text-[12px] font-medium text-accent hover:underline">
          ← Agents
        </Link>
        <h1 className="mt-6 text-[15px] font-medium text-ink">New agent</h1>
        <p className="mt-1 text-[13px] text-muted">Create the agent shell, then attach memory instances.</p>

        <form onSubmit={(e) => void submit(e)} className="mt-8 space-y-4">
          {err ? <div className="rounded-lg border border-error-border bg-error-bg px-3 py-2 text-[12px] text-error">{err}</div> : null}
          <div>
            <label className="mb-1 block text-[11px] text-muted">Name</label>
            <input
              className="h-[38px] w-full rounded-lg border border-border2 bg-bg px-3 text-[13px] outline-none focus:border-muted"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted">Description (optional)</label>
            <textarea
              className="min-h-[80px] w-full rounded-lg border border-border2 bg-bg px-3 py-2 text-[13px] outline-none focus:border-muted"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="w-full rounded-lg bg-ink py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
