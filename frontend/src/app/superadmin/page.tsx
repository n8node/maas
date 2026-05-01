"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  adminCreatePlan,
  adminDeletePlan,
  adminListPlans,
  adminUpdatePlan,
  meRequest,
  type MeUser,
  type PlanDTO,
  type PlanUpsertPayload,
} from "@/lib/api";
import { formatRub } from "@/lib/format";
import { clearToken, getToken } from "@/lib/token";

function emptyPayload(): PlanUpsertPayload {
  return {
    name: "",
    slug: "",
    price_monthly_rub: 0,
    price_yearly_rub: 0,
    max_instances: 2,
    monthly_tokens: 100_000,
    max_storage_mb: 1024,
    allowed_memory_types: ["rag"],
    sort_order: 0,
    is_public: true,
    is_archived: false,
  };
}

function dtoToPayload(p: PlanDTO): PlanUpsertPayload {
  return {
    name: p.name,
    slug: p.slug,
    price_monthly_rub: p.price_monthly_rub,
    price_yearly_rub: p.price_yearly_rub,
    max_instances: p.max_instances,
    monthly_tokens: Number(p.monthly_tokens),
    max_storage_mb: Number(p.max_storage_mb),
    allowed_memory_types: p.allowed_memory_types?.length ? [...p.allowed_memory_types] : ["rag"],
    sort_order: p.sort_order,
    is_public: p.is_public,
    is_archived: p.is_archived,
  };
}

