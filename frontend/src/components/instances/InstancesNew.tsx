"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { InstancesShell } from "@/components/instances/InstancesShell";
import {
  billingMeRequest,
  createInstance,
  ingestInstance,
  ingestInstanceFile,
  listInstances,
  type BillingMeData,
  type MeUser,
} from "@/lib/api";
import { getToken } from "@/lib/token";
import clsx from "clsx";

type MemoryKind = "rag" | "wiki" | "episodic";

const STANDARD_STEP_LABELS = ["Memory type", "Configuration", "Ingest & sources", "Confirm & create"] as const;
const EPISODIC_STEP_LABELS = ["Basics", "Decay", "Bi-temporal", "Scoping", "Review & create"] as const;

const MEMORY_TYPES: Array<{
  id: MemoryKind;
  name: string;
  badge?: string;
  bg: string;
  col: string;
  desc: string;
}> = [
  {
    id: "wiki",
    name: "Wiki",
    badge: "Popular",
    bg: "#eeedfe",
    col: "#534ab7",
    desc: "Concept hypotheses with full lineage",
  },
  {
    id: "rag",
    name: "RAG",
    bg: "#e6f1fb",
    col: "#185fa5",
    desc: "Vector search over documents",
  },
  {
    id: "episodic",
    name: "Episodic",
    bg: "#eaf3de",
    col: "#3b6d11",
    desc: "Chronological memory with decay",
  },
];

/** Default model ids stored in instance config; runtime follows server settings. */
const DEFAULT_INSTANCE_MODEL_REFS = {
  extraction_model: "openai/gpt-4o-mini",
  embedding_model: "openai/text-embedding-3-small",
} as const;
const EPISODIC_EMBEDDING_MODELS = [
  "text-embedding-3-large",
  "text-embedding-3-small",
] as const;
const WIKI_CONCEPTS = ["fact", "entity", "event", "goal", "belief", "tension", "project", "pattern"] as const;
const GARDENER_SCHEDULES = ["Every 24 hours", "Every 12 hours", "Manual only"] as const;
const EPISODIC_DECAY_SCHEDULES = ["Every 24 hours (recommended)", "Every 12 hours", "Every 6 hours", "Manual only"] as const;
const EPISODIC_INVALIDATION_OPTIONS = [
  { value: "close", label: "Close valid_until — mark as no longer valid (recommended)" },
  { value: "archive", label: "Archive the episode — keep in history, exclude from active queries" },
  { value: "delete", label: "Hard delete — remove permanently" },
] as const;
const EPISODIC_RETENTION_OPTIONS = [
  { value: "never", label: "Never auto-delete (manual only)" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "1 year" },
  { value: "730", label: "2 years" },
] as const;

function episodicDecayColor(weight: number): string {
  if (weight >= 0.5) return "#3b6d11";
  if (weight >= 0.2) return "#ba7517";
  return "#d3d1c7";
}

function StepDot({ done, active, n }: { done: boolean; active: boolean; n: number }) {
  if (done) {
    return (
      <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-ink bg-ink text-bg">
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
          <polyline points="1,4 3,6 7,2" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </div>
    );
  }
  return (
    <div
      className={clsx(
        "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border bg-bg text-[10px] font-medium",
        active ? "border-ink text-ink" : "border-border text-muted",
      )}
    >
      {n}
    </div>
  );
}

function Toggle({ on, onToggle, id }: { on: boolean; onToggle: () => void; id: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={clsx("relative h-[18px] w-8 shrink-0 rounded-full transition-colors", on ? "bg-ink" : "bg-border2")}
    >
      <span
        className={clsx(
          "absolute top-[3px] h-3 w-3 rounded-full bg-bg shadow-sm transition-[left]",
          on ? "left-[17px]" : "left-[3px]",
        )}
      />
    </button>
  );
}

function defaultConcepts(): Record<(typeof WIKI_CONCEPTS)[number], boolean> {
  const o = {} as Record<(typeof WIKI_CONCEPTS)[number], boolean>;
  for (const c of WIKI_CONCEPTS) {
    o[c] = ["fact", "entity", "event", "goal", "belief"].includes(c);
  }
  return o;
}

