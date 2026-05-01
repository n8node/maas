"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { OverviewDashboard } from "@/components/dashboard/OverviewDashboard";
import { meRequest, type MeUser } from "@/lib/api";
import { clearToken, getToken } from "@/lib/token";

export default function DashboardHome() {
  const router = useRouter();
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
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
  }, []);

  function logout() {
    clearToken();
    setUser(null);
    router.refresh();
  }

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg3 px-6">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }

  if (user) {
    return <OverviewDashboard user={user} onLogout={logout} />;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg3 px-6 py-12">
      <p className="text-sm text-muted">Mnemoniqa</p>
      <h1 className="text-center text-xl font-medium tracking-tight text-ink">
        Dashboard
      </h1>
      <p className="max-w-md text-center text-sm text-subtle">
        Memory infrastructure for AI agents. Sign in to open your workspace overview.
      </p>

      <div className="flex gap-4">
        <Link href="/login" className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-bg hover:opacity-90">
          Sign in
        </Link>
        <Link href="/register" className="rounded-md border border-border px-4 py-2 text-sm text-ink hover:bg-bg2">
          Register
        </Link>
      </div>
    </main>
  );
}
