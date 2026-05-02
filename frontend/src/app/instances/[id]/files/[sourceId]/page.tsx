"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SourceEmbeddingsPage } from "@/components/instances/SourceEmbeddingsPage";
import { meRequest, type MeUser } from "@/lib/api";
import { clearToken, getToken } from "@/lib/token";

export default function InstanceSourceChunksPage() {
  const router = useRouter();
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const sourceId = typeof params.sourceId === "string" ? params.sourceId : "";

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

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg3">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg3 px-6">
        <p className="text-sm text-muted">Sign in to continue.</p>
        <Link href="/login" className="text-sm text-accent underline">
          Sign in
        </Link>
      </main>
    );
  }

  if (!id || !sourceId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg3 px-6">
        <p className="text-sm text-muted">Invalid URL.</p>
        <Link href="/instances" className="text-sm text-accent underline">
          Instances
        </Link>
      </main>
    );
  }

  return <SourceEmbeddingsPage user={user} onLogout={logout} instanceId={id} sourceId={sourceId} />;
}
