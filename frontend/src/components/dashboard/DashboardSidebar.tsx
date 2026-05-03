"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const logoIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx="4" cy="8" r="2" fill="white" opacity="0.9" />
    <circle cx="12" cy="4" r="1.5" fill="white" opacity="0.6" />
    <circle cx="12" cy="12" r="1.5" fill="white" opacity="0.6" />
    <line x1="6" y1="8" x2="10.5" y2="4.5" stroke="white" strokeWidth="0.8" opacity="0.5" />
    <line x1="6" y1="8" x2="10.5" y2="11.5" stroke="white" strokeWidth="0.8" opacity="0.5" />
  </svg>
);

function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "?";
  if (local.length >= 2) return local.slice(0, 2).toUpperCase();
  return (local[0] ?? "?").toUpperCase();
}

function BadgeSoon() {
  return (
    <span className="ml-auto rounded-full bg-bg2 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-subtle">
      soon
    </span>
  );
}

type Props = {
  userEmail: string;
  planLabel: string;
  /** Shown next to Instances until API exists. */
  instanceCount?: number;
  agentCount?: number;
  /** Show link to /superadmin (superadmin users only). */
  isSuperadmin?: boolean;
  onLogout?: () => void;
};

export function DashboardSidebar({
  userEmail,
  planLabel,
  instanceCount = 0,
  agentCount = 0,
  isSuperadmin,
  onLogout,
}: Props) {
  const pathname = usePathname();
  const homeActive = pathname === "/";
  const billingActive = pathname === "/billing";
  const instancesActive = pathname === "/instances" || pathname.startsWith("/instances/");
  const agentsActive = pathname === "/agents" || pathname.startsWith("/agents/");
  const apiKeysActive = pathname === "/api-keys";
  const docsActive = pathname === "/docs/quickstart";

  return (
    <aside className="fixed left-0 top-0 z-20 flex h-screen w-[220px] shrink-0 flex-col border-r border-border bg-bg">
      <div className="flex items-center gap-2 border-b border-border px-5 pb-4 pt-5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink">{logoIcon}</div>
        <span className="text-sm font-medium text-ink">Mnemoniqa</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3 text-[13px]">
        <Link
          href="/"
          className={clsx(
            "flex items-center gap-2 rounded-md px-3 py-[7px] text-muted no-underline hover:bg-bg2 hover:text-ink",
            homeActive && "bg-bg2 font-medium text-ink",
          )}
        >
          Overview
        </Link>
        <Link
          href="/instances"
          className={clsx(
            "mt-1 flex items-center gap-2 rounded-md px-3 py-[7px] text-muted no-underline hover:bg-bg2 hover:text-ink",
            instancesActive && "bg-bg2 font-medium text-ink",
          )}
        >
          Instances
          <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent-bg px-1.5 text-[10px] font-semibold text-accent">
            {instanceCount}
          </span>
        </Link>
        <Link
          href="/agents"
          className={clsx(
            "mt-1 flex items-center gap-2 rounded-md px-3 py-[7px] text-muted no-underline hover:bg-bg2 hover:text-ink",
            agentsActive && "bg-bg2 font-medium text-ink",
          )}
        >
          Agents
          <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-bg2 px-1.5 text-[10px] font-semibold text-muted">
            {agentCount}
          </span>
        </Link>
        <div className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">Developer</div>
        <Link
          href="/api-keys"
          className={clsx(
            "flex items-center gap-2 rounded-md px-3 py-[7px] text-muted no-underline hover:bg-bg2 hover:text-ink",
            apiKeysActive && "bg-bg2 font-medium text-ink",
          )}
        >
          API keys
        </Link>
        <Link
          href="/docs/quickstart"
          className={clsx(
            "flex items-center gap-2 rounded-md px-3 py-[7px] text-muted no-underline hover:bg-bg2 hover:text-ink",
            docsActive && "bg-bg2 font-medium text-ink",
          )}
        >
          Docs
        </Link>
        <span className="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-[7px] text-muted opacity-80">
          Webhooks
        </span>
        <div className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">Account</div>
        <Link
          href="/billing"
          className={clsx(
            "flex items-center gap-2 rounded-md px-3 py-[7px] text-muted no-underline hover:bg-bg2 hover:text-ink",
            billingActive && "bg-bg2 font-medium text-ink",
          )}
        >
          Billing
        </Link>
        {isSuperadmin ? (
          <Link
            href="/superadmin"
            className={clsx(
              "flex items-center gap-2 rounded-md px-3 py-[7px] text-muted no-underline hover:bg-bg2 hover:text-ink",
              pathname === "/superadmin" && "bg-bg2 font-medium text-ink",
            )}
          >
            Superadmin
            <span className="ml-auto rounded bg-error-bg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-error">
              admin
            </span>
          </Link>
        ) : null}
        <span className="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-[7px] text-muted opacity-80">
          Settings
          <BadgeSoon />
        </span>
      </nav>
      <div className="border-t border-border px-4 pb-4 pt-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-bg text-[11px] font-medium text-accent">
            {initialsFromEmail(userEmail)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-ink">{(userEmail || "").split("@")[0] || "—"}</div>
            <div className="truncate text-[11px] text-subtle">{planLabel}</div>
          </div>
        </div>
        {onLogout ? (
          <button
            type="button"
            onClick={onLogout}
            className="mt-3 w-full text-left text-[11px] text-subtle hover:text-ink"
          >
            Sign out
          </button>
        ) : null}
      </div>
    </aside>
  );
}
