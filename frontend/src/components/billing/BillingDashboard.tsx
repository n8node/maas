"use client";

import clsx from "clsx";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import {
  billingMeRequest,
  cancelSubscription,
  listPlans,
  listTokenPackages,
  subscribePlan,
  type BillingMeData,
  type MeUser,
  type PlanDTO,
  type TokenPackageDTO,
} from "@/lib/api";
import {
  formatKopecksAsRub,
  formatRub,
  formatStorageGb,
  formatTokens,
  pricePer1kTokens,
} from "@/lib/format";
import { getToken } from "@/lib/token";

type TabId = "overview" | "plans" | "history" | "usage";

const WARN_STROKE = "#ba7517";

function formatRenewalDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

function paymentTypeLabel(t: string): string {
  switch (t) {
    case "subscription":
      return "Subscription";
    case "package":
      return "Package";
    case "top_up":
      return "Top-up";
    default:
      return t;
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "completed":
    case "succeeded":
      return "bg-success-bg text-success-text";
    case "pending":
      return "bg-warn-bg text-warn";
    case "failed":
      return "bg-error-bg text-error";
    case "refunded":
      return "bg-[#eeedfe] text-[#534ab7]";
    default:
      return "bg-bg2 text-muted";
  }
}

function planBarClass(pct: number): string {
  if (pct >= 90) return "bg-error";
  if (pct >= 70) return "bg-warn";
  return "bg-success";
}