function parseMemoryTypes(s: string): string[] {
  const parts = s
    .split(/[,]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return parts.length ? parts : ["rag"];
}

export default function SuperadminPage() {
  const router = useRouter();
  const token = getToken() ?? "";

  const [user, setUser] = useState<MeUser | null>(null);
  const [plans, setPlans] = useState<PlanDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlanUpsertPayload>(() => emptyPayload());
  const [memoryTypesStr, setMemoryTypesStr] = useState("rag");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadPlans = useCallback(async () => {
    if (!token) return;
    setListErr(null);
    try {
      const list = await adminListPlans(token);
      setPlans(list);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : "Failed to load plans");
    }
  }, [token]);

  useEffect(() => {
    const t = getToken();
    if (!t) {
      setLoading(false);
      return;
    }
    meRequest(t)
      .then(setUser)
      .catch(() => {
        clearToken();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user || user.role !== "superadmin") return;
    loadPlans();
  }, [user, loadPlans]);

  useEffect(() => {
    if (!loading && !user && !getToken()) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  function openCreate() {
    setModalMode("create");
    setEditingId(null);
    setDraft(emptyPayload());
    setMemoryTypesStr("rag");
    setFormErr(null);
    setModalOpen(true);
  }

  function openEdit(p: PlanDTO) {
    setModalMode("edit");
    setEditingId(p.id);
    setDraft(dtoToPayload(p));
    setMemoryTypesStr((p.allowed_memory_types ?? ["rag"]).join(", "));
    setFormErr(null);
    setModalOpen(true);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const slug = draft.slug.trim().toLowerCase().replace(/\s+/g, "-");
    const name = draft.name.trim();
    if (!name || !slug) {
      setFormErr("Name and slug are required.");
      return;
    }
    const payload: PlanUpsertPayload = {
      ...draft,
      name,
      slug,
      allowed_memory_types: parseMemoryTypes(memoryTypesStr),
    };
    setSaving(true);
    setFormErr(null);
    try {
      if (modalMode === "create") {
        await adminCreatePlan(token, payload);
      } else if (editingId) {
        await adminUpdatePlan(token, editingId, payload);
      }
      setModalOpen(false);
      await loadPlans();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(p: PlanDTO) {
    if (!token) return;
    const ok = window.confirm(`Delete plan “${p.name}” (${p.slug})? This cannot be undone if no subscriptions reference it.`);
    if (!ok) return;
    setListErr(null);
    try {
      await adminDeletePlan(token, p.id);
      await loadPlans();
    } catch (e) {
      setListErr(e instanceof Error ? e.message : "Delete failed");
    }
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

  if (user.role !== "superadmin") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg3 px-6">
        <p className="text-center text-sm text-muted">Access denied. This area is for superadmin only.</p>
        <Link href="/" className="text-sm text-accent underline">
          Back to home
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg3 px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">Mnemoniqa</p>
            <h1 className="mt-1 text-[15px] font-medium text-ink">Superadmin — Plans</h1>
            <p className="mt-1 text-xs text-muted">Signed in as {user.email}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg bg-ink px-4 py-2 text-xs font-medium text-bg hover:opacity-90"
            >
              New plan
            </button>
            <Link
              href="/"
              className="rounded-lg border border-border2 bg-bg px-4 py-2 text-xs text-muted hover:bg-bg2"
            >
              Home
            </Link>
          </div>
        </div>

        {listErr ? (
          <div className="mb-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-xs text-error">{listErr}</div>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-border bg-bg">
          <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-border bg-bg2">
                <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wide text-subtle">Name</th>
                <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wide text-subtle">Slug</th>
                <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wide text-subtle">₽ / mo</th>
                <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wide text-subtle">Tokens / mo</th>
                <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wide text-subtle">Sort</th>
                <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wide text-subtle">Flags</th>
                <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wide text-subtle">Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-bg2">
                  <td className="px-4 py-3 font-medium text-ink">{p.name}</td>
                  <td className="px-4 py-3 text-muted">
                    <code className="rounded bg-bg2 px-1 text-xs">{p.slug}</code>
                  </td>
                  <td className="px-4 py-3 text-ink">{formatRub(p.price_monthly_rub)}</td>
                  <td className="px-4 py-3 text-muted">{Number(p.monthly_tokens).toLocaleString("en-US")}</td>
                  <td className="px-4 py-3 text-muted">{p.sort_order}</td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {p.is_public ? <span className="mr-1 rounded bg-accent-bg px-1.5 py-0.5 text-accent">public</span> : null}
                    {p.is_archived ? <span className="rounded bg-bg2 px-1.5 py-0.5">archived</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="rounded border border-border2 px-2.5 py-1 text-[11px] text-muted hover:bg-bg2"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDelete(p)}
                        className="rounded border border-error-border px-2.5 py-1 text-[11px] text-error hover:bg-error-bg"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {plans.length === 0 && !listErr ? (
            <p className="px-4 py-8 text-center text-xs text-muted">No plans yet. Create one.</p>
          ) : null}
        </div>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-bg p-6 shadow-xl">
            <h2 className="text-[15px] font-medium text-ink">{modalMode === "create" ? "New plan" : "Edit plan"}</h2>
            <form onSubmit={(e) => void submitForm(e)} className="mt-4 space-y-3">
              {formErr ? <p className="text-xs text-error">{formErr}</p> : null}
              <div>
                <label className="mb-1 block text-xs text-muted">Name</label>
                <input
                  required
                  className="h-[34px] w-full rounded-lg border border-border2 px-3 text-[13px] text-ink focus:border-muted focus:outline-none"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Slug</label>
                <input
                  required
                  className="h-[34px] w-full rounded-lg border border-border2 px-3 font-mono text-[13px] text-ink focus:border-muted focus:outline-none"
                  value={draft.slug}
                  onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted">Price monthly (₽)</label>
                  <input
                    type="number"
                    min={0}
                    className="h-[34px] w-full rounded-lg border border-border2 px-3 text-[13px] text-ink focus:border-muted focus:outline-none"
                    value={draft.price_monthly_rub}
                    onChange={(e) => setDraft((d) => ({ ...d, price_monthly_rub: Number(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">Price yearly (₽)</label>
                  <input
                    type="number"
                    min={0}
                    className="h-[34px] w-full rounded-lg border border-border2 px-3 text-[13px] text-ink focus:border-muted focus:outline-none"
                    value={draft.price_yearly_rub}
                    onChange={(e) => setDraft((d) => ({ ...d, price_yearly_rub: Number(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted">Monthly tokens</label>
                  <input
                    type="number"
                    min={0}
                    className="h-[34px] w-full rounded-lg border border-border2 px-3 text-[13px] text-ink focus:border-muted focus:outline-none"
                    value={draft.monthly_tokens}
                    onChange={(e) => setDraft((d) => ({ ...d, monthly_tokens: Number(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">Max instances</label>
                  <input
                    type="number"
                    min={0}
                    className="h-[34px] w-full rounded-lg border border-border2 px-3 text-[13px] text-ink focus:border-muted focus:outline-none"
                    value={draft.max_instances}
                    onChange={(e) => setDraft((d) => ({ ...d, max_instances: Number(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Max storage (MB)</label>
                <input
                  type="number"
                  min={0}
                  className="h-[34px] w-full rounded-lg border border-border2 px-3 text-[13px] text-ink focus:border-muted focus:outline-none"
                  value={draft.max_storage_mb}
                  onChange={(e) => setDraft((d) => ({ ...d, max_storage_mb: Number(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Allowed memory types (comma-separated)</label>
                <input
                  className="h-[34px] w-full rounded-lg border border-border2 px-3 font-mono text-[13px] text-ink focus:border-muted focus:outline-none"
                  value={memoryTypesStr}
                  onChange={(e) => setMemoryTypesStr(e.target.value)}
                  placeholder="rag, wiki"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Sort order</label>
                <input
                  type="number"
                  className="h-[34px] w-full rounded-lg border border-border2 px-3 text-[13px] text-ink focus:border-muted focus:outline-none"
                  value={draft.sort_order}
                  onChange={(e) => setDraft((d) => ({ ...d, sort_order: Number(e.target.value) || 0 }))}
                />
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={draft.is_public}
                    onChange={(e) => setDraft((d) => ({ ...d, is_public: e.target.checked }))}
                    className="rounded border-border2"
                  />
                  Public catalog
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={draft.is_archived}
                    onChange={(e) => setDraft((d) => ({ ...d, is_archived: e.target.checked }))}
                    className="rounded border-border2"
                  />
                  Archived
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-border2 px-4 py-2 text-xs text-muted hover:bg-bg2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-ink px-4 py-2 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-60"
                >
                  {saving ? "Saving…" : modalMode === "create" ? "Create" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
