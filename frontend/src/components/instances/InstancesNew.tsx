"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { InstancesShell } from "@/components/instances/InstancesShell";
import { createInstance, type MeUser } from "@/lib/api";
import { getToken } from "@/lib/token";

export function InstancesNew({ user, onLogout }: { user: MeUser; onLogout?: () => void }) {
  const router = useRouter();
  const token = getToken() ?? "";
  const [name, setName] = useState("");
  const [memoryType, setMemoryType] = useState<"rag" | "wiki">("rag");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const id = await createInstance(token, {
        name: name.trim(),
        memory_type: memoryType,
        config: {},
      });
      router.push(`/instances/${id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create instance");
    } finally {
      setSaving(false);
    }
  }

  return (
    <InstancesShell
      user={user}
      onLogout={onLogout}
      title="New instance"
      headerRight={
        <Link href="/instances" className="text-[12px] font-medium text-accent hover:underline">
          ← Back to list
        </Link>
      }
    >
      <div className="max-w-lg p-7 text-[13px]">
        <nav className="mb-6 text-[12px] text-muted">
          <Link href="/instances" className="text-accent hover:underline">
            Instances
          </Link>
          <span className="mx-2 text-border">/</span>
          <span className="text-ink">New</span>
        </nav>

        <h1 className="text-xl font-medium tracking-tight text-ink">Create memory instance</h1>
        <p className="mt-1 text-sm text-muted">
          Choose a memory type, name your instance, then ingest text from the playground (and files with embeddings for RAG).
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="inst-name" className="block text-[11px] font-medium uppercase tracking-wide text-subtle">
              Instance name
            </label>
            <input
              id="inst-name"
              type="text"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Product docs"
              className="mt-1.5 w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-ink outline-none ring-accent focus:border-accent focus:ring-1"
              required
              minLength={1}
              maxLength={128}
            />
          </div>

          <div>
            <span className="block text-[11px] font-medium uppercase tracking-wide text-subtle">Memory type</span>
            <div className="mt-2 flex flex-col gap-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-bg px-4 py-3 text-[13px] hover:bg-bg2">
                <input
                  type="radio"
                  name="mem-type"
                  checked={memoryType === "rag"}
                  onChange={() => setMemoryType("rag")}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-ink">RAG</span>
                  <span className="mt-0.5 block text-[12px] text-muted">
                    Chunks + optional file uploads with embeddings; hybrid vector / full-text query.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-bg px-4 py-3 text-[13px] hover:bg-bg2">
                <input
                  type="radio"
                  name="mem-type"
                  checked={memoryType === "wiki"}
                  onChange={() => setMemoryType("wiki")}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-ink">Wiki</span>
                  <span className="mt-0.5 block text-[12px] text-muted">
                    Sources and segments with full-text search (no vector uploads in this MVP).
                  </span>
                </span>
              </label>
            </div>
          </div>

          {err ? (
            <div className="rounded-lg border border-error-border bg-error-bg px-4 py-3 text-xs text-error">{err}</div>
          ) : null}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create instance"}
            </button>
            <Link
              href="/instances"
              className="rounded-lg border border-border px-4 py-2 text-[12px] font-medium text-ink hover:bg-bg2"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </InstancesShell>
  );
}
