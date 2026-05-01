"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { billingMeRequest, type BillingMeData } from "@/lib/api";
import { getToken } from "@/lib/token";

export default function BillingPage() {
  const [data, setData] = useState<BillingMeData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = getToken();
    if (!t) {
      setLoading(false);
      setErr("Sign in to view billing.");
      return;
    }
    billingMeRequest(t)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-6 py-12">
        <p className="text-sm text-muted">Loading billing…</p>
      </main>
    );
  }

  if (err || !data) {
    return (
      <main className="mx-auto max-w-lg px-6 py-12">
        <p className="text-sm text-red-700">{err ?? "No data"}</p>
        <Link href="/login" className="mt-4 inline-block text-sm text-ink underline">
          Sign in
        </Link>
      </main>
    );
  }

  const plan = data.plan as { name?: string; slug?: string; monthly_tokens?: number } | undefined;

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <p className="text-xs uppercase tracking-wide text-muted">Mnemoniqa</p>
      <h1 className="mt-1 text-lg font-medium text-ink">Billing</h1>
      <p className="mt-4 text-sm text-subtle">
        Tokens remaining (all buckets):{" "}
        <span className="font-medium text-ink">{data.tokens_remaining.toLocaleString()}</span>
      </p>
      {plan ? (
        <div className="mt-6 rounded-lg border border-border bg-bg p-4">
          <p className="text-sm font-medium text-ink">{plan.name}</p>
          <p className="text-xs text-muted">
            slug: {plan.slug} · included/mo: {plan.monthly_tokens?.toLocaleString()} tokens
          </p>
        </div>
      ) : null}
      <p className="mt-8 text-xs text-muted">
        Change plan and packages via API for now; payment provider comes in a later phase.
      </p>
      <Link href="/" className="mt-6 inline-block text-sm text-ink underline">
        ← Dashboard
      </Link>
    </main>
  );
}
