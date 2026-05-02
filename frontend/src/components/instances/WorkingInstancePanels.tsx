"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import {
  billingMeRequest,
  deleteWorkingKey,
  flushWorkingExpired,
  getWorkingStats,
  listWorkingKeys,
  listWorkingSessions,
  patchInstance,
  putWorkingKey,
  type BillingMeData,
  type MemoryInstanceDTO,
  type WorkingKeyRowDTO,
  type WorkingSessionRowDTO,
  type WorkingStatsDTO,
} from "@/lib/api";
import { formatFileSize } from "@/lib/format";
import { getToken } from "@/lib/token";

type WorkingTab = "sessions" | "keys" | "settings";

const wCol = "#854f0b";
const wBg = "#faeeda";

const MEMORY_PILLS = [
  { id: "rag", label: "RAG", href: "/instances/new?type=rag", col: "#185fa5", bg: "#e6f1fb", soon: false },
  { id: "wiki", label: "Wiki", href: "/instances/new?type=wiki", col: "#534ab7", bg: "#eeedfe", soon: false },
  { id: "episodic", label: "Episodic", href: "/instances/new?type=episodic", col: "#3b6d11", bg: "#eaf3de", soon: false },
  { id: "working", label: "Working", href: "#", col: wCol, bg: wBg, soon: false },
  { id: "graph", label: "Graph", href: "#", col: "#993c1d", bg: "#faece7", soon: true },
  { id: "reflective", label: "Reflective", href: "#", col: "#993556", bg: "#fbeaf0", soon: true },
  { id: "agent", label: "Agent (unified)", href: "#", col: "#1a1a1a", bg: "#f3f2ef", soon: true },
] as const;

function formatCompactCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  return n.toLocaleString("en-US");
}

