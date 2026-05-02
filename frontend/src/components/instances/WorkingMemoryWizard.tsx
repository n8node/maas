"use client";

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";

export type WorkingUseCaseId = "agent" | "core" | "form" | "cache" | "rate" | "ctx";

const USE_CASES: Array<{
  id: WorkingUseCaseId;
  icon: string;
  name: string;
  desc: string;
}> = [
  {
    id: "agent",
    icon: "🤖",
    name: "Agent state",
    desc: "Current topic, active task, slot values, turn counter during a conversation",
  },
  {
    id: "core",
    icon: "🧠",
    name: "Core memory",
    desc: "Persistent user profile always injected into agent system prompt (self-editing)",
  },
  {
    id: "form",
    icon: "📋",
    name: "Form / wizard",
    desc: "Multi-step form state, user answers, validation flags across steps",
  },
  {
    id: "cache",
    icon: "⚡",
    name: "API cache",
    desc: "Cache expensive API responses or computed values with short TTL",
  },
  {
    id: "rate",
    icon: "🚦",
    name: "Rate limiting",
    desc: "Per-user counters, cooldown flags, request budgets with auto-expiry",
  },
  {
    id: "ctx",
    icon: "📌",
    name: "Pinned context",
    desc: "Facts the user explicitly wants the agent to remember for this session",
  },
];

export const WORKING_MAX_TTL_OPTIONS = [
  { value: "4h", label: "4 hours" },
  { value: "24h", label: "24 hours (recommended)" },
  { value: "72h", label: "72 hours" },
  { value: "none", label: "No ceiling" },
] as const;

export const WORKING_SWEEP_OPTIONS = [
  "Every 5 minutes",
  "Every 15 minutes (recommended)",
  "Every 1 hour",
  "Manual only",
] as const;

/** Port of 12-create-working.html `updateTTL` — slider 1…60. */
export function workingTtlFromSlider(v: number): { label: string; pct: number; markers: string[] } {
  const n = Math.max(1, Math.min(60, Math.floor(v)));
  if (n <= 4) {
    return { label: `${n} minute${n > 1 ? "s" : ""}`, pct: 6, markers: ["0", "1m", "2m", "3m", "4m"] };
  }
  if (n <= 15) {
    return {
      label: `${n} minutes`,
      pct: 25,
      markers: ["0", `${n}m`, `${n * 2}m`, `${n * 3}m`, `${n * 4}m`],
    };
  }
  if (n <= 30) {
    return { label: `${n} minutes`, pct: 40, markers: ["0", "15m", "30m", "45m", "1h"] };
  }
  if (n <= 45) {
    return { label: `${n} minutes`, pct: 60, markers: ["0", "15m", "30m", "45m", "1h"] };
  }
  return { label: "1 hour", pct: 75, markers: ["0", "30m", "1h", "2h", "3h"] };
}

const SECTION_TITLE =
  "mb-3 border-b border-border pb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted";

const W = "#854f0b";
const W_MID = "#ba7517";
const W_BG = "#faeeda";

type KVSimRow = {
  k: string;
  v: string;
  ttl: string;
  isCore?: boolean;
  expired?: boolean;
};

const INITIAL_KV_ROWS: KVSimRow[] = [
  { k: "current_topic", v: '"Discussing sleep hygiene and Q3 goals"', ttl: "14m 22s" },
  { k: "user_mood", v: '"anxious"', ttl: "14m 22s" },
  { k: "context_summary", v: '"User is a marketer, KPI: 500 leads, budget 2M/qtr"', ttl: "14m 22s" },
  {
    k: "__core__",
    v: '{"user_profile":"Alexey, 34…","preferences":"…"}',
    ttl: "∞ persistent",
    isCore: true,
  },
];

function WToggle({
  id,
  on,
  onToggle,
}: {
  id: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={clsx(
        "relative h-[18px] w-8 shrink-0 rounded-full transition-colors",
        on ? "bg-[#854f0b]" : "bg-border2",
      )}
    >
      <span
        className={clsx(
          "absolute top-[3px] h-3 w-3 rounded-full bg-white shadow-sm transition-[left]",
          on ? "left-[17px]" : "left-[3px]",
        )}
      />
    </button>
  );
}