export function BillingDashboard({ user, onLogout }: { user: MeUser; onLogout?: () => void }) {
  const token = getToken() ?? "";

  const [tab, setTab] = useState<TabId>("overview");
  const [billing, setBilling] = useState<BillingMeData | null>(null);
  const [plans, setPlans] = useState<PlanDTO[]>([]);
  const [packages, setPackages] = useState<TokenPackageDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [subscribeSlug, setSubscribeSlug] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const [buyOpen, setBuyOpen] = useState(false);
  const [buyPkg, setBuyPkg] = useState<TokenPackageDTO | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelAtEnd, setCancelAtEnd] = useState(true);

  const [promo, setPromo] = useState("");
  const [promoOk, setPromoOk] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setErr(null);
    try {
      const [b, p, pk] = await Promise.all([
        billingMeRequest(token),
        listPlans(),
        listTokenPackages(),
      ]);
      setBilling(b);
      setPlans(p.sort((a, b) => a.sort_order - b.sort_order));
      setPackages(pk.sort((a, b) => a.sort_order - b.sort_order));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load billing");
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
  const purchaseBuckets = useMemo(() => buckets.filter((b) => b.bucket_type === "purchase"), [buckets]);

  const monthly = plan?.monthly_tokens ?? 0;
  const usedPlan = planBucket?.tokens_used ?? 0;
  const remPlan = planBucket?.tokens_remaining ?? 0;
  const remPurch = useMemo(
    () => purchaseBuckets.reduce((s, b) => s + b.tokens_remaining, 0),
    [purchaseBuckets],
  );
  const pctPlanUsed = monthly > 0 ? Math.min(100, (usedPlan / monthly) * 100) : 0;

  const showTokenWarn = plan && monthly > 0 && pctPlanUsed >= 70;

  const T = usedPlan + remPlan + remPurch;
  const wUsed = T > 0 ? (usedPlan / T) * 100 : 0;
  const wPlan = T > 0 ? (remPlan / T) * 100 : 0;
  const wPurch = T > 0 ? (remPurch / T) * 100 : 0;

  const renewalLabel = sub?.current_period_end ? formatRenewalDate(sub.current_period_end) : "—";
  const priceMonth = plan?.price_monthly_rub ?? 0;

  const planLabel = plan ? `${plan.name} plan` : "No plan";

  async function onSubscribe(slug: string) {
    if (!token) return;
    setActionErr(null);
    setSubscribeSlug(slug);
    try {
      await subscribePlan(token, slug);
      await load();
      setTab("overview");
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : "Subscribe failed");
    } finally {
      setSubscribeSlug(null);
    }
  }

  async function onCancelConfirm() {
    if (!token) return;
    setCancelLoading(true);
    setActionErr(null);
    try {
      await cancelSubscription(token, cancelAtEnd);
      await load();
      setCancelOpen(false);
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setCancelLoading(false);
    }
  }

  const cheapest = packages[0];
  const pkgSavingPct = (pkg: TokenPackageDTO) => {
    if (!cheapest || cheapest.tokens <= 0 || pkg.tokens <= 0) return null;
    const base = cheapest.price_rub / cheapest.tokens;
    const cur = pkg.price_rub / pkg.tokens;
    if (base <= 0 || cur >= base) return null;
    return Math.round((1 - cur / base) * 100);
  };

  const recommendedPlan = useMemo(() => {
    const paid = plans.filter((p) => p.price_monthly_rub > 0);
    if (paid.length === 0) return null;
    return paid.reduce((a, b) => (a.monthly_tokens > b.monthly_tokens ? a : b));
  }, [plans]);

  if (loading) {
    return (
      <div className="flex min-h-screen bg-bg3 pl-[220px]">
        <DashboardSidebar
          userEmail={user.email}
          planLabel={planLabel}
          instanceCount={0}
          isSuperadmin={user.role === "superadmin"}
          onLogout={onLogout}
        />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted">Loading billing…</p>
        </div>
      </div>
    );
  }

  if (err || !billing) {
    return (
      <div className="flex min-h-screen bg-bg3 pl-[220px]">
        <DashboardSidebar
          userEmail={user.email}
          planLabel={planLabel}
          instanceCount={0}
          isSuperadmin={user.role === "superadmin"}
          onLogout={onLogout}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8">
          <p className="text-sm text-error">{err ?? "No data"}</p>
          <Link href="/login" className="text-sm text-accent underline">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg3 pl-[220px]">
      <DashboardSidebar
          userEmail={user.email}
          planLabel={planLabel}
          instanceCount={0}
          isSuperadmin={user.role === "superadmin"}
          onLogout={onLogout}
        />

      <div className="ml-0 flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-border bg-bg px-7">
          <div className="flex items-center gap-0">
            <span className="mr-4 text-[15px] font-medium text-ink">Billing</span>
            <nav className="flex">
              {(
                [
                  ["overview", "Overview"],
                  ["plans", "Plans"],
                  ["history", "Payment history"],
                  ["usage", "Usage"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={clsx(
                    "flex h-[52px] items-center border-b-2 border-transparent px-3.5 text-[13px] text-muted hover:text-ink",
                    tab === id && "border-ink font-medium text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>
        </header>

        <div className="max-w-[900px] p-7 text-[13px]">
          {actionErr ? (
            <div className="mb-5 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-xs text-error">{actionErr}</div>
          ) : null}

          {tab === "overview" && (
            <>
              {showTokenWarn ? (
                <div className="mb-5 flex gap-2.5 rounded-lg border border-warn-border bg-warn-bg px-4 py-3 text-xs leading-relaxed text-warn-text">
                  <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path d="M7 1.5L13 12.5H1L7 1.5z" stroke={WARN_STROKE} strokeWidth="1" />
                    <line x1="7" y1="5.5" x2="7" y2="8.5" stroke={WARN_STROKE} strokeWidth="1" />
                    <circle cx="7" cy="10.5" r="0.7" fill={WARN_STROKE} />
                  </svg>
                  <div>
                    <strong>You have used {Math.round(pctPlanUsed)}% of this period&apos;s subscription tokens.</strong> When the
                    balance is exhausted, ingests and queries will be paused. Buy additional token packages or wait until renewal on{" "}
                    {renewalLabel}.
                  </div>
                </div>
              ) : null}

              <section className="mb-7">
                <h2 className="mb-3.5 text-[13px] font-medium text-ink">Current plan</h2>
                <div className="grid grid-cols-1 items-start gap-5 rounded-lg border border-border bg-bg p-5 md:grid-cols-[1fr_auto] lg:p-6">
                  <div>
                    <div className="mb-1 flex flex-wrap items-center gap-2.5">
                      <span className="text-lg font-medium tracking-tight text-ink">{plan?.name ?? "—"}</span>
                      {sub?.status === "active" ? (
                        <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-medium text-bg">Active</span>
                      ) : null}
                      {sub?.cancel_at_period_end ? (
                        <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[10px] font-medium text-warn-text">
                          Cancels at period end
                        </span>
                      ) : null}
                    </div>
                    <p className="mb-4 text-[11px] text-subtle">
                      Renewal on {renewalLabel}
                      {plan ? ` · ${formatRub(priceMonth)}/month` : null}
                    </p>
                    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                      <div>
                        <div className="mb-0.5 text-[10px] uppercase tracking-wide text-subtle">Tokens / month</div>
                        <div className="text-[13px] font-medium text-ink">
                          {monthly > 0 ? (
                            <>
                              {formatTokens(usedPlan)} / {formatTokens(monthly)}
                            </>
                          ) : (
                            "—"
                          )}
                        </div>
                        <div className="mt-1 h-0.5 overflow-hidden rounded-sm bg-bg2">
                          {monthly > 0 ? (
                            <div className={clsx("h-full rounded-sm", planBarClass(pctPlanUsed))} style={{ width: `${pctPlanUsed}%` }} />
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-[10px] text-subtle">
                          {monthly > 0 ? `${Math.round(pctPlanUsed)}% used` : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="mb-0.5 text-[10px] uppercase tracking-wide text-subtle">Instances</div>
                        <div className="text-[13px] font-medium text-ink">
                          {plan ? (
                            <>
                              — / {plan.max_instances >= 100000 ? "∞" : plan.max_instances}
                            </>
                          ) : (
                            "—"
                          )}
                        </div>
                        <div className="mt-1 h-0.5 overflow-hidden rounded-sm bg-bg2" />
                        <div className="mt-0.5 text-[10px] text-subtle">Usage tracking soon</div>
                      </div>
                      <div>
                        <div className="mb-0.5 text-[10px] uppercase tracking-wide text-subtle">Storage</div>
                        <div className="text-[13px] font-medium text-ink">
                          {plan ? (
                            <>
                              — / {formatStorageGb(plan.max_storage_mb)}
                            </>
                          ) : (
                            "—"
                          )}
                        </div>
                        <div className="mt-1 h-0.5 overflow-hidden rounded-sm bg-bg2" />
                        <div className="mt-0.5 text-[10px] text-subtle">Usage tracking soon</div>
                      </div>
                      <div>
                        <div className="mb-0.5 text-[10px] uppercase tracking-wide text-subtle">API requests / day</div>
                        <div className="text-[13px] font-medium text-ink">{plan && plan.price_monthly_rub > 0 ? "∞" : "—"}</div>
                        <div className="mt-1 h-0.5 overflow-hidden rounded-sm bg-bg2" />
                        <div className="mt-0.5 text-[10px] text-subtle">
                          {plan && plan.price_monthly_rub > 0 ? "Included on paid plans" : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-stretch gap-2 md:items-end">
                    <button
                      type="button"
                      onClick={() => setTab("plans")}
                      className="rounded-lg bg-ink px-4 py-[7px] text-xs font-medium text-bg hover:opacity-90"
                    >
                      Upgrade plan
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-border2 bg-transparent px-4 py-[7px] text-xs text-muted hover:bg-bg2"
                    >
                      Download invoice
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancelOpen(true)}
                      className="rounded-lg border border-error-border bg-transparent px-4 py-[7px] text-xs text-error hover:bg-bg2"
                    >
                      Cancel subscription
                    </button>
                  </div>
                </div>
              </section>

              <section className="mb-7">
                <h2 className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2 text-[13px] font-medium text-ink">
                  Token balance
                  <span className="text-[11px] font-normal text-subtle">FIFO: subscription first → packages</span>
                </h2>
                <div className="rounded-lg border border-border bg-bg px-5 py-4 lg:px-6">
                  <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex flex-wrap gap-6 lg:gap-8">
                      <div>
                        <div className="mb-0.5 text-[10px] uppercase tracking-wide text-subtle">Subscription tokens</div>
                        <div className="text-[22px] font-medium tracking-tight text-ink">{formatTokens(remPlan)}</div>
                        <div className="mt-0.5 text-[11px] text-subtle">
                          remaining of {monthly > 0 ? formatTokens(monthly) : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="mb-0.5 text-[10px] uppercase tracking-wide text-subtle">Purchased packages</div>
                        <div className="text-[22px] font-medium tracking-tight text-ink">{formatTokens(remPurch)}</div>
                        <div className="mt-0.5 text-[11px] text-subtle">
                          {purchaseBuckets.length} package{purchaseBuckets.length === 1 ? "" : "s"}
                        </div>
                      </div>
                      <div>
                        <div className="mb-0.5 text-[10px] uppercase tracking-wide text-subtle">Total available</div>
                        <div className="text-[22px] font-medium tracking-tight text-ink">{formatTokens(billing.tokens_remaining)}</div>
                        <div className="mt-0.5 text-[11px] text-subtle">until {renewalLabel}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setBuyPkg(packages[0] ?? null);
                        setBuyOpen(true);
                      }}
                      className="shrink-0 rounded-lg bg-ink px-4 py-[7px] text-xs font-medium text-bg hover:opacity-90"
                    >
                      Buy tokens
                    </button>
                  </div>

                  <div className="mb-2.5 flex h-2 gap-px overflow-hidden rounded bg-bg2">
                    {T > 0 ? (
                      <>
                        <div
                          className="h-full rounded-sm bg-ink/15"
                          style={{ width: `${wUsed}%`, minWidth: wUsed > 0 ? 2 : 0 }}
                        />
                        <div
                          className="h-full rounded-sm bg-accent"
                          style={{ width: `${wPlan}%`, minWidth: wPlan > 0 ? 2 : 0 }}
                        />
                        <div
                          className="h-full rounded-sm border border-[#b5d4a0] bg-success-bg"
                          style={{ width: `${wPurch}%`, minWidth: wPurch > 0 ? 2 : 0 }}
                        />
                      </>
                    ) : (
                      <div className="h-full w-full rounded-sm bg-bg2" />
                    )}
                  </div>
                  <div className="mb-2 flex flex-wrap gap-4 text-[11px] text-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-ink/40" />
                      Used ({formatTokens(usedPlan)})
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-accent" />
                      Plan remaining ({formatTokens(remPlan)})
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-success" />
                      Purchased packages ({formatTokens(remPurch)})
                    </span>
                  </div>
                  <p className="mt-2 border-t border-border pt-2 text-[11px] leading-relaxed text-subtle">
                    <strong className="text-muted">FIFO order:</strong> Subscription tokens are used first, then purchased packages
                    (oldest first). Package tokens don&apos;t expire until fully used.
                  </p>
                </div>
              </section>

              <section className="mb-7">
                <h2 className="mb-3.5 text-[13px] font-medium text-ink">Token packages</h2>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  {packages.map((pkg, idx) => {
                    const popular = packages.length >= 2 && idx === 1;
                    const save = pkgSavingPct(pkg);
                    return (
                      <div
                        key={pkg.id}
                        className={clsx(
                          "relative cursor-pointer rounded-lg border bg-bg p-4 transition-colors hover:border-border2 hover:shadow-sm",
                          popular ? "border-featured" : "border-border",
                        )}
                      >
                        {popular ? (
                          <div className="absolute -top-px left-1/2 -translate-x-1/2 rounded-b-md bg-accent px-2.5 py-0.5 text-[9px] font-medium text-bg">
                            Most popular
                          </div>
                        ) : null}
                        <div className="mb-0.5 text-lg font-medium tracking-tight text-ink">{formatTokens(pkg.tokens)}</div>
                        <div className="mb-3 text-[10px] text-subtle">tokens</div>
                        <div className="mb-0.5 text-[22px] font-medium tracking-tight text-ink">{formatRub(pkg.price_rub)}</div>
                        <div className="mb-3 text-[10px] text-subtle">{pricePer1kTokens(pkg.price_rub, pkg.tokens)}</div>
                        <div className={clsx("mb-2.5 text-[10px] font-medium text-success-text", !save && "invisible")}>
                          {save != null ? `Save ${save}%` : "—"}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setBuyPkg(pkg);
                            setBuyOpen(true);
                          }}
                          className={clsx(
                            "w-full rounded-lg border py-[7px] text-xs transition-colors",
                            popular
                              ? "border-ink bg-ink text-bg hover:opacity-90"
                              : "border-border2 text-muted hover:border-ink hover:bg-ink hover:text-bg",
                          )}
                        >
                          Buy
                        </button>
                      </div>
                    );
                  })}
                </div>
                {packages.length === 0 ? (
                  <p className="mt-3 text-[11px] text-subtle">No token packages are available yet.</p>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <input
                    className="h-[34px] flex-1 rounded-lg border border-border2 bg-bg px-3 text-[13px] text-ink placeholder:text-subtle focus:border-muted focus:outline-none"
                    placeholder="Promo code"
                    value={promo}
                    onChange={(e) => {
                      setPromo(e.target.value);
                      setPromoOk(false);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (promo.trim()) setPromoOk(true);
                    }}
                    className="h-[34px] shrink-0 rounded-lg bg-ink px-4 text-xs font-medium text-bg hover:opacity-90"
                  >
                    Apply
                  </button>
                </div>
                {promoOk ? (
                  <p className="mt-1.5 text-[11px] text-success-text">Promo code applied — discount will apply at checkout (coming soon).</p>
                ) : null}
              </section>
            </>
          )}

          {tab === "plans" && (
            <section>
              <h2 className="mb-3.5 flex flex-wrap items-baseline gap-2 text-[13px] font-medium text-ink">
                Available plans
                <span className="text-[11px] font-normal text-subtle">Billed monthly. Cancel anytime.</span>
              </h2>
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
                {plans.map((p) => {
                  const current = plan?.slug === p.slug;
                  const rec = recommendedPlan?.slug === p.slug;
                  return (
                    <div
                      key={p.id}
                      className={clsx(
                        "relative rounded-lg border bg-bg p-4 transition-colors hover:border-border2",
                        current && "border-ink",
                        rec && !current && "border-accent",
                      )}
                    >
                      {current ? (
                        <div className="absolute -top-px right-4 rounded-b-md bg-ink px-2 py-0.5 text-[9px] font-medium text-bg">
                          Current
                        </div>
                      ) : null}
                      {rec && !current ? (
                        <div className="absolute -top-px right-4 rounded-b-md bg-accent px-2 py-0.5 text-[9px] font-medium text-bg">
                          Recommended
                        </div>
                      ) : null}
                      <div className="mb-1 text-sm font-medium text-ink">{p.name}</div>
                      <div className="mb-0.5 text-[22px] font-medium tracking-tight text-ink">{formatRub(p.price_monthly_rub)}</div>
                      <div className="mb-3.5 text-[11px] text-subtle">per month</div>
                      <div className="space-y-1 border-b border-border py-1 text-xs text-muted last:border-0">
                        <div className="flex items-center gap-1.5 border-b border-border py-1">
                          <span className="text-success-text">✓</span>
                          {formatTokens(p.monthly_tokens)} tokens / month
                        </div>
                        <div className="flex items-center gap-1.5 border-b border-border py-1">
                          <span className="text-success-text">✓</span>
                          {p.max_instances >= 100000 ? "Unlimited" : p.max_instances} instances
                        </div>
                        <div className="flex items-center gap-1.5 border-b border-border py-1">
                          <span className="text-success-text">✓</span>
                          {formatStorageGb(p.max_storage_mb)} storage
                        </div>
                        <div className="flex items-center gap-1.5 border-b border-border py-1">
                          <span className={p.gardener_enabled ? "text-success-text" : "text-subtle"}>
                            {p.gardener_enabled ? "✓" : "✗"}
                          </span>
                          Agents
                        </div>
                        <div className="flex items-center gap-1.5 py-1">
                          <span className={p.reflective_enabled ? "text-success-text" : "text-subtle"}>
                            {p.reflective_enabled ? "✓" : "✗"}
                          </span>
                          Reflective / advanced types
                        </div>
                      </div>
                      {current ? (
                        <button
                          type="button"
                          disabled
                          className="mt-3.5 w-full rounded-lg border border-border2 py-[7px] text-xs text-muted"
                        >
                          Current plan
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={subscribeSlug !== null}
                          onClick={() => onSubscribe(p.slug)}
                          className="mt-3.5 w-full rounded-lg bg-ink py-[7px] text-xs font-medium text-bg hover:opacity-90 disabled:opacity-60"
                        >
                          {subscribeSlug === p.slug ? "Switching…" : p.price_monthly_rub > (plan?.price_monthly_rub ?? -1) ? "Upgrade" : "Switch plan"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] text-subtle">
                Enterprise? <span className="text-muted">Contact us</span> for custom pricing.
              </p>
            </section>
          )}

          {tab === "history" && (
            <section>
              <h2 className="mb-3.5 flex items-center justify-between text-[13px] font-medium text-ink">
                Payment history
                <button
                  type="button"
                  className="rounded-lg border border-border2 px-3 py-1 text-[11px] text-muted hover:bg-bg2"
                >
                  Export CSV
                </button>
              </h2>
              <div className="overflow-hidden rounded-lg border border-border bg-bg">
                <div
                  className="grid gap-2 border-b border-border bg-bg2 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-subtle"
                  style={{ gridTemplateColumns: "100px 1fr 100px 90px 90px 70px" }}
                >
                  <div>Date</div>
                  <div>Description</div>
                  <div>Type</div>
                  <div>Amount</div>
                  <div>Status</div>
                  <div>Invoice</div>
                </div>
                {billing.payments.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-muted">No payments yet.</div>
                ) : (
                  billing.payments.map((pay) => (
                    <div
                      key={pay.id}
                      className="grid gap-2 border-b border-border px-4 py-2.5 text-xs last:border-0 hover:bg-bg2"
                      style={{ gridTemplateColumns: "100px 1fr 100px 90px 90px 70px" }}
                    >
                      <div className="text-muted">{new Date(pay.created_at).toLocaleDateString("en-GB")}</div>
                      <div className="min-w-0 truncate text-ink">{pay.notes ?? paymentTypeLabel(pay.type)}</div>
                      <div>
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-accent-bg text-accent">
                          {paymentTypeLabel(pay.type)}
                        </span>
                      </div>
                      <div className="font-medium text-ink">{formatKopecksAsRub(pay.amount_kopecks)}</div>
                      <div>
                        <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", statusBadgeClass(pay.status))}>
                          {pay.status}
                        </span>
                      </div>
                      <div className="text-subtle">—</div>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {tab === "usage" && (
            <section>
              <h2 className="mb-3.5 text-[13px] font-medium text-ink">Token usage</h2>
              <div className="rounded-lg border border-border bg-bg p-6 text-sm text-muted">
                Usage breakdown (by memory type, model, and operation) will appear here in a later release.
              </div>
            </section>
          )}
        </div>
      </div>

      {buyOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal>
          <div className="relative w-full max-w-[420px] rounded-lg bg-bg p-6 shadow-xl">
            <button
              type="button"
              className="absolute right-4 top-4 text-xl leading-none text-subtle hover:text-ink"
              onClick={() => setBuyOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
            <h3 className="text-[15px] font-medium text-ink">
              Buy {buyPkg ? `${formatTokens(buyPkg.tokens)} token package` : "tokens"}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Tokens are added to your balance after payment is confirmed. FIFO: subscription tokens are used first.
            </p>
            {buyPkg ? (
              <div className="mt-4 rounded-lg bg-bg2 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
                <strong className="text-ink">{formatRub(buyPkg.price_rub)}</strong> — manual payment for now. After confirmation,
                tokens will be credited within 24 hours.
              </div>
            ) : null}
            <div className="mt-4">
              <label className="mb-1 block text-xs text-muted">Email for payment details</label>
              <input readOnly className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-3 text-[13px]" value={user.email} />
            </div>
            <p className="mt-3 text-[11px] text-subtle">Bank transfer or card — our team will contact you.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBuyOpen(false)}
                className="rounded-lg border border-border2 px-4 py-2 text-xs text-muted hover:bg-bg2"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setBuyOpen(false)}
                className="rounded-lg bg-ink px-4 py-2 text-xs font-medium text-bg hover:opacity-90"
              >
                Request invoice
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cancelOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal>
          <div className="relative w-full max-w-[420px] rounded-lg bg-bg p-6 shadow-xl">
            <h3 className="text-[15px] font-medium text-ink">Cancel subscription</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {cancelAtEnd
                ? "Your subscription will remain active until the end of the current billing period."
                : "Your subscription will be cancelled immediately."}
            </p>
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={cancelAtEnd} onChange={(e) => setCancelAtEnd(e.target.checked)} className="rounded border-border2" />
              Cancel at period end
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                className="rounded-lg border border-border2 px-4 py-2 text-xs text-muted hover:bg-bg2"
              >
                Back
              </button>
              <button
                type="button"
                disabled={cancelLoading}
                onClick={() => void onCancelConfirm()}
                className="rounded-lg bg-ink px-4 py-2 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-60"
              >
                {cancelLoading ? "Working…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
