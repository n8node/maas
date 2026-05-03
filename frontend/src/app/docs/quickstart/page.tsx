"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { billingMeRequest, listAgents, listInstances, meRequest, type MeUser } from "@/lib/api";
import { clearToken, getToken } from "@/lib/token";

export default function QuickstartPage() {
  const token = getToken() ?? "";
  const [user, setUser] = useState<MeUser | null>(null);
  const [instances, setInstances] = useState(0);
  const [agents, setAgents] = useState(0);
  const [planLabel, setPlanLabel] = useState("Free plan");

  useEffect(() => {
    if (!token) return;
    meRequest(token)
      .then(setUser)
      .catch(() => clearToken())
      .finally(() =>
        billingMeRequest(token).then((b) => setPlanLabel(b.plan ? `${b.plan.name} plan` : "Free plan")),
      );
    Promise.all([
      listInstances(token).catch(() => []),
      listAgents(token).catch(() => []),
    ]).then(([i, ag]) => {
      setInstances(Array.isArray(i) ? i.length : 0);
      setAgents(Array.isArray(ag) ? ag.length : 0);
    });
  }, [token]);

  return (
    <div className="min-h-screen bg-bg3 pl-[220px]">
      {user ? (
        <DashboardSidebar
          userEmail={user.email}
          planLabel={planLabel}
          instanceCount={instances}
          agentCount={agents}
          isSuperadmin={user.role === "superadmin"}
        />
      ) : null}
      <div className="max-w-3xl px-8 py-12 text-[13px] leading-relaxed text-ink">
        {!user ? (
          <div className="mb-8 rounded-lg border border-border bg-bg px-4 py-3 text-[12px] text-muted">
            <Link href="/login" className="font-medium text-accent underline">
              Sign in
            </Link>
            {" "}
            to see the sidebar; this page stays readable without an account.
          </div>
        ) : null}
        <h1 className="text-[20px] font-medium tracking-tight">Quick start</h1>
        <p className="mt-2 text-muted">
          Connect your app to Mnemoniqa in three steps. REST base path:{" "}
          <code className="rounded bg-bg2 px-1 font-mono text-[12px]">/api/v1</code> behind your deployment host (same origin as this
          dashboard in production).
        </p>

        <ol className="mt-8 list-decimal space-y-6 ps-5 marker:font-medium marker:text-ink">
          <li>
            <strong className="font-medium">Create an API key</strong>
            <p className="mt-1 text-muted">
              Open{" "}
              <Link className="font-medium text-accent underline" href="/api-keys">
                API keys
              </Link>{" "}
              and create a key. Send{" "}
              <code className="font-mono text-[11px]">Authorization: Bearer mnq_...</code>.
            </p>
          </li>
          <li>
            <strong className="font-medium">Create memory instances</strong>
            <p className="mt-1 text-muted">
              Add instances from{" "}
              <Link className="font-medium text-accent underline" href="/instances/new">
                New instance
              </Link>
              . Ingest via{" "}
              <code className="font-mono text-[11px]">
                POST /instances/{`{id}`}/ingest
              </code>
              .
            </p>
          </li>
          <li>
            <strong className="font-medium">Optional: agents</strong>
            <p className="mt-1 text-muted">
              <Link className="font-medium text-accent underline" href="/agents">
                Agents
              </Link>{" "}
              group layers:{" "}
              <code className="font-mono text-[11px]">
                POST /agents/{`{id}`}/query
              </code>{" "}
              merges enabled layers (no LLM synthesis in this MVP).{" "}
              <code className="font-mono text-[11px]">
                POST /agents/{`{id}`}/ingest
              </code>{" "}
              with{" "}
              <code className="font-mono text-[11px]">target_memory_type</code> routes to the matching layer;
              for working layers include <code className="font-mono text-[11px]">working_session_id</code>, <code className="font-mono text-[11px]">key</code>, JSON{" "}
              <code className="font-mono text-[11px]">value</code>.
            </p>
          </li>
        </ol>

        <p className="mt-8 text-[12px] text-subtle">
          Supply <code className="font-mono">user_id</code> / <code className="font-mono">session_id</code> the same way you identify chats in your product.
        </p>
        <Link href="/" className="mt-6 inline-block text-[12px] font-medium text-accent hover:underline">
          ← Overview
        </Link>
      </div>
    </div>
  );
}