export function useWorkingMemoryForm() {
  const [description, setDescription] = useState(
    "Per-session state for the coaching agent. Stores current topic, mood, active goals, and slot values during a conversation.",
  );
  const [useCase, setUseCase] = useState<WorkingUseCaseId>("agent");
  const [ttlSlider, setTtlSlider] = useState(15);

  const [maxTtl, setMaxTtl] = useState<(typeof WORKING_MAX_TTL_OPTIONS)[number]["value"]>("24h");
  const [sweepEnabled, setSweepEnabled] = useState(true);
  const [sweepSchedule, setSweepSchedule] = useState<(typeof WORKING_SWEEP_OPTIONS)[number]>(
    WORKING_SWEEP_OPTIONS[1],
  );
  const [maxKeysPerSession, setMaxKeysPerSession] = useState(100);

  const [kvRows, setKvRows] = useState<KVSimRow[]>(() => INITIAL_KV_ROWS.map((r) => ({ ...r })));
  const [kvNewKey, setKvNewKey] = useState("");
  const [kvNewVal, setKvNewVal] = useState("");
  const [kvNewTtl, setKvNewTtl] = useState<"15 min" | "1 hour" | "No TTL">("15 min");

  const [selfEditingEnabled, setSelfEditingEnabled] = useState(true);
  const [sectionUserProfile, setSectionUserProfile] = useState(true);
  const [sectionPreferences, setSectionPreferences] = useState(true);
  const [sectionCurrentContext, setSectionCurrentContext] = useState(true);
  const [sectionImportantFacts, setSectionImportantFacts] = useState(true);
  const [coreMaxTokens, setCoreMaxTokens] = useState(4000);

  const ttlDisplay = useMemo(() => workingTtlFromSlider(ttlSlider), [ttlSlider]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setKvRows((rows) =>
        rows.map((kv) => {
          if (kv.isCore || kv.expired) return kv;
          const m = kv.ttl.match(/(\d+)m (\d+)s/);
          if (!m) return kv;
          let min = parseInt(m[1], 10);
          let sec = parseInt(m[2], 10);
          if (sec > 0) sec--;
          else if (min > 0) {
            min--;
            sec = 59;
          }
          if (min <= 0 && sec <= 0) {
            return { ...kv, ttl: "expired", expired: true };
          }
          return { ...kv, ttl: `${min}m ${sec}s` };
        }),
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const activeKvCount = useMemo(() => kvRows.filter((r) => !r.expired).length, [kvRows]);

  const addKvRow = useCallback(() => {
    const k = kvNewKey.trim();
    if (!k) return;
    const vRaw = kvNewVal.trim();
    const quoted = vRaw ? `"${vRaw.replace(/"/g, '\\"')}"` : '""';
    const isCoreKey = k === "__core__";
    let ttlStr: string;
    let isCore = false;
    if (isCoreKey || kvNewTtl === "No TTL") {
      ttlStr = "∞ persistent";
      isCore = true;
    } else if (kvNewTtl === "1 hour") {
      ttlStr = "59m 59s";
    } else {
      ttlStr = "14m 59s";
    }
    setKvRows((prev) => [
      {
        k,
        v: quoted,
        ttl: ttlStr,
        isCore,
        expired: false,
      },
      ...prev,
    ]);
    setKvNewKey("");
    setKvNewVal("");
  }, [kvNewKey, kvNewVal, kvNewTtl]);

  const toConfig = useCallback((): Record<string, unknown> => {
    const defaultMinutes =
      ttlDisplay.label === "1 hour"
        ? 60
        : (() => {
            const m = ttlDisplay.label.match(/^(\d+)/);
            return m ? parseInt(m[1], 10) : ttlSlider;
          })();
    const sections: string[] = [];
    if (sectionUserProfile) sections.push("user_profile");
    if (sectionPreferences) sections.push("preferences");
    if (sectionCurrentContext) sections.push("current_context");
    if (sectionImportantFacts) sections.push("important_facts");
    return {
      description: description.trim() || undefined,
      use_case: useCase,
      ttl: {
        default_minutes: defaultMinutes,
        slider_raw: ttlSlider,
        max_ceiling: maxTtl,
      },
      sweep: {
        enabled: sweepEnabled,
        schedule: sweepSchedule,
      },
      limits: {
        max_keys_per_session: maxKeysPerSession,
      },
      self_editing: {
        enabled: selfEditingEnabled,
        core_sections: sections,
        max_core_tokens: coreMaxTokens,
      },
      key_simulator_rows: kvRows.map((r) => ({ key: r.k, value: r.v, ttl: r.ttl, is_core: !!r.isCore })),
    };
  }, [
    description,
    useCase,
    ttlDisplay.label,
    ttlSlider,
    maxTtl,
    sweepEnabled,
    sweepSchedule,
    maxKeysPerSession,
    selfEditingEnabled,
    sectionUserProfile,
    sectionPreferences,
    sectionCurrentContext,
    sectionImportantFacts,
    coreMaxTokens,
    kvRows,
  ]);

  const reviewSelfEditingLabel = useMemo(() => {
    if (!selfEditingEnabled) return "Disabled";
    const n =
      [sectionUserProfile, sectionPreferences, sectionCurrentContext, sectionImportantFacts].filter(Boolean).length;
    return `Enabled · ${n} sections · ${coreMaxTokens.toLocaleString()} tokens`;
  }, [
    selfEditingEnabled,
    sectionUserProfile,
    sectionPreferences,
    sectionCurrentContext,
    sectionImportantFacts,
    coreMaxTokens,
  ]);

  return {
    description,
    setDescription,
    useCase,
    setUseCase,
    ttlSlider,
    setTtlSlider,
    ttlDisplay,
    maxTtl,
    setMaxTtl,
    sweepEnabled,
    setSweepEnabled,
    sweepSchedule,
    setSweepSchedule,
    maxKeysPerSession,
    setMaxKeysPerSession,
    kvRows,
    kvNewKey,
    setKvNewKey,
    kvNewVal,
    setKvNewVal,
    kvNewTtl,
    setKvNewTtl,
    addKvRow,
    activeKvCount,
    selfEditingEnabled,
    setSelfEditingEnabled,
    sectionUserProfile,
    setSectionUserProfile,
    sectionPreferences,
    setSectionPreferences,
    sectionCurrentContext,
    setSectionCurrentContext,
    sectionImportantFacts,
    setSectionImportantFacts,
    coreMaxTokens,
    setCoreMaxTokens,
    toConfig,
    reviewSelfEditingLabel,
  };
}

export type WorkingMemoryForm = ReturnType<typeof useWorkingMemoryForm>;

export function WorkingMemoryWizardStep({
  step,
  form,
  name,
  setName,
}: {
  step: number;
  form: WorkingMemoryForm;
  name: string;
  setName: (v: string) => void;
}) {
  if (step === 1) {
    return <WorkingStep1 form={form} name={name} setName={setName} />;
  }
  if (step === 2) {
    return <WorkingStep2 form={form} />;
  }
  if (step === 3) {
    return <WorkingStep3 form={form} />;
  }
  if (step === 4) {
    return <WorkingStep4 form={form} />;
  }
  if (step === 5) {
    return <WorkingStep5 form={form} name={name} />;
  }
  return null;
}

function WorkingStep1({
  form,
  name,
  setName,
}: {
  form: WorkingMemoryForm;
  name: string;
  setName: (v: string) => void;
}) {
  return (
    <>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em]" style={{ color: W_MID }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <rect x="1.5" y="2.5" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1" />
          <line x1="4" y1="2.5" x2="4" y2="9.5" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        </svg>
        Step 1 · Working memory
      </div>
      <h1 className="text-[18px] font-medium tracking-[-0.02em] text-ink">Short-term key-value store</h1>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-subtle">
        Working memory holds the current task context of an AI agent — variables, flags, and slot values that exist for
        the duration of a session. No embeddings, no LLM extraction — just fast key-value reads and writes with automatic
        TTL expiry.
      </p>

      <section className="mt-6">
        <h2 className={SECTION_TITLE}>Identity</h2>
        <div className="mb-3.5">
          <label className="mb-1.5 block text-[12px] text-muted" htmlFor="wm-name">
            Instance name
          </label>
          <input
            id="wm-name"
            className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-[11px] text-[13px] text-ink outline-none focus:border-[#ba7517]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Session Context, Agent State, Task Scratchpad"
            autoComplete="off"
            maxLength={128}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] text-muted" htmlFor="wm-desc">
            Description <span className="text-[11px] font-normal text-subtle">— optional</span>
          </label>
          <textarea
            id="wm-desc"
            className="min-h-[56px] w-full resize-y rounded-lg border border-border2 bg-bg px-[11px] py-2 text-[12px] leading-relaxed text-ink outline-none focus:border-[#ba7517]"
            value={form.description}
            onChange={(e) => form.setDescription(e.target.value)}
            placeholder="What will this instance store?"
          />
        </div>
      </section>

      <section className="mt-6">
        <h2 className={SECTION_TITLE}>Use case</h2>
        <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {USE_CASES.map((uc) => {
            const sel = form.useCase === uc.id;
            return (
              <button
                key={uc.id}
                type="button"
                onClick={() => form.setUseCase(uc.id)}
                className={clsx(
                  "relative rounded-lg border bg-bg p-2.5 text-left transition-colors",
                  sel ? "border-[1.5px] bg-[#faeeda]" : "border border-border hover:border-border2",
                )}
                style={sel ? { borderColor: W_MID } : undefined}
              >
                <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink">
                  <span
                    className={clsx(
                      "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full",
                      sel ? "bg-[#854f0b]" : "hidden",
                    )}
                  >
                    {sel ? (
                      <svg width="7" height="7" viewBox="0 0 7 7" fill="none" aria-hidden>
                        <polyline points="0.5,3.5 2.5,5.5 6.5,1.5" stroke="white" strokeWidth="1.1" strokeLinecap="round" />
                      </svg>
                    ) : null}
                  </span>
                  <span className="shrink-0">{uc.icon}</span>
                  <span>{uc.name}</span>
                </div>
                <p className="text-[10px] leading-[1.35] text-subtle">{uc.desc}</p>
              </button>
            );
          })}
        </div>
      </section>

      <div className="mt-6 flex gap-2 rounded-lg border border-[#c8d8f0] bg-[#f0f4fb] px-[13px] py-2.5 text-[12px] leading-relaxed text-[#1d3a6b]">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-0.5 shrink-0 text-[#185fa5]" aria-hidden>
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1" />
          <line x1="7" y1="6" x2="7" y2="10" stroke="currentColor" strokeWidth="1.1" />
          <circle cx="7" cy="4.5" r="0.7" fill="currentColor" />
        </svg>
        <p>
          <strong>No embeddings, no LLM.</strong> Working memory is pure key-value — reads and writes are synchronous
          and instant. Token cost: zero. It&apos;s the cheapest memory type on the platform.
        </p>
      </div>
    </>
  );
}

function WorkingStep2({ form }: { form: WorkingMemoryForm }) {
  const { ttlDisplay } = form;
  return (
    <>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em]" style={{ color: W_MID }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1" />
          <line x1="6" y1="3.5" x2="6" y2="6" stroke="currentColor" strokeWidth="1" />
          <line x1="6" y1="6" x2="9.5" y2="8" stroke="currentColor" strokeWidth="1" />
        </svg>
        Step 2 · TTL &amp; expiry
      </div>
      <h1 className="text-[18px] font-medium tracking-[-0.02em] text-ink">When should keys expire?</h1>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-subtle">
        Every key can have an individual TTL. Here you set the instance-level defaults — individual keys can override
        these at write time. Expired keys are auto-deleted by a background sweep worker.
      </p>

      <section className="mt-6">
        <h2 className={SECTION_TITLE}>Default TTL</h2>
        <div className="mb-1.5 text-[12px] text-muted">
          Default key TTL <span className="text-[11px] font-normal text-subtle">— applied when no TTL is specified at write time</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={60}
            value={form.ttlSlider}
            onChange={(e) => form.setTtlSlider(Number(e.target.value))}
            className="min-w-0 flex-1 cursor-pointer"
            style={{ accentColor: W }}
          />
          <span className="min-w-[100px] shrink-0 text-right text-[13px] font-medium" style={{ color: W }}>
            {ttlDisplay.label}
          </span>
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-subtle">
          <span>1 min</span>
          <span>15 min</span>
          <span>1 hour</span>
          <span>4 hours</span>
        </div>

        <div className="mt-3 rounded-xl border border-border bg-bg px-4 py-3.5">
          <div className="mb-2.5 flex items-center justify-between text-[11px] font-medium text-muted">
            <span>Session key lifetime</span>
            <span className="font-normal text-subtle">Keys live for {ttlDisplay.label} after last write</span>
          </div>
          <div className="relative mb-2 h-10 overflow-hidden rounded-md bg-bg2">
            <div
              className="absolute left-0 top-0 flex h-full items-center rounded-l-md pl-2.5 text-[11px] font-medium text-white transition-[width] duration-300 ease-out"
              style={{ width: `${ttlDisplay.pct}%`, background: W }}
            >
              {ttlDisplay.label} active
            </div>
          </div>
          <div className="flex justify-between px-0.5 text-[9px] text-subtle">
            {ttlDisplay.markers.map((m) => (
              <span key={m}>{m}</span>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-3.5 border-t border-border pt-2">
            <span className="flex items-center gap-1.5 text-[11px] text-subtle">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: W }} />
              Active key
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-subtle">
              <span className="h-2 w-2 shrink-0 rounded-full bg-border2" />
              Expired / swept
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-subtle">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#534ab7]" />
              __core__ (no TTL)
            </span>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className={SECTION_TITLE}>Per-key TTL overrides</h2>
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-[1fr_auto] items-center gap-2.5 rounded-lg bg-bg2 px-3 py-2">
            <div>
              <div className="text-[12px] font-medium text-ink">Regular session keys</div>
              <div className="text-[11px] text-subtle">current_topic, user_mood, last_action…</div>
            </div>
            <div className="text-[12px] font-medium" style={{ color: W }}>
              {ttlDisplay.label} (default)
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-center gap-2.5 rounded-lg border border-[#d0cdf7] bg-[#eeedfe] px-3 py-2">
            <div>
              <div className="text-[12px] font-medium text-[#534ab7]">__core__ key</div>
              <div className="text-[11px] text-[#534ab7] opacity-70">Persistent — no TTL, survives session end</div>
            </div>
            <div className="text-[12px] font-medium text-[#534ab7]">∞ No expiry</div>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-center gap-2.5 rounded-lg bg-bg2 px-3 py-2">
            <div>
              <div className="text-[12px] font-medium text-ink">Cache keys</div>
              <div className="text-[11px] text-subtle">api_response_*, computed_*</div>
            </div>
            <div className="text-[12px] text-subtle">Set at write time</div>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className={SECTION_TITLE}>Maximum key TTL</h2>
        <div className="mb-1.5 text-[12px] text-muted">
          Hard ceiling for any key <span className="text-[11px] text-subtle">— prevents keys from living forever by accident</span>
        </div>
        <select
          className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-[11px] text-[12px] outline-none focus:border-[#ba7517]"
          value={form.maxTtl}
          onChange={(e) => form.setMaxTtl(e.target.value as (typeof WORKING_MAX_TTL_OPTIONS)[number]["value"])}
        >
          {WORKING_MAX_TTL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="mt-2 flex gap-2 rounded-lg border border-[#fac775] bg-[#faeeda] px-[13px] py-2.5 text-[12px] leading-relaxed text-[#633806]">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-0.5 shrink-0" aria-hidden>
            <path d="M7 1.5L13 12.5H1L7 1.5Z" stroke="#ba7517" strokeWidth="1.1" />
            <line x1="7" y1="5" x2="7" y2="9" stroke="#ba7517" strokeWidth="1" />
            <circle cx="7" cy="11" r="0.75" fill="#ba7517" />
          </svg>
          <span>
            The <strong>__core__</strong> key is permanently exempt from the max TTL ceiling — it always persists
            regardless of this setting.
          </span>
        </div>
      </section>

      <section className="mt-6">
        <h2 className={SECTION_TITLE}>Expiry sweep</h2>
        <div className="flex items-start justify-between gap-3 border-b border-border py-2.5">
          <div className="min-w-0 pr-2">
            <div className="text-[13px] font-medium text-ink">Auto-sweep expired keys</div>
            <div className="mt-0.5 text-[11px] leading-snug text-subtle">
              Background worker deletes expired keys on schedule. Without this, expired keys remain in storage but are
              never returned in reads.
            </div>
          </div>
          <WToggle id="wm-sweep" on={form.sweepEnabled} onToggle={() => form.setSweepEnabled((x) => !x)} />
        </div>
        <div className="mt-2.5">
          <label className="mb-1.5 block text-[12px] text-muted" htmlFor="wm-sweep-sched">
            Sweep frequency
          </label>
          <select
            id="wm-sweep-sched"
            className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-[11px] text-[12px] outline-none focus:border-[#ba7517]"
            value={form.sweepSchedule}
            onChange={(e) => form.setSweepSchedule(e.target.value as (typeof WORKING_SWEEP_OPTIONS)[number])}
          >
            {WORKING_SWEEP_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </section>
    </>
  );
}

function WorkingStep3({ form }: { form: WorkingMemoryForm }) {
  return (
    <>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em]" style={{ color: W_MID }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1" />
          <line x1="4" y1="5" x2="8" y2="5" stroke="currentColor" strokeWidth="1" />
          <line x1="4" y1="7.5" x2="7" y2="7.5" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        </svg>
        Step 3 · Key schema
      </div>
      <h1 className="text-[18px] font-medium tracking-[-0.02em] text-ink">Design your key structure</h1>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-subtle">
        Every key lives inside a <code className="rounded bg-bg2 px-1 py-0.5 font-mono text-[10px]">session_id</code>{" "}
        namespace. Keys are arbitrary strings with JSONB values. Define your schema here — or skip and define it in code.
        This is for documentation only and doesn&apos;t enforce constraints.
      </p>

      <section className="mt-6">
        <h2 className={SECTION_TITLE}>Key simulator — try it out</h2>
        <div className="mt-2 overflow-hidden rounded-xl border border-border bg-bg">
          <div className="flex items-center justify-between border-b border-border bg-bg2 px-3.5 py-2 text-[10px] font-medium uppercase tracking-[0.06em] text-subtle">
            <span className="normal-case">session_abc · user_alice</span>
            <span>{form.activeKvCount} keys active</span>
          </div>
          {form.kvRows.map((row, idx) => (
            <div
              key={`${row.k}-${idx}`}
              className="grid grid-cols-[140px_1fr_auto_auto] items-center gap-0 border-b border-border px-3.5 py-2 text-[12px] last:border-b-0"
              style={row.isCore ? { background: "#f6f4ff" } : undefined}
            >
              <span className={clsx("font-mono text-[11px] font-medium", row.isCore ? "text-[#534ab7]" : "")} style={!row.isCore ? { color: W } : undefined}>
                {row.k}
              </span>
              <span className="truncate px-3 text-[11px] text-muted">{row.v}</span>
              <span className={clsx("whitespace-nowrap pr-3 text-[10px] text-subtle", row.isCore && "text-[#534ab7]")}>
                {row.ttl}
              </span>
              <span
                className={clsx(
                  "whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-medium",
                  row.isCore ? "bg-[#eeedfe] text-[#534ab7]" : row.expired ? "bg-bg2 text-subtle" : "bg-[#faeeda] text-[#854f0b]",
                )}
              >
                {row.isCore ? "core" : row.expired ? "expired" : "active"}
              </span>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3.5 py-2">
            <input
              className="h-7 w-[140px] rounded-md border border-border2 bg-bg px-2 text-[11px] outline-none focus:border-[#ba7517]"
              placeholder="key name"
              value={form.kvNewKey}
              onChange={(e) => form.setKvNewKey(e.target.value)}
            />
            <input
              className="h-7 min-w-[120px] flex-1 rounded-md border border-border2 bg-bg px-2 text-[11px] outline-none focus:border-[#ba7517]"
              placeholder="value"
              value={form.kvNewVal}
              onChange={(e) => form.setKvNewVal(e.target.value)}
            />
            <select
              className="h-7 w-[90px] rounded-md border border-border2 bg-bg px-1.5 text-[11px] outline-none focus:border-[#ba7517]"
              value={form.kvNewTtl}
              onChange={(e) => form.setKvNewTtl(e.target.value as typeof form.kvNewTtl)}
            >
              <option value="15 min">15 min</option>
              <option value="1 hour">1 hour</option>
              <option value="No TTL">No TTL</option>
            </select>
            <button
              type="button"
              onClick={() => form.addKvRow()}
              className="h-7 whitespace-nowrap rounded-md px-2.5 text-[11px] font-medium text-white hover:opacity-90"
              style={{ background: W }}
            >
              + Add key
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-subtle">Keys expire automatically · JSONB values · UNIQUE(instance, session_id, key)</p>
      </section>

      <section className="mt-6">
        <h2 className={SECTION_TITLE}>Session isolation</h2>
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="rounded-lg border border-border bg-bg px-3 py-2.5">
            <div className="mb-1.5 flex flex-wrap items-center gap-1 text-[11px]">
              <span className="font-mono font-medium" style={{ color: W }}>
                session_abc
              </span>
              <span className="text-subtle">· user_alice ·</span>
              <span className="rounded bg-[#faeeda] px-1.5 py-0.5 text-[10px] font-medium text-[#854f0b]">active · 14m left</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {["current_topic", "user_mood", "context_summary"].map((k) => (
                <span key={k} className="rounded bg-bg2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                  {k}
                </span>
              ))}
              <span className="rounded bg-[#eeedfe] px-1.5 py-0.5 font-mono text-[10px] text-[#534ab7]">__core__</span>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-bg px-3 py-2.5 opacity-70">
            <div className="mb-1.5 flex flex-wrap items-center gap-1 text-[11px]">
              <span className="font-mono font-medium" style={{ color: W }}>
                session_xyz
              </span>
              <span className="text-subtle">· user_bob ·</span>
              <span className="rounded bg-[#faeeda] px-1.5 py-0.5 text-[10px] font-medium text-[#854f0b]">active · 8m left</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {["current_topic", "form_step"].map((k) => (
                <span key={k} className="rounded bg-bg2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                  {k}
                </span>
              ))}
              <span className="rounded bg-[#eeedfe] px-1.5 py-0.5 font-mono text-[10px] text-[#534ab7]">__core__</span>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-bg px-3 py-2.5 opacity-40">
            <div className="mb-1.5 flex flex-wrap items-center gap-1 text-[11px]">
              <span className="font-mono font-medium" style={{ color: W }}>
                session_old
              </span>
              <span className="text-subtle">· user_carol ·</span>
              <span className="rounded bg-bg2 px-1.5 py-0.5 text-[10px] font-medium text-subtle">expired 2h ago</span>
            </div>
            <span className="rounded bg-bg2 px-1.5 py-0.5 font-mono text-[10px] text-subtle opacity-50">swept by worker</span>
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-subtle">
          Each session is fully isolated. Reads from session_abc never see session_xyz keys.
        </p>
      </section>

      <section className="mt-6">
        <h2 className={SECTION_TITLE}>Max keys per session</h2>
        <div className="mb-1.5 text-[12px] text-muted">
          Hard limit <span className="text-[11px] text-subtle">— prevents runaway sessions from consuming all storage</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={10}
            max={500}
            value={form.maxKeysPerSession}
            onChange={(e) => form.setMaxKeysPerSession(Number(e.target.value))}
            className="min-w-0 flex-1 cursor-pointer"
            style={{ accentColor: W }}
          />
          <span className="min-w-[72px] shrink-0 text-right text-[13px] font-medium" style={{ color: W }}>
            {form.maxKeysPerSession} keys
          </span>
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-subtle">
          <span>10</span>
          <span>100</span>
          <span>250</span>
          <span>500</span>
        </div>
      </section>
    </>
  );
}

function WorkingStep4({ form }: { form: WorkingMemoryForm }) {
  return (
    <>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em]" style={{ color: W_MID }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1" />
          <path d="M1.5 10.5c0-2.2 2-4 4.5-4s4.5 1.8 4.5 4" stroke="currentColor" strokeWidth="1" fill="none" />
          <circle cx="6" cy="5" r="0.8" fill="currentColor" />
        </svg>
        Step 4 · Self-editing / Core memory
      </div>
      <h1 className="text-[18px] font-medium tracking-[-0.02em] text-ink">Let the agent manage its own context</h1>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-subtle">
        In self-editing mode, the agent writes to Working memory during conversations via tool calls. The special{" "}
        <code className="rounded bg-bg2 px-1 py-0.5 font-mono text-[10px]">__core__</code> key acts as persistent context —
        always injected into the system prompt, never expires.
      </p>

      <section className="mt-6">
        <h2 className={SECTION_TITLE}>Self-editing mode</h2>
        <div className="flex items-start justify-between gap-3 border-b border-border py-2.5">
          <div className="min-w-0 pr-2">
            <div className="text-[13px] font-medium text-ink">Enable self-editing</div>
            <div className="mt-0.5 text-[11px] leading-snug text-subtle">
              Exposes <code className="font-mono text-[10px]">core_memory_read</code>,{" "}
              <code className="font-mono text-[10px]">core_memory_update</code>,{" "}
              <code className="font-mono text-[10px]">core_memory_replace</code> as MCP/SDK tools. The agent can write to its
              own Working memory during conversations.
            </div>
          </div>
          <WToggle id="wm-se" on={form.selfEditingEnabled} onToggle={() => form.setSelfEditingEnabled((x) => !x)} />
        </div>
      </section>

      <div className={clsx("space-y-6 transition-opacity", !form.selfEditingEnabled && "pointer-events-none opacity-40")}>
        <section className="mt-6">
          <h2 className={SECTION_TITLE}>Core memory sections</h2>
          <p className="mb-2 text-[12px] text-muted">
            The <code className="font-mono text-[11px] text-[#534ab7]">__core__</code> key is structured JSON with
            sections. The agent updates sections individually. Max size:{" "}
            <span className="font-medium">{form.coreMaxTokens.toLocaleString()}</span> tokens.
          </p>
          {(
            [
              ["user_profile", "Name, age, occupation, background — who the user is", form.sectionUserProfile, form.setSectionUserProfile],
              ["preferences", "Communication style, tone, topics to avoid", form.sectionPreferences, form.setSectionPreferences],
              [
                "current_context",
                "Active topic, ongoing tasks, what's being discussed right now",
                form.sectionCurrentContext,
                form.setSectionCurrentContext,
              ],
              [
                "important_facts",
                "Key facts the agent deems critical to remember across sessions",
                form.sectionImportantFacts,
                form.setSectionImportantFacts,
              ],
            ] as const
          ).map(([id, desc, on, setOn]) => (
            <div key={id} className="flex items-start justify-between gap-3 border-b border-border py-2">
              <div className="min-w-0 pr-2">
                <div className="font-mono text-[12px] font-medium text-[#534ab7]">{id}</div>
                <div className="text-[11px] text-subtle">{desc}</div>
              </div>
              <WToggle id={`wm-sec-${id}`} on={on} onToggle={() => setOn((x) => !x)} />
            </div>
          ))}

          <div className="mt-3">
            <div className="mb-1.5 text-[12px] text-muted">
              Max core memory size{" "}
              <span className="text-[11px] font-normal text-subtle">— tokens injected into every system prompt</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={500}
                max={8000}
                step={500}
                value={form.coreMaxTokens}
                onChange={(e) => form.setCoreMaxTokens(Number(e.target.value))}
                className="min-w-0 flex-1 cursor-pointer"
                style={{ accentColor: W }}
              />
              <span className="min-w-[100px] shrink-0 text-right text-[13px] font-medium" style={{ color: W }}>
                {form.coreMaxTokens.toLocaleString()} tokens
              </span>
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-subtle">
              <span>500</span>
              <span>2K</span>
              <span>4K rec.</span>
              <span>8K</span>
            </div>
          </div>
        </section>

        <section>
          <h2 className={SECTION_TITLE}>How self-editing works</h2>
          <div className="mt-2 grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-bg lg:grid-cols-[1fr_auto_1fr]">
            <div className="border-b border-border p-3.5 lg:border-b-0 lg:border-r-0">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.06em] text-subtle">Agent tool calls</div>
              <div className="mb-1 flex items-center gap-1.5 rounded-md bg-bg2 px-2 py-1.5 font-mono text-[10px] text-muted">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#534ab7]" />
                core_memory_read
              </div>
              <div className="mb-1 flex items-center gap-1.5 rounded-md bg-bg2 px-2 py-1.5 font-mono text-[10px] text-muted">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: W }} />
                core_memory_update
              </div>
              <div className="flex items-center gap-1.5 rounded-md bg-bg2 px-2 py-1.5 font-mono text-[10px] text-muted">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: W }} />
                core_memory_replace
              </div>
            </div>
            <div className="hidden items-center justify-center border-border bg-bg2 px-1 lg:flex lg:border-x lg:border-y-0">
              <svg width="16" height="40" viewBox="0 0 16 40" fill="none" aria-hidden>
                <line x1="8" y1="0" x2="8" y2="40" stroke="#d3d1c7" strokeWidth="1" />
                <polyline points="4,33 8,39 12,33" stroke="#d3d1c7" strokeWidth="1" fill="none" />
              </svg>
            </div>
            <div className="p-3.5">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.06em] text-subtle">Working memory stores</div>
              <div className="mb-1 rounded-md px-2 py-1.5 font-mono text-[10px]" style={{ background: W_BG, color: W }}>
                session: __persistent__
              </div>
              <div className="mb-1 rounded-md px-2 py-1.5 font-mono text-[10px]" style={{ background: W_BG, color: W }}>
                key: __core__
              </div>
              <div className="rounded-md px-2 py-1.5 font-mono text-[10px]" style={{ background: W_BG, color: W }}>
                value: {"{ user_profile, preferences, current_context, important_facts }"}
              </div>
            </div>
          </div>
          <div className="mt-2 rounded-lg bg-bg2 px-3.5 py-2.5">
            <div className="mb-1.5 text-[11px] font-medium text-muted">Example — agent writes after learning user&apos;s name</div>
            <pre className="overflow-x-auto rounded-md bg-bg2 px-3 py-2 font-mono text-[11px] leading-[1.7] text-muted">
              <span className="text-[#185fa5]">core_memory_update</span>({"{"}
              {"\n"}
              {"  "}
              <span className="text-[#993556]">&quot;section&quot;</span>: <span className="text-[#3b6d11]">&quot;user_profile&quot;</span>,
              {"\n"}
              {"  "}
              <span className="text-[#993556]">&quot;content&quot;</span>:{" "}
              <span className="text-[#3b6d11]">&quot;Alexey, 34, senior marketer at a SaaS company&quot;</span>,{"\n"}
              {"  "}
              <span className="text-[#993556]">&quot;reason&quot;</span>:{" "}
              <span className="text-[#3b6d11]">&quot;User introduced themselves at start of conversation&quot;</span>
              {"\n"}
              {"}"})
            </pre>
          </div>
        </section>

        <section>
          <h2 className={SECTION_TITLE}>System prompt injection</h2>
          <div className="rounded-lg border border-border bg-bg px-3.5 py-2.5">
            <div className="mb-1.5 text-[11px] font-medium text-muted">SDK helper — inject core memory before every LLM call</div>
            <pre className="overflow-x-auto rounded-md bg-bg2 px-3 py-2 font-mono text-[11px] leading-[1.7] text-muted">
              <span className="text-[#185fa5]">core</span> = agent.get_core_memory(user_id=<span className="text-[#3b6d11]">&quot;user_123&quot;</span>)
              {"\n\n"}
              system_prompt = <span className="text-[#3b6d11]">{`f"""You are a coaching assistant.\n\n<core_memory>\n{core.to_xml()}\n</core_memory>\n"""`}</span>
            </pre>
          </div>
          <div className="mt-2 flex gap-2 rounded-lg border border-border bg-bg2 px-[13px] py-2.5 text-[12px] leading-relaxed text-muted">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-0.5 shrink-0 text-subtle" aria-hidden>
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1" />
              <line x1="7" y1="6" x2="7" y2="10" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="7" cy="4.5" r="0.7" fill="currentColor" />
            </svg>
            <span>
              Core memory injection is the developer&apos;s responsibility. The SDK provides a helper. MCP mode handles it
              automatically.
            </span>
          </div>
        </section>
      </div>
    </>
  );
}

function WorkingStep5({ form, name }: { form: WorkingMemoryForm; name: string }) {
  const maxTtlLabel = WORKING_MAX_TTL_OPTIONS.find((o) => o.value === form.maxTtl)?.label ?? form.maxTtl;
  const sweepLabel = form.sweepEnabled ? form.sweepSchedule : "Disabled";
  return (
    <>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em]" style={{ color: W_MID }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <polyline points="2,6 5,9 10,3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        Step 5 · Confirm
      </div>
      <h1 className="text-[18px] font-medium tracking-[-0.02em] text-ink">Review and create</h1>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-subtle">
        Your Working memory instance will be live immediately after creation. All settings can be changed later.
      </p>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-bg">
        <div className="flex items-start gap-3 border-b border-border px-4 py-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#faeeda]" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="2" y="4" width="14" height="10" rx="2" stroke="#854f0b" strokeWidth="1.2" />
              <line x1="5.5" y1="4" x2="5.5" y2="14" stroke="#854f0b" strokeWidth="1.2" opacity="0.5" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium text-ink">{name.trim() || "Untitled"}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded bg-[#faeeda] px-1.5 py-0.5 text-[10px] font-medium text-[#854f0b]">Working</span>
              <span className="text-subtle">· Live immediately after creation</span>
            </div>
          </div>
        </div>
        {(
          [
            ["Default key TTL", form.ttlDisplay.label],
            ["Max key TTL", maxTtlLabel],
            ["Sweep worker", sweepLabel],
            ["Max keys per session", `${form.maxKeysPerSession} keys`],
            ["Self-editing / core memory", form.reviewSelfEditingLabel],
            ["__core__ expiry", "∞ Persistent (no TTL)"],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 border-b border-border px-4 py-2.5 text-[12px] last:border-b-0">
            <span className="text-subtle">{k}</span>
            <span className="max-w-[58%] text-right font-medium leading-snug text-ink">{v}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-col items-stretch justify-between gap-3 rounded-xl border border-[#fac775] bg-[#faeeda] px-4 py-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[#412402]">Cost estimate</div>
          <div className="mt-0.5 text-[12px] text-[#633806]">
            No embedding cost. No LLM cost. Pure storage — charged at PostgreSQL storage rate only.
          </div>
          <div className="mt-1 text-[11px] text-[#854f0b]">~$0.00 per 10,000 key writes · Cheapest memory type</div>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <div className="text-[20px] font-medium" style={{ color: W }}>
            ~$0.00
          </div>
          <div className="text-[12px] font-normal text-muted">/10K writes</div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-border bg-bg px-4 py-3.5">
        <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Quick API reference</div>
        <pre className="overflow-x-auto rounded-lg bg-bg2 px-3.5 py-2.5 font-mono text-[11px] leading-[1.7] text-muted">
          <span className="text-subtle"># Write a key</span>
          {"\n"}
          <span className="text-[#185fa5]">PUT</span> /api/v1/instances/<span className="text-[#3b6d11]">:id</span>/sessions/
          <span className="text-[#3b6d11]">:session_id</span>/keys/<span className="text-[#3b6d11]">:key</span>
          {"\n"}
          {"{ "}
          <span className="text-[#993556]">&quot;value&quot;</span>: <span className="text-[#3b6d11]">&quot;any JSON&quot;</span>,{" "}
          <span className="text-[#993556]">&quot;ttl_seconds&quot;</span>: <span className="text-[#3b6d11]">900</span> {"}"}
          {"\n\n"}
          <span className="text-subtle"># Read a key</span>
          {"\n"}
          <span className="text-[#185fa5]">GET</span> /api/v1/instances/<span className="text-[#3b6d11]">:id</span>/sessions/
          <span className="text-[#3b6d11]">:session_id</span>/keys/<span className="text-[#3b6d11]">:key</span>
          {"\n\n"}
                          <span className="text-subtle"># List all keys in session</span>
          {"\n"}
          <span className="text-[#185fa5]">GET</span> /api/v1/instances/<span className="text-[#3b6d11]">:id</span>/sessions/
          <span className="text-[#3b6d11]">:session_id</span>/keys{"\n\n"}
          <span className="text-subtle"># Flush a session</span>
          {"\n"}
          <span className="text-[#185fa5]">DELETE</span> /api/v1/instances/<span className="text-[#3b6d11]">:id</span>/sessions/
          <span className="text-[#3b6d11]">:session_id</span>
        </pre>
      </div>

      <div className="mt-3 rounded-xl border border-border bg-bg px-4 py-3.5">
        <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">After creation</div>
        {(
          [
            <>
              <strong className="font-medium text-ink">Instance is live.</strong> Write your first key:{" "}
              <code className="whitespace-nowrap rounded bg-bg2 px-1 py-0.5 font-mono text-[10px]">
                PUT /instances/:id/sessions/sess_001/keys/current_topic
              </code>
            </>,
            <>
              <strong className="font-medium text-ink">Use session_id</strong> matching your application&apos;s session
              identifier. Keys are automatically isolated per session.
            </>,
            <>
              <strong className="font-medium text-ink">Write __core__ once</strong> per user. It persists across sessions
              and is never expired by the sweep worker.
            </>,
            <>
              <strong className="font-medium text-ink">Attach to an Agent</strong> as a layer with role{" "}
              <code className="rounded bg-bg2 px-1 py-0.5 font-mono text-[10px]">session</code> or{" "}
              <code className="rounded bg-bg2 px-1 py-0.5 font-mono text-[10px]">core_memory</code> for unified
              multi-memory queries.
            </>,
          ]
        ).map((content, i) => (
          <div key={i} className="mb-2.5 flex gap-2.5 text-[12px] text-muted last:mb-0">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#854f0b] text-[10px] font-semibold text-white">
              {i + 1}
            </span>
            <div className="min-w-0 leading-snug">{content}</div>
          </div>
        ))}
      </div>
    </>
  );
}