function formatRelativeShort(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const d = Date.now() - t;
  const sec = Math.floor(d / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const day = Math.floor(h / 24);
  return `${day}d ago`;
}

function formatValuePreview(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function useTtlTick(expiresAt: string | null | undefined, isCore: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (isCore || !expiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [expiresAt, isCore]);
  if (isCore) return "∞ persistent";
  if (!expiresAt) return "—";
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return "—";
  const left = t - now;
  if (left <= 0) return "expired";
  const s = Math.floor(left / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec.toString().padStart(2, "0")}s`;
}

function KeyRowTtl({
  expiresAt,
  isCore,
}: {
  expiresAt: string | null | undefined;
  isCore: boolean;
}) {
  const label = useTtlTick(expiresAt ?? null, isCore);
  return (
    <span className={clsx("shrink-0 whitespace-nowrap tabular-nums text-[12px]", isCore ? "text-[#534ab7]" : "text-muted")}>
      {label}
    </span>
  );
}

export function WorkingInstancePanels({
  instanceId,
  inst,
  onRefreshInstance,
  onDeleteInstance,
}: {
  instanceId: string;
  inst: MemoryInstanceDTO;
  onRefreshInstance: () => void;
  onDeleteInstance: () => void | Promise<void>;
}) {
  const token = getToken() ?? "";
  const [tab, setTab] = useState<WorkingTab>("sessions");
  const [stats, setStats] = useState<WorkingStatsDTO | null>(null);
  const [billing, setBilling] = useState<BillingMeData | null>(null);
  const [sessions, setSessions] = useState<WorkingSessionRowDTO[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionQDraft, setSessionQDraft] = useState("");
  const [sessionQ, setSessionQ] = useState("");
  const [sessionFilter, setSessionFilter] = useState<"active" | "all">("active");

  const [keysSession, setKeysSession] = useState("");
  const [keysFilter, setKeysFilter] = useState("");
  const [keys, setKeys] = useState<WorkingKeyRowDTO[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);

  const [setKeyOpen, setSetKeyOpen] = useState(false);
  const [skName, setSkName] = useState("");
  const [skValue, setSkValue] = useState("{}");
  const [skTtlMin, setSkTtlMin] = useState("");
  const [skUser, setSkUser] = useState("");
  const [skBusy, setSkBusy] = useState(false);
  const [skErr, setSkErr] = useState<string | null>(null);

  const [settingsBusy, setSettingsBusy] = useState(false);
  const [flushBusy, setFlushBusy] = useState(false);

  const loadStats = useCallback(async () => {
    if (!token) return;
    try {
      setStats(await getWorkingStats(token, instanceId));
    } catch {
      setStats(null);
    }
  }, [token, instanceId]);

  const loadSessions = useCallback(async () => {
    if (!token) return;
    setSessionsLoading(true);
    try {
      setSessions(
        await listWorkingSessions(token, instanceId, {
          q: sessionQ.trim() || undefined,
          filter: sessionFilter,
        }),
      );
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [token, instanceId, sessionQ, sessionFilter]);

  const loadAllSessionsForSelect = useCallback(async () => {
    if (!token) return [];
    try {
      return await listWorkingSessions(token, instanceId, { filter: "all" });
    } catch {
      return [];
    }
  }, [token, instanceId]);

  const [sessionOptions, setSessionOptions] = useState<WorkingSessionRowDTO[]>([]);

  useEffect(() => {
    const id = window.setTimeout(() => setSessionQ(sessionQDraft.trim()), 320);
    return () => window.clearTimeout(id);
  }, [sessionQDraft]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (tab !== "keys") return;
    void (async () => {
      const all = await loadAllSessionsForSelect();
      setSessionOptions(all);
      if (!keysSession && all.length > 0) {
        setKeysSession(all[0].session_id);
      }
    })();
  }, [tab, loadAllSessionsForSelect, keysSession]);

  useEffect(() => {
    if (tab !== "keys" || !keysSession) return;
    let cancelled = false;
    setKeysLoading(true);
    void (async () => {
      try {
        const list = await listWorkingKeys(token, instanceId, keysSession, keysFilter.trim() || undefined);
        if (!cancelled) setKeys(list);
      } catch {
        if (!cancelled) setKeys([]);
      } finally {
        if (!cancelled) setKeysLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, token, instanceId, keysSession, keysFilter]);

  useEffect(() => {
    if (!token) return;
    billingMeRequest(token).then(setBilling).catch(() => setBilling(null));
  }, [token]);

  const storageLimitMb = billing?.plan?.max_storage_mb ?? stats?.max_storage_mb ?? 100;
  const storageUsedLabel =
    stats != null ? formatFileSize(stats.storage_used_bytes) : "—";
  const storageSub =
    storageLimitMb > 0 ? `of ${storageLimitMb} MB limit` : "plan limit";

  const hitMain =
    stats?.hit_rate_pct != null && stats.hit_rate_pct > 0 ? `${stats.hit_rate_pct}%` : "—";
  const hitSub = stats?.hit_rate_pct != null && stats.hit_rate_pct > 0 ? "last 24h" : "no data yet";

  const onPauseToggle = async () => {
    if (!token) return;
    setSettingsBusy(true);
    try {
      await patchInstance(token, instanceId, {
        status: inst.status === "active" ? "paused" : "active",
      });
      onRefreshInstance();
    } finally {
      setSettingsBusy(false);
    }
  };

  const onFlush = async () => {
    if (!token) return;
    if (!window.confirm("Remove all keys that are past their expiry time?")) return;
    setFlushBusy(true);
    try {
      const n = await flushWorkingExpired(token, instanceId);
      window.alert(`Removed ${n} expired key(s).`);
      void loadStats();
      void loadSessions();
      if (tab === "keys") {
        void listWorkingKeys(token, instanceId, keysSession, keysFilter.trim() || undefined).then(setKeys);
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Flush failed");
    } finally {
      setFlushBusy(false);
    }
  };

  const primaryScope = useMemo(() => {
    const u = keys.find((k) => k.scope_user_id)?.scope_user_id;
    return u ?? "";
  }, [keys]);

  const groupTitle = useMemo(() => {
    const sid = keysSession.toUpperCase() || "—";
    const u = primaryScope ? primaryScope.toUpperCase().replace(/_/g, "_") : "—";
    const n = keys.length;
    return `${sid} — ${u}  ${n} KEYS`;
  }, [keysSession, primaryScope, keys.length]);

  async function submitSetKey() {
    if (!token || !keysSession) return;
    setSkErr(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(skValue.trim() || "null");
    } catch {
      setSkErr("Value must be valid JSON.");
      return;
    }
    const k = skName.trim();
    if (!k) {
      setSkErr("Key name required.");
      return;
    }
    setSkBusy(true);
    try {
      const ttlSec =
        skTtlMin.trim() === "" || k === "__core__" || keysSession === "__persistent__"
          ? undefined
          : Math.max(1, Math.round(Number(skTtlMin) * 60));
      await putWorkingKey(token, instanceId, keysSession, k, {
        value: parsed,
        ttl_seconds: ttlSec,
        scope_user_id: skUser.trim() || null,
      });
      setSetKeyOpen(false);
      setSkName("");
      setSkValue("{}");
      setSkTtlMin("");
      setSkUser("");
      void loadStats();
      void loadSessions();
      const list = await listWorkingKeys(token, instanceId, keysSession, keysFilter.trim() || undefined);
      setKeys(list);
    } catch (e) {
      setSkErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSkBusy(false);
    }
  }

  async function onDelKey(key: string) {
    if (!token || !keysSession) return;
    if (!window.confirm(`Delete key “${key}”?`)) return;
    try {
      await deleteWorkingKey(token, instanceId, keysSession, key);
      void loadStats();
      void loadSessions();
      setKeys((prev) => prev.filter((r) => r.key !== key));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const statusLabel = inst.status ? inst.status.charAt(0).toUpperCase() + inst.status.slice(1) : "—";

  const tabs: [WorkingTab, string][] = [
    ["sessions", "Sessions"],
    ["keys", "Keys"],
    ["settings", "Settings"],
  ];

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col bg-bg3">
      <div className="border-b border-border bg-bg px-4 py-3 sm:px-6 lg:px-7">
        <div className="flex flex-wrap gap-2">
          {MEMORY_PILLS.map((p) => {
            const active = p.id === "working";
            if (p.soon) {
              return (
                <span
                  key={p.id}
                  className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-border bg-bg2 px-3 py-1.5 text-[12px] text-muted opacity-60"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-border2" aria-hidden />
                  {p.label}
                </span>
              );
            }
            if (active) {
              return (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium text-ink shadow-sm"
                  style={{ borderColor: p.col, backgroundColor: p.bg }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.col }} aria-hidden />
                  {p.label}
                </span>
              );
            }
            return (
              <Link
                key={p.id}
                href={p.href}
                className="inline-flex items-center gap-1.5 rounded-full border border-border2 bg-bg px-3 py-1.5 text-[12px] text-muted hover:bg-bg2 hover:text-ink"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.col }} aria-hidden />
                {p.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg px-4 py-3 sm:px-6 lg:px-7">
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <Link href="/instances" className="hover:text-ink">
            Instances
          </Link>
          <span className="text-border">›</span>
          <span className="font-semibold text-ink">{inst.name}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border2 bg-bg px-2.5 py-1 text-[12px] text-muted">
            <span className={clsx("h-2 w-2 rounded-full", inst.status === "active" ? "bg-[#639922]" : "bg-[#ba7517]")} />
            {statusLabel}
          </span>
          <button
            type="button"
            disabled={flushBusy}
            onClick={() => void onFlush()}
            className="rounded-lg border border-border2 bg-bg px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-bg2 disabled:opacity-50"
          >
            Flush expired
          </button>
          <button
            type="button"
            onClick={() => setTab("settings")}
            className="rounded-lg border border-border2 bg-bg px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-bg2"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => setTab("keys")}
            className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-bg hover:opacity-90"
          >
            Ingest
          </button>
        </div>
      </div>

      <div className="grid w-full min-w-0 grid-cols-2 border-b border-border bg-bg sm:grid-cols-3 lg:grid-cols-5">
        <KpiCell
          label="Sessions"
          value={stats ? formatCompactCount(stats.sessions_total) : "—"}
          sub={stats ? `${formatCompactCount(stats.sessions_active)} active now` : undefined}
        />
        <KpiCell
          label="Keys total"
          value={stats ? formatCompactCount(stats.keys_total) : "—"}
          sub="all sessions"
        />
        <KpiCell
          label="Default TTL"
          value={stats?.default_ttl_label ?? "—"}
          sub={stats?.max_ttl_label}
        />
        <KpiCell label="Hit rate" value={hitMain} sub={hitSub} />
        <KpiCell
          label="Memory used"
          value={storageUsedLabel}
          sub={storageSub}
          className="lg:last:border-r-0"
        />
      </div>

      <div className="border-b border-border bg-bg px-4 sm:px-6 lg:px-7">
        <nav className="flex gap-8">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={clsx(
                "relative py-3 text-[13px] font-medium",
                tab === id ? "text-ink" : "text-muted hover:text-ink",
              )}
            >
              {label}
              {tab === id ? (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-ink" aria-hidden />
              ) : null}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "sessions" ? (
          <div className="px-4 py-6 sm:px-6 lg:px-7">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="search"
                className="h-[38px] w-full max-w-2xl rounded-lg border border-border2 bg-bg px-3 text-[13px] text-ink outline-none focus:border-[#ba7517] sm:flex-1"
                placeholder="Search by session_id or user_id…"
                value={sessionQDraft}
                onChange={(e) => setSessionQDraft(e.target.value)}
              />
              <div className="flex shrink-0 gap-1 rounded-lg border border-border2 bg-bg p-0.5">
                <button
                  type="button"
                  onClick={() => setSessionFilter("active")}
                  className={clsx(
                    "rounded-md px-3 py-1.5 text-[12px] font-medium",
                    sessionFilter === "active" ? "bg-bg2 text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => setSessionFilter("all")}
                  className={clsx(
                    "rounded-md px-3 py-1.5 text-[12px] font-medium",
                    sessionFilter === "all" ? "bg-bg2 text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  All
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-bg">
              <div
                className="grid gap-2 border-b border-border bg-bg2 px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] text-subtle"
                style={{ gridTemplateColumns: "1fr 100px 80px 80px 88px" }}
              >
                <span>Session ID</span>
                <span>User</span>
                <span>Keys</span>
                <span>Last active</span>
                <span className="text-right">Status</span>
              </div>
              {sessionsLoading ? (
                <div className="p-8 text-center text-[13px] text-muted">Loading…</div>
              ) : sessions.length === 0 ? (
                <div className="p-8 text-center text-[13px] text-muted">No sessions yet. Add keys from the Keys tab.</div>
              ) : (
                <ul>
                  {sessions.map((row) => (
                    <li
                      key={row.session_id}
                      className="grid cursor-pointer items-center gap-2 border-b border-border px-4 py-3 text-[13px] last:border-b-0 hover:bg-bg2/50"
                      style={{ gridTemplateColumns: "1fr 100px 80px 80px 88px" }}
                      onClick={() => {
                        setKeysSession(row.session_id);
                        setTab("keys");
                      }}
                    >
                      <span className="font-mono text-[12px] text-ink">{row.session_id}</span>
                      <span className="truncate text-[12px] text-muted">{row.scope_user_id || "—"}</span>
                      <span className="text-[12px] text-ink">{row.key_count}</span>
                      <span className="text-[12px] text-muted">{formatRelativeShort(row.last_active_at)}</span>
                      <span className="text-right">
                        <SessionStatusBadge status={row.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {tab === "keys" ? (
          <div className="px-4 py-6 sm:px-6 lg:px-7">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="search"
                className="h-[38px] flex-1 rounded-lg border border-border2 bg-bg px-3 text-[13px] outline-none focus:border-[#ba7517]"
                placeholder="Filter by key…"
                value={keysFilter}
                onChange={(e) => setKeysFilter(e.target.value)}
              />
              <select
                className="h-[38px] min-w-[160px] rounded-lg border border-border2 bg-bg px-2.5 text-[12px] text-ink outline-none"
                value={keysSession}
                onChange={(e) => setKeysSession(e.target.value)}
              >
                {sessionOptions.length === 0 ? (
                  <option value="">— no sessions —</option>
                ) : (
                  sessionOptions.map((s) => (
                    <option key={s.session_id} value={s.session_id}>
                      {s.session_id}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                onClick={() => {
                  setSetKeyOpen(true);
                  setSkErr(null);
                }}
                className="h-[38px] shrink-0 rounded-lg bg-ink px-4 text-[12px] font-medium text-bg hover:opacity-90"
              >
                Set key
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-bg2/40">
              <div className="border-b border-border bg-bg2 px-4 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">
                {groupTitle}
              </div>
              {keysLoading ? (
                <div className="bg-bg p-8 text-center text-[13px] text-muted">Loading…</div>
              ) : keys.length === 0 ? (
                <div className="bg-bg p-8 text-center text-[13px] text-muted">
                  No keys in this session. Use Set key or the API.
                </div>
              ) : (
                <ul className="divide-y divide-border bg-bg">
                  {keys.map((row) => (
                    <li
                      key={row.key}
                      className={clsx(
                        "flex items-start gap-4 px-4 py-3",
                        row.is_core ? "bg-[#faf8ff]" : "",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[12px] font-medium text-[#185fa5]">{row.key}</div>
                        <div className="mt-1 break-all font-mono text-[12px] leading-relaxed text-ink">
                          {formatValuePreview(row.value)}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <KeyRowTtl expiresAt={row.expires_at} isCore={row.is_core} />
                        <button
                          type="button"
                          onClick={() => void onDelKey(row.key)}
                          className="rounded border border-border2 bg-bg px-2 py-1 text-[11px] font-medium text-muted hover:border-border hover:text-ink"
                        >
                          Del
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {setKeyOpen ? (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
                onClick={() => setSetKeyOpen(false)}
                role="presentation"
              >
                <div
                  className="w-full max-w-md rounded-xl border border-border bg-bg p-5 shadow-lg"
                  role="dialog"
                  aria-modal
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="text-[15px] font-medium text-ink">Set key</h3>
                  <p className="mt-1 text-[12px] text-muted">Session: {keysSession || "—"}</p>
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-muted">Key</label>
                      <input
                        className="h-[34px] w-full rounded-lg border border-border2 px-2.5 font-mono text-[12px]"
                        value={skName}
                        onChange={(e) => setSkName(e.target.value)}
                        placeholder="current_topic"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-muted">Value (JSON)</label>
                      <textarea
                        className="min-h-[88px] w-full resize-y rounded-lg border border-border2 px-2.5 py-2 font-mono text-[12px]"
                        value={skValue}
                        onChange={(e) => setSkValue(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[11px] text-muted">TTL (minutes, optional)</label>
                        <input
                          className="h-[34px] w-full rounded-lg border border-border2 px-2.5 text-[12px]"
                          value={skTtlMin}
                          onChange={(e) => setSkTtlMin(e.target.value)}
                          placeholder="default"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-muted">user_id (optional)</label>
                        <input
                          className="h-[34px] w-full rounded-lg border border-border2 px-2.5 font-mono text-[12px]"
                          value={skUser}
                          onChange={(e) => setSkUser(e.target.value)}
                          placeholder="user_alice"
                        />
                      </div>
                    </div>
                  </div>
                  {skErr ? <p className="mt-3 text-[12px] text-[#a32d2d]">{skErr}</p> : null}
                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setSetKeyOpen(false)}
                      className="rounded-lg border border-border2 px-3 py-1.5 text-[12px] font-medium text-muted hover:bg-bg2"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={skBusy}
                      onClick={() => void submitSetKey()}
                      className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
                    >
                      {skBusy ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "settings" ? (
          <div className="grid w-full min-w-0 grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-2 lg:px-7">
            <section className="min-w-0 rounded-[12px] border border-border bg-bg p-4 sm:p-5">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Basic</h2>
              <dl className="mt-4 space-y-3 text-[13px]">
                <div className="flex justify-between gap-4 border-b border-border pb-3">
                  <dt className="text-muted">Name</dt>
                  <dd className="font-medium text-ink">{inst.name}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-border pb-3">
                  <dt className="text-muted">Type</dt>
                  <dd className="font-medium text-ink">Working</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-border pb-3">
                  <dt className="text-muted">Created</dt>
                  <dd className="text-ink">{new Date(inst.created_at).toLocaleDateString()}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-border pb-3">
                  <dt className="text-muted">Instance ID</dt>
                  <dd className="font-mono text-[11px] text-ink">{inst.id}</dd>
                </div>
              </dl>
            </section>

            <section className="min-w-0 rounded-[12px] border border-border bg-bg p-4 sm:p-5">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">Danger zone</h2>
              <p className="mt-2 text-[12px] text-muted">Pausing stops all operations. Deleting is permanent.</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={settingsBusy}
                  onClick={() => void onPauseToggle()}
                  className="rounded-lg border border-border2 px-4 py-2 text-[12px] font-medium text-ink hover:bg-bg2 disabled:opacity-50"
                >
                  {inst.status === "active" ? "Pause instance" : "Resume instance"}
                </button>
                <button
                  type="button"
                  onClick={() => void onDeleteInstance()}
                  className="rounded-lg border border-[#f09595] bg-[#fcebeb] px-4 py-2 text-[12px] font-medium text-[#a32d2d] hover:opacity-90"
                >
                  Delete instance
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function KpiCell({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: string | number;
  sub?: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "min-w-0 border-b border-border px-3 py-3 sm:px-4 sm:py-4 lg:border-b-0 lg:border-r lg:py-4 lg:last:border-r-0",
        className,
      )}
    >
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-subtle">{label}</div>
      <div className="mt-1 text-2xl font-medium tracking-tight text-ink">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}

function SessionStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "active") {
    return (
      <span className="inline-flex rounded-md bg-[#eaf3de] px-2 py-0.5 text-[11px] font-medium text-[#3b6d11]">
        Active
      </span>
    );
  }
  if (s === "expiring") {
    return (
      <span className="inline-flex rounded-md bg-[#faeeda] px-2 py-0.5 text-[11px] font-medium text-[#854f0b]">
        Expiring
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-md bg-bg2 px-2 py-0.5 text-[11px] font-medium text-subtle">Expired</span>
  );
}
