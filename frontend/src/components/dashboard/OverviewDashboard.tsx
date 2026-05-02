"use client";

import clsx from "clsx";
import { BookOpen, Check, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { billingMeRequest, listInstances, type BillingMeData, type MeUser } from "@/lib/api";
import { formatRub, formatStorageGb, formatTokens } from "@/lib/format";
import { getToken } from "@/lib/token";

function formatRenewalDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

function planUsageBarClass(pct: number): string {
  if (pct >= 90) return "bg-error";
  if (pct >= 70) return "bg-warn";
  return "bg-success";
}

/** Until storage API exists. */
const STORAGE_USED_MB_PLACEHOLDER = 0;

type Props = {
  user: MeUser;
  onLogout: () => void;
};

export function OverviewDashboard({ user, onLogout }: Props) {
  const token = getToken() ?? "";
  const [instanceCount, setInstanceCount] = useState(0);
  const [billing, setBilling] = useState<BillingMeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setErr(null);
    try {
      const b = await billingMeRequest(token);
      setBilling(b);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load usage");
    }
    try {
      const inst = await listInstances(token);
      setInstanceCount(inst.length);
    } catch {
      setInstanceCount(0);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const plan = billing?.plan;
  const sub = billing?.subscription;
  const buckets = useMemo(() => billing?.buckets ?? [], [billing]);
  const planBucket = useMemo(() => buckets.find((b) => b.bucket_type === "plan"), [buckets]);

  const monthly = plan?.monthly_tokens ?? 0;
  const usedPlan = planBucket?.tokens_used ?? 0;
  const pctPlanUsed = monthly > 0 ? Math.min(100, (usedPlan / monthly) * 100) : 0;
  const showTokenWarn = Boolean(plan && monthly > 0 && pctPlanUsed >= 70);

  const renewalLabel = sub?.current_period_end ? formatRenewalDate(sub.current_period_end) : "—";
  const planLabel = plan ? `${plan.name} plan` : "Free plan";

  const instancesCap = plan?.max_instances ?? 2;
  const instancesDisplayCap = instancesCap >= 100000 ? "∞" : instancesCap;
  const storageCapMb = plan?.max_storage_mb ?? 0;
  const storageCapLabel = storageCapMb > 0 ? formatStorageGb(storageCapMb) : "—";
  const storageUsedPct =
    storageCapMb > 0 ? Math.min(100, Math.round((STORAGE_USED_MB_PLACEHOLDER / storageCapMb) * 100)) : 0;

  const localPart = user.email.split("@")[0] ?? user.email;
  const isSuperadmin = user.role === "superadmin";

  return (
    <div className="min-h-screen bg-bg3 pl-[220px]">
      <DashboardSidebar
        userEmail={user.email}
        planLabel={planLabel}
        instanceCount={instanceCount}
        isSuperadmin={isSuperadmin}
        onLogout={onLogout}
      />

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-border bg-bg px-7">
          <span className="text-[15px] font-medium text-ink">Overview</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Documentation coming soon"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border2 bg-bg px-3 py-1.5 text-[12px] text-ink hover:bg-bg2"
            >
              <BookOpen className="h-3.5 w-3.5 text-muted" strokeWidth={1.75} aria-hidden />
              Docs
            </button>
            <Link
              href="/instances/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-bg hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              New instance
            </Link>
          </div>
        </header>

        <div className="max-w-6xl p-7 text-[13px]">
          <div className="mb-6">
            <h1 className="text-2xl font-medium tracking-tight text-ink sm:text-[26px]">Hello, {localPart}</h1>
            <p className="mt-1 text-sm text-subtle">Memory infrastructure for AI agents — your workspace at a glance.</p>
          </div>

          {err ? (
            <div className="mb-5 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-xs text-error">{err}</div>
          ) : null}

          {loading ? (
            <p className="text-sm text-muted">Loading usage…</p>
          ) : (
            <>
              {showTokenWarn ? (
                <div className="mb-5 flex gap-2.5 rounded-lg border border-warn-border bg-warn-bg px-4 py-3 text-xs leading-relaxed text-warn-text">
                  <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path d="M7 1.5L13 12.5H1L7 1.5z" stroke="#ba7517" strokeWidth="1" />
                    <line x1="7" y1="5.5" x2="7" y2="8.5" stroke="#ba7517" strokeWidth="1" />
                    <circle cx="7" cy="10.5" r="0.7" fill="#ba7517" />
                  </svg>
                  <div>
                    <strong>You have used {Math.round(pctPlanUsed)}% of this period&apos;s subscription tokens.</strong> When the
                    balance is exhausted, ingests and queries will pause.{" "}
                    <Link href="/billing" className="font-medium text-accent underline">
                      Open billing
                    </Link>{" "}
                    to buy packages or review your plan. Renewal: {renewalLabel}.
                  </div>
                </div>
              ) : null}

              <section className="mb-8">
                <h2 className="mb-3.5 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Summary</h2>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-border bg-bg p-4">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-subtle">Tokens available</div>
                    <div className="mt-1 text-2xl font-medium tracking-tight text-ink">
                      {billing != null ? formatTokens(billing.tokens_remaining) : "—"}
                    </div>
                    <div className="mt-2 h-0.5 overflow-hidden rounded-sm bg-bg2">
                      {monthly > 0 ? (
                        <div
                          className={clsx("h-full rounded-sm", planUsageBarClass(pctPlanUsed))}
                          style={{ width: `${pctPlanUsed}%` }}
                        />
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-subtle">
                        {monthly > 0 ? `${Math.round(pctPlanUsed)}% of monthly allocation used` : "0% of monthly allocation used"}
                      </span>
                      <span className="rounded-md bg-success-bg px-2 py-0.5 text-[10px] font-medium text-success-text">
                        {plan?.name ?? "Free"} plan
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-bg p-4">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-subtle">Current plan</div>
                    <div className="mt-1 text-2xl font-medium tracking-tight text-ink">{plan?.name ?? "—"}</div>
                    <div className="mt-1 text-[12px] text-subtle">
                      {plan ? (
                        <>
                          {formatRub(plan.price_monthly_rub)}/mo · renews {renewalLabel}
                        </>
                      ) : (
                        "Choose a plan in Billing"
                      )}
                    </div>
                    <Link
                      href="/billing"
                      className="mt-3 inline-flex text-[12px] font-medium text-accent hover:underline"
                    >
                      Upgrade plan →
                    </Link>
                  </div>

                  <div className="rounded-lg border border-border bg-bg p-4">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-subtle">Instances</div>
                    <div className="mt-1 text-2xl font-medium tracking-tight text-ink">
                      {instanceCount} / {instancesDisplayCap}
                    </div>
                    <p className="mt-1 text-[12px] text-subtle">
                      {instanceCount === 0 ? "No instances created yet" : `${instanceCount} active`}
                    </p>
                    <Link href="/instances/new" className="mt-3 inline-block text-[12px] font-medium text-accent hover:underline">
                      Create first →
                    </Link>
                  </div>

                  <div className="rounded-lg border border-border bg-bg p-4">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-subtle">Storage cap</div>
                    <div className="mt-1 text-2xl font-medium tracking-tight text-ink">{storageCapLabel}</div>
                    <p className="mt-1 text-[12px] text-subtle">
                      {STORAGE_USED_MB_PLACEHOLDER} MB used · {plan?.slug === "free" || !plan ? "free plan" : "your plan"}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="rounded-md bg-success-bg px-2 py-0.5 text-[10px] font-medium text-success-text">
                        {storageCapMb > 0 ? `${storageUsedPct}% used` : "0% used"}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              <section className="mb-8">
                <h2 className="mb-3.5 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Quick actions</h2>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/billing"
                    className="rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-bg hover:opacity-90"
                  >
                    Billing &amp; usage
                  </Link>
                  <span className="cursor-not-allowed rounded-full border border-border2 px-4 py-2 text-[12px] text-subtle">
                    API Keys
                  </span>
                  <Link
                    href="/instances/new"
                    className="rounded-full border border-border2 px-4 py-2 text-[12px] font-medium text-ink hover:bg-bg2"
                  >
                    New instance
                  </Link>
                  <span className="cursor-not-allowed rounded-full border border-border2 bg-bg2 px-4 py-2 text-[12px] text-subtle">
                    Docs (soon)
                  </span>
                  <Link
                    href="/instances"
                    className="rounded-full border border-border2 bg-bg2 px-4 py-2 text-[12px] text-ink hover:bg-bg"
                  >
                    Playground
                  </Link>
                </div>
              </section>

              <section className="mb-8">
                <h2 className="mb-3.5 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Get started</h2>
                <div className="rounded-lg border border-border bg-bg p-5 sm:p-6">
                  <ol className="space-y-5">
                    <li className="flex gap-3">
                      <div
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success text-bg"
                        aria-hidden
                      >
                        <Check className="h-4 w-4" strokeWidth={2.5} />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-ink">Create your account</div>
                        <p className="mt-0.5 text-[12px] text-muted">You&apos;re in. Your workspace is ready to go.</p>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border2 bg-bg2 text-[11px] font-medium text-ink">
                        2
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-ink">Confirm billing &amp; tokens</div>
                        <p className="mt-0.5 text-[12px] text-muted">
                          Review your plan and token balance. Free plan includes 100K tokens to start.
                        </p>
                        <Link href="/billing" className="mt-1.5 inline-block text-[12px] font-medium text-accent hover:underline">
                          Go to Billing →
                        </Link>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-ink ${
                          instanceCount > 0 ? "bg-success text-bg" : "border border-border2 bg-bg2"
                        }`}
                        aria-hidden
                      >
                        {instanceCount > 0 ? <Check className="h-4 w-4" strokeWidth={2.5} /> : "3"}
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-ink">Create a memory instance</div>
                        <p className="mt-0.5 text-[12px] text-muted">
                          Spin up RAG or other memory types for your product.
                        </p>
                        <Link href="/instances/new" className="mt-1.5 inline-block text-[12px] font-medium text-accent hover:underline">
                          Create instance →
                        </Link>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border2 bg-bg2 text-[11px] font-medium text-ink">
                        4
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-ink">Issue an API key</div>
                        <p className="mt-0.5 text-[12px] text-muted">Connect your backend or agents securely using a scoped API key.</p>
                        <span className="mt-1.5 inline-block cursor-not-allowed text-[12px] font-medium text-accent opacity-50">
                          Go to API Keys →
                        </span>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border2 bg-bg2 text-[11px] font-medium text-ink">
                        5
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-ink">Ingest &amp; query</div>
                        <p className="mt-0.5 text-[12px] text-muted">
                          Use an instance playground to add data and run queries with citations.
                        </p>
                      </div>
                    </li>
                  </ol>
                </div>
              </section>

              <div
                className={clsx(
                  "grid gap-6",
                  isSuperadmin ? "lg:grid-cols-12" : "lg:grid-cols-1",
                )}
              >
                <section className={clsx(isSuperadmin ? "lg:col-span-7" : "")}>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Recent activity</h2>
                    <button type="button" className="cursor-not-allowed text-[11px] text-subtle opacity-60" disabled>
                      View all
                    </button>
                  </div>
                  <div className="rounded-lg border border-border bg-bg px-5 py-12 text-center">
                    <p className="text-[12px] text-muted">
                      No activity yet. Ingest and query events will appear here in a future release.
                    </p>
                  </div>
                </section>

                {isSuperadmin ? (
                  <div className="flex flex-col gap-4 lg:col-span-5">
                    <section>
                      <h2 className="mb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Administration</h2>
                      <div className="space-y-4 rounded-lg border border-border bg-bg p-4">
                        <div className="flex flex-col gap-2 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-[13px] font-medium text-ink">Superadmin panel</div>
                            <p className="mt-0.5 text-[12px] text-muted">Manage catalog plans and pricing.</p>
                          </div>
                          <Link
                            href="/superadmin"
                            className="shrink-0 rounded-lg bg-ink px-4 py-2 text-center text-[12px] font-medium text-bg hover:opacity-90"
                          >
                            Superadmin
                          </Link>
                        </div>
                        <div className="flex flex-col gap-2 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-[13px] font-medium text-ink">Impersonate user</div>
                            <p className="mt-0.5 text-[12px] text-muted">View workspace as any user.</p>
                          </div>
                          <button
                            type="button"
                            disabled
                            className="shrink-0 cursor-not-allowed rounded-lg border border-border2 px-4 py-2 text-[12px] text-muted opacity-70"
                          >
                            Impersonate
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] text-muted">Worker health · ingest &amp; gardener</span>
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-success-text">
                            <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
                            All OK
                          </span>
                        </div>
                      </div>
                    </section>

                    <section>
                      <h2 className="mb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">System status</h2>
                      <div className="space-y-3 rounded-lg border border-border bg-bg p-4 text-[12px]">
                        <div className="flex justify-between gap-4 border-b border-border pb-3">
                          <span className="text-muted">LLM usage balance</span>
                          <span className="font-medium text-ink">—</span>
                        </div>
                        <div className="flex justify-between gap-4 border-b border-border pb-3">
                          <span className="text-muted">Queue depth</span>
                          <span className="font-medium text-ink">0</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted">Total registered users</span>
                          <span className="font-medium text-ink">—</span>
                        </div>
                      </div>
                    </section>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