export function InstancesNew({ user, onLogout }: { user: MeUser; onLogout?: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = getToken() ?? "";
  const requestedType = searchParams.get("type");
  const defaultType: MemoryKind =
    requestedType === "rag" || requestedType === "wiki" || requestedType === "episodic" ? requestedType : "wiki";

  const [step, setStep] = useState(1);
  const [memoryType, setMemoryType] = useState<MemoryKind>(defaultType);
  const [name, setName] = useState("Product Knowledge Base");
  const [episodicDescription, setEpisodicDescription] = useState(
    "Chronological memory for AI coaching sessions. Stores user conversations, mood check-ins, and progress notes per user.",
  );
  const [episodicUseCase, setEpisodicUseCase] = useState<"coach" | "support" | "personal">("coach");
  const [episodicEmbeddingModel, setEpisodicEmbeddingModel] = useState<(typeof EPISODIC_EMBEDDING_MODELS)[number]>(
    "text-embedding-3-large",
  );
  const [decayRate, setDecayRate] = useState(14);
  const [decayWorkerEnabled, setDecayWorkerEnabled] = useState(true);
  const [decaySchedule, setDecaySchedule] = useState<string>(EPISODIC_DECAY_SCHEDULES[0]);
  const [retrievalThreshold, setRetrievalThreshold] = useState(12);
  const [biTemporalEnabled, setBiTemporalEnabled] = useState(true);
  const [pointInTimeEnabled, setPointInTimeEnabled] = useState(true);
  const [invalidationMode, setInvalidationMode] =
    useState<(typeof EPISODIC_INVALIDATION_OPTIONS)[number]["value"]>("close");
  const [gdprDeletionEnabled, setGdprDeletionEnabled] = useState(true);
  const [episodicRetention, setEpisodicRetention] = useState<(typeof EPISODIC_RETENTION_OPTIONS)[number]["value"]>(
    "never",
  );
  const [conceptPick, setConceptPick] = useState(defaultConcepts);
  const [gardenerEnabled, setGardenerEnabled] = useState(true);
  const [gardenerSchedule, setGardenerSchedule] = useState<string>(GARDENER_SCHEDULES[0]);
  const [userScoping, setUserScoping] = useState(true);
  const [sessionScoping, setSessionScoping] = useState(false);
  const [chunkSize, setChunkSize] = useState(512);
  const [chunkOverlap, setChunkOverlap] = useState(64);
  const [hierarchicalClustering, setHierarchicalClustering] = useState(true);

  const [seedText, setSeedText] = useState("");
  const [wizFiles, setWizFiles] = useState<File[]>([]);

  const [billing, setBilling] = useState<BillingMeData | null>(null);
  const [instanceTotal, setInstanceTotal] = useState(0);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isEpisodicWizard = memoryType === "episodic" && requestedType === "episodic";
  const stepLabels = isEpisodicWizard ? EPISODIC_STEP_LABELS : STANDARD_STEP_LABELS;
  const maxStep = stepLabels.length;
  const decayRateDaily = useMemo(() => decayRate / 100, [decayRate]);
  const decayHalfLifeDays = useMemo(() => Math.round(Math.log(2) / Math.max(decayRateDaily, 0.0001)), [decayRateDaily]);
  const decayBars = useMemo(() => {
    const days = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90];
    return days.map((day) => {
      const weight = Math.exp(-decayRateDaily * day);
      return {
        day,
        weight,
        height: Math.max(4, Math.round(weight * 56) + 2),
        color: episodicDecayColor(weight),
      };
    });
  }, [decayRateDaily]);

  useEffect(() => {
    const t = searchParams.get("type");
    if (t === "rag" || t === "wiki" || t === "episodic") {
      setMemoryType(t);
      setStep(1);
      if (t === "episodic") {
        setName("Coach Bot History");
      }
    }
  }, [searchParams]);

  useEffect(() => {
    if (!token) return;
    billingMeRequest(token).then(setBilling).catch(() => setBilling(null));
    listInstances(token).then((l) => setInstanceTotal(l.length)).catch(() => setInstanceTotal(0));
  }, [token]);

  const buildConfig = useCallback(() => {
    const base = {
      ...DEFAULT_INSTANCE_MODEL_REFS,
      scoping: { user_id: userScoping, session_id: sessionScoping },
    };
    if (memoryType === "episodic") {
      return {
        description: episodicDescription.trim() || undefined,
        use_case: episodicUseCase,
        embedding_model: episodicEmbeddingModel,
        decay: {
          daily_factor: Number(decayRateDaily.toFixed(2)),
          auto_worker: decayWorkerEnabled,
          schedule: decaySchedule,
          retrieval_threshold: Number((retrievalThreshold / 100).toFixed(2)),
        },
        bi_temporal: {
          enabled: biTemporalEnabled,
          point_in_time: pointInTimeEnabled,
          invalidation_mode: invalidationMode,
        },
        scoping: {
          user_id: userScoping,
          session_id: sessionScoping,
          gdpr_delete: gdprDeletionEnabled,
        },
        retention: {
          max_age_days: episodicRetention === "never" ? null : Number(episodicRetention),
        },
      };
    }
    if (memoryType === "wiki") {
      return {
        ...base,
        concept_types: WIKI_CONCEPTS.filter((c) => conceptPick[c]),
        gardener: { enabled: gardenerEnabled, schedule: gardenerSchedule },
        auto_extract: true,
      };
    }
    return {
      ...base,
      chunking: { chunk_size_tokens: chunkSize, overlap_tokens: chunkOverlap },
      features: { hierarchical_clustering: hierarchicalClustering },
    };
  }, [
    biTemporalEnabled,
    chunkOverlap,
    chunkSize,
    conceptPick,
    decayRateDaily,
    decaySchedule,
    decayWorkerEnabled,
    episodicDescription,
    episodicEmbeddingModel,
    episodicRetention,
    episodicUseCase,
    gardenerEnabled,
    gardenerSchedule,
    gdprDeletionEnabled,
    hierarchicalClustering,
    invalidationMode,
    memoryType,
    pointInTimeEnabled,
    retrievalThreshold,
    sessionScoping,
    userScoping,
  ]);

  const configPayload = useMemo(() => {
    const c = buildConfig() as Record<string, unknown>;
    if (!isEpisodicWizard && seedText.trim()) {
      c.seed_draft_text = seedText.trim();
    }
    return c;
  }, [buildConfig, isEpisodicWizard, seedText]);

  function addWizFilesFromList(fileList: FileList | File[]) {
    const list = Array.from(fileList);
    if (list.length === 0) return;
    setWizFiles((prev) => [...prev, ...list]);
  }

  function removeWizFile(i: number) {
    setWizFiles((prev) => prev.filter((_, j) => j !== i));
  }

  function canContinue(): boolean {
    if (isEpisodicWizard && step === 1) return name.trim().length > 0;
    if (!isEpisodicWizard && step === 2) return name.trim().length > 0;
    return true;
  }

  function goNext() {
    if (!canContinue()) return;
    setErr(null);
    setStep((s) => Math.min(maxStep, s + 1));
  }

  function goBack() {
    setErr(null);
    setStep((s) => Math.max(1, s - 1));
  }

  async function onCreate() {
    if (!token || !name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const id = await createInstance(token, {
        name: name.trim(),
        memory_type: memoryType,
        config: configPayload,
      });
      const failures: string[] = [];
      if (!isEpisodicWizard) {
        const st = seedText.trim();
        if (st) {
          try {
            if (memoryType === "wiki") {
              await ingestInstance(token, id, { text: st, source_title: "Wizard seed" });
            } else {
              await ingestInstance(token, id, { text: st, source_label: "wizard-seed" });
            }
          } catch (e) {
            failures.push(`Seed text: ${e instanceof Error ? e.message : "failed"}`);
          }
        }
        for (const file of wizFiles) {
          try {
            await ingestInstanceFile(token, id, file);
          } catch (e) {
            failures.push(`${file.name}: ${e instanceof Error ? e.message : "upload failed"}`);
          }
        }
      }
      if (failures.length > 0) {
        window.alert(
          `Instance was created, but some wizard ingests failed:\n\n${failures.join("\n")}\n\nYou can retry from the Playground.`,
        );
      }
      router.push(`/instances/${id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create instance");
    } finally {
      setSaving(false);
    }
  }

  const typeMeta = MEMORY_TYPES.find((t) => t.id === memoryType)!;
  const planLine =
    billing?.plan != null
      ? `${billing.plan.name} (${instanceTotal}/${billing.plan.max_instances} instances)`
      : instanceTotal > 0
        ? `${instanceTotal} instance(s)`
        : "—";

  const headerTitle = (
    <span className="flex items-center gap-1.5 text-[12px] font-normal text-muted">
      <Link href="/instances" className="hover:text-ink">
        Instances
      </Link>
      <span className="text-border2">›</span>
      <span className="font-medium text-ink">New instance</span>
    </span>
  );

  return (
    <InstancesShell
      user={user}
      onLogout={onLogout}
      title={headerTitle}
      headerRight={
        <Link href="/instances" className="text-[12px] font-medium text-accent hover:underline">
          ← Back to list
        </Link>
      }
    >
      <div className="flex min-h-0 flex-1">
        {/* Setup steps — design/03-create-instance.html */}
        <aside className="w-[200px] shrink-0 border-r border-border bg-bg px-4 py-6">
          <div className="mb-4 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">Setup steps</div>
          <ul className="space-y-0">
            {stepLabels.map((label, i) => {
              const n = i + 1;
              const done = step > n;
              const active = step === n;
              const isLast = i === stepLabels.length - 1;
              return (
                <li key={label} className={clsx("relative flex gap-2.5", !isLast ? "pb-6" : "")}>
                  {!isLast ? (
                    <span
                      className="absolute left-[10px] top-[28px] h-[calc(100%-12px)] w-px bg-border"
                      aria-hidden
                    />
                  ) : null}
                  <StepDot done={done} active={active} n={n} />
                  <span
                    className={clsx(
                      "max-w-[130px] pt-[3px] text-[12px] leading-snug",
                      active ? "font-medium text-ink" : done ? "text-muted" : "text-subtle",
                    )}
                  >
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-7 py-7">
            {!isEpisodicWizard && step === 1 ? (
              <>
                <h1 className="text-base font-medium tracking-tight text-ink">Choose memory type</h1>
                <p className="mt-1 text-[13px] text-muted">Select the type of memory that fits your use case.</p>
                <div className="mt-7 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {MEMORY_TYPES.filter((t) => t.id !== "episodic").map((t) => {
                    const sel = memoryType === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setMemoryType(t.id)}
                        className={clsx(
                          "relative rounded-[12px] border bg-bg p-3.5 text-left transition-colors",
                          sel ? "border-2 border-ink" : "border border-border hover:border-border2",
                        )}
                      >
                        <div
                          className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-[7px]"
                          style={{ background: t.bg }}
                        >
                          <span className="h-3.5 w-3.5 rounded-full" style={{ background: t.col }} />
                        </div>
                        <div className="text-[13px] font-medium text-ink">{t.name}</div>
                        <div className="mt-1 text-[11px] leading-snug text-subtle">{t.desc}</div>
                        {t.badge && !sel ? (
                          <span className="absolute right-2.5 top-2.5 rounded bg-[#eeedfe] px-1.5 py-0.5 text-[9px] font-medium text-[#534ab7]">
                            {t.badge}
                          </span>
                        ) : null}
                        {sel ? (
                          <span className="absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink">
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
                              <polyline points="1,4 3,6 7,2" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
                            </svg>
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}

            {isEpisodicWizard && step === 1 ? (
              <>
                <h1 className="text-base font-medium tracking-tight text-ink">Name your instance</h1>
                <p className="mt-1 text-[13px] text-muted">
                  Episodic memory stores timestamped episodes from interactions, like a chronological journal.
                </p>

                <section className="mt-6">
                  <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                    Identity
                  </h2>
                  <div className="space-y-3.5">
                    <div>
                      <label className="mb-1.5 block text-[12px] text-muted" htmlFor="episodic-name">
                        Instance name
                      </label>
                      <input
                        id="episodic-name"
                        className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-2.5 text-[13px] text-ink outline-none focus:border-[#3b6d11]"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="off"
                        maxLength={128}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[12px] text-muted" htmlFor="episodic-desc">
                        Description
                      </label>
                      <textarea
                        id="episodic-desc"
                        className="min-h-[66px] w-full resize-y rounded-lg border border-border2 bg-bg px-2.5 py-2 text-[12px] leading-relaxed text-ink outline-none focus:border-[#3b6d11]"
                        value={episodicDescription}
                        onChange={(e) => setEpisodicDescription(e.target.value)}
                      />
                    </div>
                  </div>
                </section>

                <section className="mt-6">
                  <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                    Embedding model
                  </h2>
                  <label className="mb-1.5 block text-[12px] text-muted" htmlFor="episodic-embed">
                    Model
                  </label>
                  <select
                    id="episodic-embed"
                    className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-2.5 text-[12px] text-ink outline-none focus:border-[#3b6d11]"
                    value={episodicEmbeddingModel}
                    onChange={(e) =>
                      setEpisodicEmbeddingModel(e.target.value as (typeof EPISODIC_EMBEDDING_MODELS)[number])
                    }
                  >
                    {EPISODIC_EMBEDDING_MODELS.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 rounded-lg border border-[#c8d8f0] bg-[#f0f4fb] px-3 py-2 text-[12px] text-[#1d3a6b]">
                    Episodic memory stores episodes as-is with embeddings only. No extraction model needed.
                  </p>
                </section>

                <section className="mt-6">
                  <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                    Use case preview
                  </h2>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    {(
                      [
                        ["coach", "AI Coach / Therapist", "Track sessions, mood and long-term progress."],
                        ["support", "Support Agent", "Remember past tickets and user complaints."],
                        ["personal", "Personal Assistant", "Keep conversation history and preferences."],
                      ] as const
                    ).map(([id, title, desc]) => {
                      const selected = episodicUseCase === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setEpisodicUseCase(id)}
                          className={clsx(
                            "rounded-lg border px-3 py-2 text-left transition-colors",
                            selected ? "border-[#3b6d11] bg-[#eaf3de]" : "border-border hover:border-border2",
                          )}
                        >
                          <div className="text-[12px] font-medium text-ink">{title}</div>
                          <p className="mt-0.5 text-[11px] text-subtle">{desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </>
            ) : null}

            {isEpisodicWizard && step === 2 ? (
              <>
                <h1 className="text-base font-medium tracking-tight text-ink">How fast should old memories fade?</h1>
                <p className="mt-1 text-[13px] text-muted">
                  Decay reduces retrieval weight for older episodes. Recent episodes surface first; old ones stay queryable.
                </p>

                <section className="mt-6">
                  <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                    Decay rate
                  </h2>
                  <div className="mb-1 flex items-center justify-between text-[12px] text-muted">
                    <span>Daily decay factor</span>
                    <span className="font-medium text-[#3b6d11]">{decayRateDaily.toFixed(2)} / day</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={30}
                    value={decayRate}
                    onChange={(e) => setDecayRate(Number(e.target.value))}
                    className="w-full accent-[#3b6d11]"
                  />
                  <div className="mt-1 flex justify-between text-[10px] text-subtle">
                    <span>Slow (0.01)</span>
                    <span>Medium (0.10)</span>
                    <span>Fast (0.30)</span>
                  </div>

                  <div className="mt-3 rounded-[12px] border border-border bg-bg px-4 py-3">
                    <div className="mb-2.5 flex items-center justify-between text-[11px] text-muted">
                      <span>Decay preview — weight over time</span>
                      <span>Half-life: ~{decayHalfLifeDays} days</span>
                    </div>
                    <div className="mb-2 flex h-[64px] items-end gap-1">
                      {decayBars.map((bar) => (
                        <div
                          key={bar.day}
                          title={`Day ${bar.day}: ${bar.weight.toFixed(2)}`}
                          className="min-w-[5px] flex-1 rounded-t-sm transition-all duration-200 ease-out"
                          style={{
                            height: `${bar.height}px`,
                            backgroundColor: bar.color,
                            opacity: 0.4 + bar.weight * 0.6,
                          }}
                        />
                      ))}
                    </div>
                    <div className="flex justify-between text-[9px] text-subtle">
                      <span>Today</span>
                      <span>1 week</span>
                      <span>1 month</span>
                      <span>3 months</span>
                    </div>
                  </div>
                </section>

                <section className="mt-6">
                  <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                    Decay schedule
                  </h2>
                  <div className="flex items-center justify-between border-b border-border py-2">
                    <div>
                      <div className="text-[13px] text-ink">Automatic decay worker</div>
                      <div className="text-[11px] text-subtle">Runs periodically to recalculate episode weights.</div>
                    </div>
                    <Toggle id="episodic-decay-auto" on={decayWorkerEnabled} onToggle={() => setDecayWorkerEnabled((v) => !v)} />
                  </div>
                  <div className="mt-3">
                    <label className="mb-1.5 block text-[12px] text-muted" htmlFor="episodic-schedule">
                      Run schedule
                    </label>
                    <select
                      id="episodic-schedule"
                      className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-2.5 text-[12px]"
                      value={decaySchedule}
                      onChange={(e) => setDecaySchedule(e.target.value)}
                    >
                      {EPISODIC_DECAY_SCHEDULES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </section>

                <section className="mt-6">
                  <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                    Retrieval threshold
                  </h2>
                  <div className="mb-1 flex items-center justify-between text-[12px] text-muted">
                    <span>Minimum weight in results</span>
                    <span className="font-medium text-[#3b6d11]">weight ≥ {(retrievalThreshold / 100).toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={40}
                    value={retrievalThreshold}
                    onChange={(e) => setRetrievalThreshold(Number(e.target.value))}
                    className="w-full accent-[#3b6d11]"
                  />
                </section>
              </>
            ) : null}

            {isEpisodicWizard && step === 3 ? (
              <>
                <h1 className="text-base font-medium tracking-tight text-ink">Two timelines for every episode</h1>
                <p className="mt-1 text-[13px] text-muted">
                  Bi-temporal facts track real-world valid time and system recording time independently.
                </p>

                <section className="mt-6">
                  <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                    Enable bi-temporal
                  </h2>
                  <div className="flex items-center justify-between border-b border-border py-2">
                    <div>
                      <div className="text-[13px] text-ink">Bi-temporal facts</div>
                      <div className="text-[11px] text-subtle">Store valid_from/valid_until for point-in-time queries.</div>
                    </div>
                    <Toggle id="episodic-bitemp" on={biTemporalEnabled} onToggle={() => setBiTemporalEnabled((v) => !v)} />
                  </div>
                </section>

                <section className={clsx("mt-6 space-y-6 transition-opacity", biTemporalEnabled ? "opacity-100" : "pointer-events-none opacity-50")}>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border bg-bg px-3 py-2.5">
                      <div className="text-[11px] font-medium text-muted">Valid time</div>
                      <p className="mt-1 text-[12px] text-subtle">When an event actually happened in the real world.</p>
                    </div>
                    <div className="rounded-lg border border-border bg-bg px-3 py-2.5">
                      <div className="text-[11px] font-medium text-muted">System time</div>
                      <p className="mt-1 text-[12px] text-subtle">When your system recorded the episode.</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-b border-border py-2">
                    <div>
                      <div className="text-[13px] text-ink">Enable historical projection</div>
                      <div className="text-[11px] text-subtle">Allow queries with as_of date snapshots.</div>
                    </div>
                    <Toggle id="episodic-pit" on={pointInTimeEnabled} onToggle={() => setPointInTimeEnabled((v) => !v)} />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[12px] text-muted" htmlFor="episodic-invalidation">
                      Invalidation behaviour
                    </label>
                    <select
                      id="episodic-invalidation"
                      className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-2.5 text-[12px]"
                      value={invalidationMode}
                      onChange={(e) =>
                        setInvalidationMode(e.target.value as (typeof EPISODIC_INVALIDATION_OPTIONS)[number]["value"])
                      }
                    >
                      {EPISODIC_INVALIDATION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </section>
              </>
            ) : null}

            {isEpisodicWizard && step === 4 ? (
              <>
                <h1 className="text-base font-medium tracking-tight text-ink">Isolate memory per user or session</h1>
                <p className="mt-1 text-[13px] text-muted">
                  One Episodic instance can serve many users with user_id and optional session_id scoping.
                </p>
                <section className="mt-6">
                  <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                    Scoping mode
                  </h2>
                  <div className="flex items-center justify-between border-b border-border py-2">
                    <div>
                      <div className="text-[13px] text-ink">Enable user_id scoping</div>
                      <div className="text-[11px] text-subtle">User queries see own episodes plus global episodes.</div>
                    </div>
                    <Toggle id="episodic-user-scope" on={userScoping} onToggle={() => setUserScoping((v) => !v)} />
                  </div>
                  <div className="flex items-center justify-between border-b border-border py-2">
                    <div>
                      <div className="text-[13px] text-ink">Enable session_id scoping</div>
                      <div className="text-[11px] text-subtle">Further isolate episodes inside a conversation session.</div>
                    </div>
                    <Toggle id="episodic-session-scope" on={sessionScoping} onToggle={() => setSessionScoping((v) => !v)} />
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <div className="text-[13px] text-ink">Enable per-user deletion (GDPR)</div>
                      <div className="text-[11px] text-subtle">Allow deleting all episodes for a specific user scope.</div>
                    </div>
                    <Toggle id="episodic-gdpr" on={gdprDeletionEnabled} onToggle={() => setGdprDeletionEnabled((v) => !v)} />
                  </div>
                </section>

                <section className="mt-6">
                  <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                    Retention policy
                  </h2>
                  <label className="mb-1.5 block text-[12px] text-muted" htmlFor="episodic-retention">
                    Maximum episode age
                  </label>
                  <select
                    id="episodic-retention"
                    className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-2.5 text-[12px]"
                    value={episodicRetention}
                    onChange={(e) =>
                      setEpisodicRetention(e.target.value as (typeof EPISODIC_RETENTION_OPTIONS)[number]["value"])
                    }
                  >
                    {EPISODIC_RETENTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </section>
              </>
            ) : null}

            {isEpisodicWizard && step === 5 ? (
              <>
                <h1 className="text-base font-medium tracking-tight text-ink">Review and create</h1>
                <p className="mt-1 text-[13px] text-muted">
                  Your Episodic instance will be ready immediately. You can change settings later.
                </p>

                <div className="mt-6 rounded-[12px] border border-border bg-bg px-4 py-3">
                  {(
                    [
                      ["Memory type", "Episodic"],
                      ["Name", name.trim() || "—"],
                      ["Embedding model", episodicEmbeddingModel],
                      ["Decay rate", `${decayRateDaily.toFixed(2)} / day · ~${decayHalfLifeDays} days half-life`],
                      ["Decay worker", decayWorkerEnabled ? decaySchedule : "Disabled"],
                      ["Bi-temporal facts", biTemporalEnabled ? "Enabled" : "Disabled"],
                      ["Point-in-time queries", pointInTimeEnabled ? "Enabled" : "Disabled"],
                      ["Invalidation", EPISODIC_INVALIDATION_OPTIONS.find((x) => x.value === invalidationMode)?.label ?? "—"],
                      ["user_id scoping", userScoping ? "Enabled" : "Disabled"],
                      ["session_id scoping", sessionScoping ? "Enabled" : "Disabled"],
                      ["GDPR deletion endpoint", gdprDeletionEnabled ? "Enabled" : "Disabled"],
                      ["Retention policy", EPISODIC_RETENTION_OPTIONS.find((x) => x.value === episodicRetention)?.label ?? "—"],
                      ["Plan", planLine],
                    ] as const
                  ).map(([k, v]) => (
                    <div
                      key={k}
                      className="flex items-center justify-between border-b border-border py-1.5 text-[12px] last:border-0"
                    >
                      <span className="text-subtle">{k}</span>
                      <span className="max-w-[60%] text-right font-medium text-ink">{v}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between rounded-lg border border-[#8ec95c] bg-[#eaf3de] px-3.5 py-3">
                  <div>
                    <div className="text-[12px] text-[#2d6b0f]">Cost estimate</div>
                    <div className="text-[10px] text-[#2d6b0f]/80">Embedding only — no extraction model cost</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-[#3b6d11]">~$0.002</div>
                    <div className="text-[10px] text-[#2d6b0f]/80">/1K episodes</div>
                  </div>
                </div>

                {err ? (
                  <div className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-xs text-error">
                    {err}
                  </div>
                ) : null}
              </>
            ) : null}

            {!isEpisodicWizard && step === 2 ? (
              <>
                <h1 className="text-base font-medium tracking-tight text-ink">Configure {typeMeta.name} memory</h1>
                <p className="mt-1 text-[13px] text-muted">Customize the instance settings. You can change these later.</p>

                <div className="mt-6 space-y-6">
                  <section>
                    <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                      Basic
                    </h2>
                    <div className="space-y-3.5">
                      <div>
                        <label className="mb-1.5 block text-[12px] text-muted" htmlFor="wiz-name">
                          Instance name
                        </label>
                        <input
                          id="wiz-name"
                          className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-2.5 text-[13px] text-ink outline-none focus:border-[#888]"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          autoComplete="off"
                          maxLength={128}
                        />
                      </div>
                    </div>
                  </section>

                  {memoryType === "wiki" ? (
                    <section>
                      <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                        Concept types
                      </h2>
                      <div className="flex flex-wrap gap-2">
                        {WIKI_CONCEPTS.map((c) => (
                          <label
                            key={c}
                            className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted"
                          >
                            <input
                              type="checkbox"
                              checked={conceptPick[c]}
                              onChange={() =>
                                setConceptPick((p) => ({
                                  ...p,
                                  [c]: !p[c],
                                }))
                              }
                              className="h-3 w-3 rounded border-border2"
                            />
                            {c}
                          </label>
                        ))}
                      </div>
                    </section>
                  ) : (
                    <section>
                      <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                        Chunking
                      </h2>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <div className="mb-1 flex justify-between text-[12px] text-muted">
                            <span>
                              Chunk size <span className="text-subtle">tokens</span>
                            </span>
                            <span className="font-medium text-ink">{chunkSize}</span>
                          </div>
                          <input
                            type="range"
                            min={256}
                            max={2048}
                            step={64}
                            value={chunkSize}
                            onChange={(e) => setChunkSize(Number(e.target.value))}
                            className="w-full accent-[#1a1a1a]"
                          />
                        </div>
                        <div>
                          <div className="mb-1 flex justify-between text-[12px] text-muted">
                            <span>
                              Overlap <span className="text-subtle">tokens</span>
                            </span>
                            <span className="font-medium text-ink">{chunkOverlap}</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={256}
                            step={16}
                            value={chunkOverlap}
                            onChange={(e) => setChunkOverlap(Number(e.target.value))}
                            className="w-full accent-[#1a1a1a]"
                          />
                        </div>
                      </div>
                      <h2 className="mb-3 mt-6 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                        Features
                      </h2>
                      <div className="flex items-center justify-between border-b border-border py-2 last:border-0">
                        <div>
                          <div className="text-[13px] text-ink">Hierarchical clustering</div>
                          <div className="text-[11px] text-subtle">Group chunks into topic clusters</div>
                        </div>
                        <Toggle
                          id="t-hier"
                          on={hierarchicalClustering}
                          onToggle={() => setHierarchicalClustering((v) => !v)}
                        />
                      </div>
                    </section>
                  )}

                  {memoryType === "wiki" ? (
                    <section>
                      <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                        Gardener
                      </h2>
                      <div className="flex items-center justify-between border-b border-border py-2">
                        <div>
                          <div className="text-[13px] text-ink">Auto-gardener</div>
                          <div className="text-[11px] text-subtle">Automatic triage and proposals</div>
                        </div>
                        <Toggle id="t-gard" on={gardenerEnabled} onToggle={() => setGardenerEnabled((v) => !v)} />
                      </div>
                      <div className="mt-3">
                        <label className="mb-1.5 block text-[12px] text-muted" htmlFor="g-sched">
                          Gardener schedule
                        </label>
                        <select
                          id="g-sched"
                          className="h-[34px] w-full max-w-md rounded-lg border border-border2 bg-bg px-2.5 text-[13px]"
                          value={gardenerSchedule}
                          onChange={(e) => setGardenerSchedule(e.target.value)}
                        >
                          {GARDENER_SCHEDULES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    </section>
                  ) : null}

                  <section>
                    <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                      Scoping
                    </h2>
                    <div className="flex items-center justify-between border-b border-border py-2">
                      <div>
                        <div className="text-[13px] text-ink">Enable user_id scoping</div>
                        <div className="text-[11px] text-subtle">Isolate data per end-user</div>
                      </div>
                      <Toggle id="t-user" on={userScoping} onToggle={() => setUserScoping((v) => !v)} />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div>
                        <div className="text-[13px] text-ink">Enable session_id scoping</div>
                        <div className="text-[11px] text-subtle">Further isolate per session</div>
                      </div>
                      <Toggle id="t-sess" on={sessionScoping} onToggle={() => setSessionScoping((v) => !v)} />
                    </div>
                  </section>
                </div>
              </>
            ) : null}

            {!isEpisodicWizard && step === 3 ? (
              <>
                <h1 className="text-base font-medium tracking-tight text-ink">Ingest &amp; sources</h1>
                <p className="mt-1 text-[13px] text-muted">
                  Optional seed text and files. Files you add here are ingested automatically right after the instance is
                  created.
                </p>

                <section className="mt-6">
                  <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                    Upload files (optional)
                  </h2>
                  <label
                    htmlFor="wiz-seed-files"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.dataTransfer.files?.length) {
                        addWizFilesFromList(e.dataTransfer.files);
                      }
                    }}
                    className="block w-full cursor-pointer rounded-[12px] border-2 border-dashed border-border2 bg-bg px-4 py-4 text-left transition-colors hover:border-[#888] hover:bg-bg2"
                  >
                    <input
                      id="wiz-seed-files"
                      type="file"
                      multiple
                      className="sr-only"
                      onChange={(e) => {
                        if (e.target.files?.length) {
                          addWizFilesFromList(e.target.files);
                        }
                        e.target.value = "";
                      }}
                    />
                    <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-ink">
                      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                        <path
                          d="M6.5 2v8M3.5 7l3-3 3 3"
                          stroke="currentColor"
                          strokeWidth="1.1"
                          strokeLinecap="round"
                        />
                        <path d="M1.5 11.5h10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                      </svg>
                      Drop files or click to browse
                    </div>
                    <p className="text-[11px] text-subtle">
                      Supported types for auto-ingest follow the Playground (e.g. .docx, .txt, .md). Same pipeline as
                      &quot;Upload document&quot; after you create the instance.
                    </p>
                  </label>
                  {wizFiles.length > 0 ? (
                    <ul className="mt-3 space-y-1.5">
                      {wizFiles.map((f, i) => (
                        <li
                          key={`${f.name}-${i}`}
                          className="flex items-center gap-2 rounded-lg bg-bg2 px-2.5 py-1.5 text-[12px]"
                        >
                          <span className="min-w-0 flex-1 truncate font-medium text-ink">{f.name}</span>
                          <button
                            type="button"
                            className="text-subtle hover:text-ink"
                            onClick={() => removeWizFile(i)}
                            aria-label={`Remove ${f.name}`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>

                <section className="mt-6">
                  <h2 className="mb-3 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
                    Quick text ingest (optional)
                  </h2>
                  <textarea
                    className="min-h-[80px] w-full resize-none rounded-lg border border-border2 bg-bg px-2.5 py-2 text-[12px] leading-relaxed text-ink outline-none focus:border-[#888]"
                    placeholder="Paste initial text or markdown to seed the memory…"
                    value={seedText}
                    onChange={(e) => setSeedText(e.target.value)}
                  />
                </section>
              </>
            ) : null}

            {!isEpisodicWizard && step === 4 ? (
              <>
                <h1 className="text-base font-medium tracking-tight text-ink">Confirm and create</h1>
                <p className="mt-1 text-[13px] text-muted">Review your configuration before creating the instance.</p>

                <div className="mt-6 rounded-[12px] border border-border bg-bg px-4 py-3">
                  {(
                    [
                      ["Memory type", typeMeta.name],
                      ["Name", name.trim() || "—"],
                      ["Models", "Mnemoniqa defaults"],
                      ["User_id scoping", userScoping ? "Enabled" : "Disabled"],
                      ["Session_id scoping", sessionScoping ? "Enabled" : "Disabled"],
                      ["Files at create", wizFiles.length ? `${wizFiles.length} file(s) — auto-ingest after Create` : "None"],
                      ["Plan", planLine],
                    ] as const
                  ).map(([k, v]) => (
                    <div
                      key={k}
                      className="flex items-center justify-between border-b border-border py-1.5 text-[12px] last:border-0"
                    >
                      <span className="text-subtle">{k}</span>
                      <span className="max-w-[55%] text-right font-medium text-ink">{v}</span>
                    </div>
                  ))}
                </div>

                {wizFiles.length > 0 ? (
                  <div className="mt-3 rounded-lg bg-bg2 px-3 py-2.5">
                    <div className="mb-1.5 text-[11px] font-medium text-muted">Queued files (upload runs automatically after Create)</div>
                    <ul className="space-y-1 text-[11px] text-ink">
                      {wizFiles.map((f, i) => (
                        <li key={`${f.name}-${i}`}> · {f.name}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-4 flex items-center justify-between rounded-lg bg-bg2 px-3.5 py-3">
                  <div>
                    <div className="text-[12px] text-muted">Estimated cost per 1K queries</div>
                    <div className="text-[10px] text-subtle">Based on default models + conversion</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-ink">~$0.04</div>
                    <div className="text-[10px] text-subtle">+ embedding</div>
                  </div>
                </div>

                <div className="mt-4 rounded-lg bg-[#e6f1fb] px-3.5 py-2.5 text-[12px] leading-snug text-accent">
                  After you click <strong className="font-medium">Create instance</strong>, the wizard ingests any seed text
                  and each queued file into this instance (same API as the Playground). Large files may take a moment; check
                  the instance Playground for status.
                </div>

                {err ? (
                  <div className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-xs text-error">
                    {err}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <footer className="flex shrink-0 items-center justify-between border-t border-border bg-bg px-7 py-3.5">
            <span className="text-[12px] text-subtle">
              Step {step} of {maxStep} — {stepLabels[step - 1]}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={goBack}
                disabled={step === 1}
                className="rounded-lg border border-border2 bg-transparent px-4 py-2 text-[13px] text-muted hover:bg-bg2 disabled:pointer-events-none disabled:opacity-40"
              >
                Back
              </button>
              {step < maxStep ? (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canContinue()}
                  className="rounded-lg bg-ink px-[18px] py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void onCreate()}
                  disabled={saving || !name.trim()}
                  className="rounded-lg bg-ink px-[18px] py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Creating…" : "Create instance"}
                </button>
              )}
            </div>
          </footer>
        </div>
      </div>
    </InstancesShell>
  );
}
