"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { billingMeRequest, type BillingMeData, type MeUser } from "@/lib/api";
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

type Props = {
  user: MeUser;
  onLogout: () => void;
};

export function OverviewDashboard({ user, onLogout }: Props) {
  const token = getToken() ?? "";
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
  const planLabel = plan ? `${plan.name} plan` : "No plan";

  const instancesCap = plan?.max_instances;
  const storageCapLabel = plan ? formatStorageGb(plan.max_storage_mb) : "—";

  return (
    <div className="min-h-screen bg-bg3 pl-[220px]">
      <DashboardSidebar userEmail={user.email} planLabel={planLabel} isSuperadmin={user.role === "superadmin"} />

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-border bg-bg px-7">
          <span className="text-[15px] font-medium text-ink">Overview</span>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-lg border border-border2 px-3 py-1.5 text-[12px] text-muted hover:bg-bg2"
          >
            Sign out
          </button>
        </header>

        <div className="max-w-[900px] p-7 text-[13px]">
          <div className="mb-6">
            <h1 className="text-[15px] font-medium text-ink">
              Hello, {user.email.split("@")[0]}
            </h1>
            <p className="mt-1 text-xs text-subtle">Memory infrastructure for AI agents — your workspace at a glance.</p>
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

              <section className="mb-7">
                <h2 className="mb-3.5 text-[13px] font-medium text-ink">Summary</h2>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-border bg-bg p-4">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-subtle">Tokens available</div>
                    <div className="mt-1 text-xl font-medium tracking-tight text-ink">
                      {billing != null ? formatTokens(billing.tokens_remaining) : "—"}
                    </div>
                    <div className="mt-2 h-0.5 overflow-hidden rounded-sm bg-bg2">
                      {monthly > 0 ? (
                        <div
                          className={`h-full rounded-sm ${planUsageBarClass(pctPlanUsed)}`}
                          style={{ width: `${pctPlanUsed}%` }}
                        />
                      ) : null}
                    </div>
                    <div className="mt-1 text-[10px] text-subtle">
                      {monthly > 0 ? `${Math.round(pctPlanUsed)}% of monthly allocation used` : "—"}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-bg p-4">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-subtle">Current plan</div>
                    <div className="mt-1 text-xl font-medium tracking-tight text-ink">{plan?.name ?? "—"}</div>
                    <div className="mt-1 text-[11px] text-subtle">
                      {plan ? (
                        <>
                          {formatRub(plan.price_monthly_rub)}/mo · renews {renewalLabel}
                        </>
                      ) : (
                        "Subscribe to unlock higher limits"
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-bg p-4">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-subtle">Instances</div>
                    <div className="mt-1 text-xl font-medium tracking-tight text-ink">
                      {instancesCap != null && instancesCap < 100000 ? (
                        <>— / {instancesCap}</>
                      ) : (
                        <>— / ∞</>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-subtle">Usage tracking coming soon</div>
                  </div>

                  <div className="rounded-lg border border-border bg-bg p-4">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-subtle">Storage cap</div>
                    <div className="mt-1 text-xl font-medium tracking-tight text-ink">{storageCapLabel}</div>
                    <div className="mt-1 text-[11px] text-subtle">Usage tracking coming soon</div>
                  </div>
                </div>
              </section>

              <section className="mb-7">
                <h2 className="mb-3.5 text-[13px] font-medium text-ink">Quick actions</h2>
                <div className="flex flex-wrap gap-2.5">
                  <Link
                    href="/billing"
                    className="rounded-lg bg-ink px-4 py-2.5 text-[12px] font-medium text-bg hover:opacity-90"
                  >
                    Billing &amp; usage
                  </Link>
                  <span className="cursor-not-allowed rounded-lg border border-border2 px-4 py-2.5 text-[12px] text-subtle opacity-60">
                    API keys (soon)
                  </span>
                  <span className="cursor-not-allowed rounded-lg border border-border2 px-4 py-2.5 text-[12px] text-subtle opacity-60">
                    Docs (soon)
                  </span>
                </div>
              </section>

              <section className="mb-7">
                <h2 className="mb-3.5 text-[13px] font-medium text-ink">Get started</h2>
                <div className="rounded-lg border border-border bg-bg p-5">
                  <ol className="space-y-4">
                    {[
                      { n: 1, title: "Confirm billing & tokens", body: "Review your plan and token balance under Billing." },
                      { n: 2, title: "Create a memory instance", body: "Spin up RAG, Wiki, or other memory types for your product." },
                      { n: 3, title: "Issue an API key", body: "Connect your backend or agents securely." },
                      { n: 4, title: "Ingest & query", body: "Use the playground to ingest content and run queries with citations." },
                    ].map((step) => (
                      <li key={step.n} className="flex gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border2 bg-bg2 text-[11px] font-medium text-ink">
                          {step.n}
                        </div>
                        <div>
                          <div className="text-[13px] font-medium text-ink">{step.title}</div>
                          <div className="mt-0.5 text-[12px] text-muted">{step.body}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </section>

              <section className="mb-7">
                <h2 className="mb-3.5 text-[13px] font-medium text-ink">Recent activity</h2>
                <div className="rounded-lg border border-dashed border-border2 bg-bg px-5 py-10 text-center text-[12px] text-muted">
                  No activity yet. Ingest and query events will appear here in a future release.
                </div>
              </section>

              {user.role === "superadmin" ? (
                <section>
                  <h2 className="mb-3.5 text-[13px] font-medium text-ink">Administration</h2>
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg p-4">
                    <p className="text-[12px] text-muted">Manage catalog plans and pricing.</p>
                    <Link
                      href="/superadmin"
                      className="rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-bg hover:opacity-90"
                    >
                      Superadmin
                    </Link>
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
