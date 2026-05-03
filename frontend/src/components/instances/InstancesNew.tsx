"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { InstancesShell } from "@/components/instances/InstancesShell";
import {
  GRAPH_STEP_HINTS,
  GRAPH_STEP_LABELS,
  GraphMemoryWizardStep,
  useGraphMemoryForm,
} from "@/components/instances/GraphMemoryWizard";
import { useWorkingMemoryForm, WorkingMemoryWizardStep } from "@/components/instances/WorkingMemoryWizard";
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

type MemoryKind = "rag" | "wiki" | "episodic" | "working" | "graph";

const STANDARD_STEP_LABELS = ["Memory type", "Configuration", "Ingest & sources", "Confirm & create"] as const;
const EPISODIC_STEP_LABELS = ["Basics", "Decay", "Bi-temporal", "Scoping", "Review & create"] as const;
const WORKING_STEP_LABELS = ["Basics", "TTL & expiry", "Session keys", "Self-editing", "Review & create"] as const;
const WORKING_STEP_HINTS = [
  "Name & use case",
  "Key lifetime settings",
  "Key schema & core memory",
  "Agent core memory",
  "Confirm and launch",
] as const;
const EPISODIC_STEP_HINTS = [
  "Name & description",
  "Forgetting curve settings",
  "Time-tracking for facts",
  "user_id & session_id",
  "Confirm and launch",
] as const;

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
  {
    id: "working",
    name: "Working",
    bg: "#faeeda",
    col: "#854f0b",
    desc: "Short-term key-value store with TTL",
  },
];

/** Default model ids stored in instance config; runtime follows server settings. */
const DEFAULT_INSTANCE_MODEL_REFS = {
  extraction_model: "openai/gpt-4o-mini",
  embedding_model: "openai/text-embedding-3-small",
} as const;
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

/** Section titles on episodic wizard steps — match design / screenshots (10px uppercase). */
const EPISODIC_SECTION_TITLE =
  "mb-3 border-b border-border pb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle";

function episodicDecayColor(weight: number): string {
  if (weight >= 0.5) return "#3b6d11";
  if (weight >= 0.2) return "#ba7517";
  return "#d3d1c7";
}

function StepDot({
  done,
  active,
  n,
  variant = "default",
}: {
  done: boolean;
  active: boolean;
  n: number;
  variant?: "default" | "episodic" | "working" | "graph";
}) {
  if (variant === "graph") {
    if (done) {
      return (
        <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#993c1d] text-white">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
            <polyline points="1,4 3,6 7,2" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
      );
    }
    if (active) {
      return (
        <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#993c1d] text-[10px] font-medium text-white">
          {n}
        </div>
      );
    }
    return (
      <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-border bg-bg text-[10px] font-medium text-subtle">
        {n}
      </div>
    );
  }
  if (variant === "working") {
    if (done) {
      return (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#854f0b] bg-[#854f0b] text-white">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
            <polyline points=".5,4 2.5,6 7.5,1.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
      );
    }
    if (active) {
      return (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[#ba7517] bg-[#faeeda] text-[11px] font-medium text-[#854f0b]">
          {n}
        </div>
      );
    }
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-border2 bg-bg text-[11px] font-medium text-subtle">
        {n}
      </div>
    );
  }
  if (variant === "episodic") {
    if (done) {
      return (
        <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#3b6d11] text-white">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
            <polyline points="1,4 3,6 7,2" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
      );
    }
    if (active) {
      return (
        <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#3b6d11] text-[10px] font-medium text-white">
          {n}
        </div>
      );
    }
    return (
      <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-border bg-bg text-[10px] font-medium text-subtle">
        {n}
      </div>
    );
  }
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

function Toggle({
  on,
  onToggle,
  id,
  accent = "ink",
}: {
  on: boolean;
  onToggle: () => void;
  id: string;
  accent?: "ink" | "episodic" | "working";
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
        on
          ? accent === "episodic"
            ? "bg-[#3b6d11]"
            : accent === "working"
              ? "bg-[#854f0b]"
              : "bg-ink"
          : "bg-border2",
      )}
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
    requestedType === "rag" ||
    requestedType === "wiki" ||
    requestedType === "episodic" ||
    requestedType === "working"
      ? requestedType
      : "wiki";

  const [step, setStep] = useState(1);
  const [memoryType, setMemoryType] = useState<MemoryKind>(defaultType);
  const workingForm = useWorkingMemoryForm();
  const graphForm = useGraphMemoryForm();
  const [name, setName] = useState("Product Knowledge Base");
  const [episodicDescription, setEpisodicDescription] = useState(
    "Chronological memory for AI coaching sessions. Stores user conversations, mood check-ins, and progress notes per user.",
  );
  const [decayRate, setDecayRate] = useState(5);
  const [decayWorkerEnabled, setDecayWorkerEnabled] = useState(true);
  const [decaySchedule, setDecaySchedule] = useState<string>(EPISODIC_DECAY_SCHEDULES[0]);
  const [retrievalThreshold, setRetrievalThreshold] = useState(10);
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
  const isEpisodicWizard = memoryType === "episodic";
  const isWorkingWizard = memoryType === "working";
  const isGraphWizard = memoryType === "graph";
  const stepLabels = isEpisodicWizard
    ? EPISODIC_STEP_LABELS
    : isWorkingWizard
      ? WORKING_STEP_LABELS
      : isGraphWizard
        ? GRAPH_STEP_LABELS
        : STANDARD_STEP_LABELS;
  const maxStep = stepLabels.length;
  const decayRateDaily = useMemo(() => decayRate / 100, [decayRate]);
  const decayHalfLifeDays = useMemo(() => Math.round(Math.log(2) / Math.max(decayRateDaily, 0.0001)), [decayRateDaily]);
  /** Non-linear day samples: dense early days so the curve spans the chart (linear 0…90 collapsed decay into 1–2 bars). */
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
    if (t === "rag" || t === "wiki" || t === "episodic" || t === "working") {
      setMemoryType(t);
      setStep(1);
      if (t === "episodic") setName("Coach Bot History");
      if (t === "working") setName("Session Context");
      return;
    }
    if (t === "graph") {
      setMemoryType("wiki");
      setStep(1);
      setName("Product Knowledge Base");
    }
  }, [searchParams]);

  useEffect(() => {
    if (!token) return;
    billingMeRequest(token).then(setBilling).catch(() => setBilling(null));
    listInstances(token).then((l) => setInstanceTotal(l.length)).catch(() => setInstanceTotal(0));
  }, [token]);

  const buildConfig = useCallback(() => {
    if (memoryType === "graph") {
      return graphForm.toConfig();
    }
    if (memoryType === "working") {
      return workingForm.toConfig();
    }
    const base = {
      ...DEFAULT_INSTANCE_MODEL_REFS,
      scoping: { user_id: userScoping, session_id: sessionScoping },
    };
    if (memoryType === "episodic") {
      return {
        description: episodicDescription.trim() || undefined,
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
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- graph/working config flows through hook .toConfig() identities
  [
    biTemporalEnabled,
    chunkOverlap,
    chunkSize,
    conceptPick,
    decayRateDaily,
    decaySchedule,
    decayWorkerEnabled,
    episodicDescription,
    episodicRetention,
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
    workingForm.toConfig,
    graphForm.toConfig,
  ]);

  const configPayload = useMemo(() => {
    const c = buildConfig() as Record<string, unknown>;
    if (!isEpisodicWizard && !isWorkingWizard && !isGraphWizard && seedText.trim()) {
      c.seed_draft_text = seedText.trim();
    }
    return c;
  }, [buildConfig, isEpisodicWizard, isWorkingWizard, isGraphWizard, seedText]);

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
    if (isWorkingWizard && step === 1) return name.trim().length > 0;
    if (isGraphWizard && step === 1) return name.trim().length > 0;
    if (isGraphWizard && step === 2) return graphForm.hasValidOntology();
    if (!isEpisodicWizard && !isWorkingWizard && !isGraphWizard && step === 2) return name.trim().length > 0;
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
      if (!isEpisodicWizard && !isWorkingWizard && !isGraphWizard) {
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

  const typeMeta = MEMORY_TYPES.find((t) => t.id === memoryType) ?? MEMORY_TYPES[0];

  function planAllowsMemoryType(id: MemoryKind): boolean {
    const allowed = billing?.plan?.allowed_memory_types;
    if (!billing?.plan || !allowed || allowed.length === 0) return true;
    return allowed.includes(id);
  }

  const planLine =
    billing?.plan != null
      ? `${billing.plan.name} (${instanceTotal}/${billing.plan.max_instances} instances)`
      : instanceTotal > 0
        ? `${instanceTotal} instance(s)`
        : "—";

  const headerTitle = (
    <span className="flex flex-wrap items-center gap-1.5 text-[12px] font-normal text-muted">
      <Link href="/instances" className="hover:text-ink">
        Instances
      </Link>
      <span className="text-border2">›</span>
      {isEpisodicWizard || isWorkingWizard || isGraphWizard ? (
        <>
          <span>New instance</span>
          <span className="text-border2">›</span>
          <span className="font-medium text-ink">
            {isWorkingWizard ? "Working memory" : isGraphWizard ? "Graph memory" : "Episodic memory"}
          </span>
        </>
      ) : (
        <span className="font-medium text-ink">New instance</span>
      )}
    </span>
  );

  return (
    <InstancesShell
      user={user}
      onLogout={onLogout}
      title={headerTitle}
      headerRight={
        isEpisodicWizard || isWorkingWizard || isGraphWizard ? (
          <button
            type="button"
            className="text-[12px] font-medium text-muted hover:text-ink"
            onClick={() => {
              if (window.confirm("Discard this draft and return to the instance list?")) router.push("/instances");
            }}
          >
            ✕ Discard
          </button>
        ) : (
          <Link href="/instances" className="text-[12px] font-medium text-accent hover:underline">
            ← Back to list
          </Link>
        )
      }
    >
      <div className="flex min-h-0 flex-1">
        {/* Setup steps — design/03-create-instance.html */}
        <aside
          className={clsx(
            "shrink-0 border-r border-border bg-bg px-4 py-6",
            isEpisodicWizard || isWorkingWizard || isGraphWizard ? "w-[220px]" : "w-[200px]",
          )}
        >
          <div className="mb-4 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">Setup steps</div>
          <ul className="space-y-0">
            {stepLabels.map((label, i) => {
              const n = i + 1;
              const done = step > n;
              const active = step === n;
              const isLast = i === stepLabels.length - 1;
              const dotVariant = isEpisodicWizard
                ? "episodic"
                : isWorkingWizard
                  ? "working"
                  : isGraphWizard
                    ? "graph"
                    : "default";
              return (
                <li key={label} className={clsx("relative flex gap-2.5", !isLast ? "pb-6" : "")}>
                  {!isLast ? (
                    <span
                      className="absolute left-[10px] top-[28px] h-[calc(100%-12px)] w-px bg-border"
                      aria-hidden
                    />
                  ) : null}
                  <StepDot done={done} active={active} n={n} variant={dotVariant} />
                  <span className="flex min-w-0 flex-1 flex-col pt-[3px]">
                    <span
                      className={clsx(
                        "max-w-[148px] text-[12px] leading-snug",
                        active ? "font-medium text-ink" : done ? "text-muted" : "text-subtle",
                      )}
                    >
                      {label}
                    </span>
                    {isEpisodicWizard && EPISODIC_STEP_HINTS[i] ? (
                      <span className="mt-0.5 max-w-[148px] text-[10px] leading-snug text-subtle">
                        {EPISODIC_STEP_HINTS[i]}
                      </span>
                    ) : null}
                    {isWorkingWizard && WORKING_STEP_HINTS[i] ? (
                      <span className="mt-0.5 max-w-[148px] text-[10px] leading-snug text-subtle">
                        {WORKING_STEP_HINTS[i]}
                      </span>
                    ) : null}
                    {isGraphWizard && GRAPH_STEP_HINTS[i] ? (
                      <span className="mt-0.5 max-w-[148px] text-[10px] leading-snug text-subtle">
                        {GRAPH_STEP_HINTS[i]}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-7 py-7">
            {!isEpisodicWizard && !isWorkingWizard && !isGraphWizard && step === 1 ? (
              <>
                <h1 className="text-base font-medium tracking-tight text-ink">Choose memory type</h1>
                <p className="mt-1 text-[13px] text-muted">Select the type of memory that fits your use case.</p>
                <div className="mt-7 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {MEMORY_TYPES.map((t) => {
                    const sel = memoryType === t.id;
                    const allowed = planAllowsMemoryType(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={!allowed}
                        title={!allowed ? "Not included in your current plan" : undefined}
                        onClick={() => {
                          if (!allowed) return;
                          setMemoryType(t.id);
                          setStep(1);
                          if (t.id === "working") setName("Session Context");
                          else if (t.id === "episodic") setName("Coach Bot History");
                          else setName("Product Knowledge Base");
                        }}
                        className={clsx(
                          "relative rounded-[12px] border bg-bg p-3.5 text-left transition-colors",
                          !allowed && "cursor-not-allowed opacity-50",
                          allowed && sel && "border-2 border-ink",
                          allowed && !sel && "border border-border hover:border-border2",
                          !allowed && "border border-border",
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
                  <div
                    className="relative rounded-[12px] border border-dashed border-border2 bg-bg2/80 p-3.5 text-left"
                    aria-hidden={false}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px]" style={{ background: "#faece7" }}>
                        <span className="h-3.5 w-3.5 rounded-full" style={{ background: "#993c1d" }} />
                      </div>
                      <span className="rounded bg-bg px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted">Coming soon</span>
                    </div>
                    <div className="text-[13px] font-medium text-ink">Graph memory</div>
                    <div className="mt-1 text-[11px] leading-snug text-subtle">
                      Entity graph ingest, traverse, and repair are not connected to the API in this build. The dashboard playground below is an interaction mock only.
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            {isWorkingWizard ? (
              <>
                <WorkingMemoryWizardStep step={step} form={workingForm} name={name} setName={setName} />
                {err ? (
                  <div className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-xs text-error">
                    {err}
                  </div>
                ) : null}
              </>
            ) : null}

            {isGraphWizard ? (
              <>
                <GraphMemoryWizardStep step={step} form={graphForm} name={name} setName={setName} />
                {err ? (
                  <div className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-xs text-error">
                    {err}
                  </div>
                ) : null}
              </>
            ) : null}

            {isEpisodicWizard && step === 1 ? (
              <>
                <h1 className="text-base font-medium tracking-tight text-ink">Name your instance</h1>
                <p className="mt-1 text-[13px] text-muted">
                  Episodic memory stores timestamped episodes from interactions, like a chronological journal.
                </p>

                <section className="mt-6">
                  <h2 className={EPISODIC_SECTION_TITLE}>Identity</h2>
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
              </>
            ) : null}

            {isEpisodicWizard && step === 2 ? (
              <>
                <h1 className="text-base font-medium tracking-tight text-ink">How fast should old memories fade?</h1>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  Decay gradually reduces the retrieval weight of older episodes. Recent episodes surface first; distant
                  ones fade but aren&apos;t deleted — they can still be found with direct queries.
                </p>

                <section className="mt-6">
                  <h2 className={EPISODIC_SECTION_TITLE}>Decay rate</h2>
                  <p className="mb-2 text-[12px] text-muted">Daily decay factor — how much weight is lost each day</p>
                  <div className="mb-1 flex items-center justify-end text-[12px] text-muted">
                    <span className="font-medium text-[#3b6d11]">{decayRateDaily.toFixed(2)} / day</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={30}
                    value={decayRate}
                    onChange={(e) => setDecayRate(Number(e.target.value))}
                    className="w-full cursor-pointer accent-[#3b6d11]"
                  />
                  <div className="mt-1 flex justify-between text-[10px] text-subtle">
                    <span>Slow (0.01)</span>
                    <span>Medium (0.10)</span>
                    <span>Fast (0.30)</span>
                  </div>

                  <div
                    className="mt-4 rounded-[12px] border border-border bg-bg3 px-4 py-3 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]"
                  >
                    <div className="mb-2.5 flex items-start justify-between gap-2 text-[11px] text-muted">
                      <span>Decay preview — weight of an episode over time</span>
                      <span className="shrink-0 whitespace-nowrap font-medium text-[#3b6d11]">
                        Half-life: ~{decayHalfLifeDays} days
                      </span>
                    </div>
                    <div className="mb-3 flex h-[64px] items-end gap-[3px]">
                      {decayBars.map((bar) => (
                        <div
                          key={bar.day}
                          title={`Day ${bar.day}: ${bar.weight.toFixed(2)}`}
                          className="min-w-0 flex-1 rounded-t-sm transition-all duration-200 ease-out"
                          style={{
                            height: `${bar.height}px`,
                            backgroundColor: bar.color,
                            opacity: 0.45 + bar.weight * 0.55,
                          }}
                        />
                      ))}
                    </div>
                    <div className="mb-3 flex justify-between text-[9px] font-medium text-subtle">
                      <span>Today</span>
                      <span>1 week</span>
                      <span>1 month</span>
                      <span>3 months</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-2.5 text-[10px] text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-[#3b6d11]" aria-hidden />
                        Active — weight ≥ 0.5
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-[#ba7517]" aria-hidden />
                        Fading — weight 0.2–0.5
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-[#d3d1c7]" aria-hidden />
                        Dim — weight &lt; 0.2
                      </span>
                    </div>
                  </div>
                </section>

                <section className="mt-6">
                  <h2 className={EPISODIC_SECTION_TITLE}>Decay schedule</h2>
                  <div className="flex items-center justify-between border-b border-border py-2.5">
                    <div className="pr-3">
                      <div className="text-[13px] font-medium text-ink">Automatic decay worker</div>
                      <div className="mt-0.5 text-[11px] leading-snug text-subtle">
                        Runs on schedule to recalculate weights. Without this, decay is applied lazily at query time only.
                      </div>
                    </div>
                    <Toggle
                      id="episodic-decay-auto"
                      accent="episodic"
                      on={decayWorkerEnabled}
                      onToggle={() => setDecayWorkerEnabled((v) => !v)}
                    />
                  </div>
                  <div className="mt-3">
                    <label className="mb-1.5 block text-[12px] text-muted" htmlFor="episodic-schedule">
                      Run schedule
                    </label>
                    <select
                      id="episodic-schedule"
                      className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-2.5 text-[12px] outline-none focus:border-[#3b6d11]"
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
                  <h2 className={EPISODIC_SECTION_TITLE}>Retrieval threshold</h2>
                  <p className="mb-2 text-[12px] text-muted">
                    Minimum weight to include in results — episodes below this are dim but not deleted
                  </p>
                  <div className="mb-1 flex items-center justify-end text-[12px] text-muted">
                    <span className="font-medium text-[#3b6d11]">
                      weight ≥ {(retrievalThreshold / 100).toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={50}
                    value={retrievalThreshold}
                    onChange={(e) => setRetrievalThreshold(Number(e.target.value))}
                    className="w-full cursor-pointer accent-[#3b6d11]"
                  />
                  <div className="mt-1 flex justify-between text-[10px] text-subtle">
                    <span className="max-w-[32%]">Include dim (0.01)</span>
                    <span>Balanced (0.20)</span>
                    <span className="max-w-[32%] text-right">Active only (0.50)</span>
                  </div>
                </section>

                <div className="mt-6 flex gap-2.5 rounded-[12px] border border-[#e8d4b8] bg-[#faeeda] px-3.5 py-3 text-[12px] leading-snug text-[#633806]">
                  <span className="mt-0.5 shrink-0 text-[#ba7517]" aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                      />
                    </svg>
                  </span>
                  <p>
                    Episodes are <strong className="font-semibold">never deleted</strong> by decay — they become dim. You
                    can always retrieve them directly by episode ID or with a point-in-time query.
                  </p>
                </div>
              </>
            ) : null}

            {isEpisodicWizard && step === 3 ? (
              <>
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#3b6d11]">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <path strokeLinecap="round" d="M12 7v6l4 2" />
                  </svg>
                  Step 3 · Bi-temporal tracking
                </div>
                <h1 className="text-base font-medium tracking-tight text-ink">Two timelines for every episode</h1>
                <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted">
                  Bi-temporal facts track two independent timestamps: when something actually happened in the real world, and
                  when your system recorded it. This lets you query the state of memory at any past moment.
                </p>

                <section className="mt-7">
                  <h2 className={EPISODIC_SECTION_TITLE}>Enable bi-temporal</h2>
                  <div className="flex items-start justify-between gap-3 border-b border-border py-2.5">
                    <div className="min-w-0 pr-2">
                      <div className="text-[13px] font-medium text-ink">Bi-temporal facts</div>
                      <p className="mt-1 text-[12px] leading-snug text-subtle">
                        Store{" "}
                        <code className="rounded bg-bg2 px-1 py-0.5 font-mono text-[10px] text-ink">valid_from</code> /{" "}
                        <code className="rounded bg-bg2 px-1 py-0.5 font-mono text-[10px] text-ink">valid_until</code>{" "}
                        alongside system timestamps. Required for point-in-time queries.
                      </p>
                    </div>
                    <Toggle
                      id="episodic-bitemp"
                      accent="episodic"
                      on={biTemporalEnabled}
                      onToggle={() => setBiTemporalEnabled((v) => !v)}
                    />
                  </div>
                </section>

                <section
                  className={clsx(
                    "mt-7 space-y-6 transition-opacity duration-200",
                    biTemporalEnabled ? "opacity-100" : "pointer-events-none opacity-45",
                  )}
                >
                  <div>
                    <h2 className={EPISODIC_SECTION_TITLE}>What the two timelines mean</h2>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-[12px] border border-border bg-bg px-3.5 py-3.5">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#eaf3de] text-[#3b6d11]" aria-hidden>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="9" />
                              <path strokeLinecap="round" d="M12 7v6l4 2" />
                            </svg>
                          </span>
                          <span className="text-[12px] font-medium text-ink">Valid time</span>
                        </div>
                        <p className="text-[12px] leading-relaxed text-subtle">
                          When the event actually happened in the real world. Set by you at ingest time — can be in the past.
                        </p>
                        <pre className="mt-2.5 overflow-x-auto rounded-lg border border-border bg-bg2 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink">
                          valid_from: &quot;2024-03-15&quot;
                        </pre>
                      </div>
                      <div className="rounded-[12px] border border-border bg-bg px-3.5 py-3.5">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#eaf3de] text-[#3b6d11]" aria-hidden>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12l7-7 7 7" />
                            </svg>
                          </span>
                          <span className="text-[12px] font-medium text-ink">System time</span>
                        </div>
                        <p className="text-[12px] leading-relaxed text-subtle">
                          When your system recorded the episode. Set automatically by Mnemoniqa at ingest time.
                        </p>
                        <pre className="mt-2.5 overflow-x-auto rounded-lg border border-border bg-bg2 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink">
                          system_time: now()
                        </pre>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h2 className={EPISODIC_SECTION_TITLE}>Point-in-time queries</h2>
                    <div className="flex items-start justify-between gap-3 border-b border-border py-2.5">
                      <div className="min-w-0 pr-2">
                        <div className="text-[13px] font-medium text-ink">Enable historical projection</div>
                        <p className="mt-1 text-[12px] leading-relaxed text-subtle">
                          Query the state of memory at any past date. &quot;What did we know about this user on March 15,
                          2024?&quot;
                        </p>
                      </div>
                      <Toggle
                        id="episodic-pit"
                        accent="episodic"
                        on={pointInTimeEnabled}
                        onToggle={() => setPointInTimeEnabled((v) => !v)}
                      />
                    </div>

                    <div className="mt-4 rounded-[12px] border border-border bg-bg2 px-3.5 py-3">
                      <div className="mb-2 font-mono text-[11px] font-medium text-muted">POST /api/v1/instances/:id/query</div>
                      <pre className="font-mono text-[11px] leading-[1.55] text-ink">
                        <span className="text-accent">{`{`}</span>
                        {"\n"}
                        {`  `}
                        <span className="text-accent">&quot;query&quot;</span>
                        {`: `}
                        <span className="text-[#534ab7]">&quot;What happened last week?&quot;</span>
                        {`,\n`}
                        {`  `}
                        <span className="text-accent">&quot;user_id&quot;</span>
                        {`: `}
                        <span className="text-[#534ab7]">&quot;user_123&quot;</span>
                        {`,\n`}
                        {`  `}
                        <span className="text-accent">&quot;as_of&quot;</span>
                        {`: `}
                        <span className="text-[#534ab7]">&quot;2024-03-15&quot;</span>
                        <span className="text-subtle">{" // point-in-time"}</span>
                        {"\n"}
                        <span className="text-accent">{`}`}</span>
                      </pre>
                    </div>
                  </div>

                  <div>
                    <h2 className={EPISODIC_SECTION_TITLE}>Invalidation behaviour</h2>
                    <label className="mb-1.5 block text-[12px] text-muted" htmlFor="episodic-invalidation">
                      When a fact is corrected or expires
                    </label>
                    <select
                      id="episodic-invalidation"
                      className="h-[38px] w-full rounded-lg border border-border2 bg-bg px-2.5 text-[12px] outline-none focus:border-[#3b6d11]"
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
                    <div className="mt-3 flex gap-2.5 rounded-[12px] border border-[#c8d8f0] bg-[#e6f1fb] px-3.5 py-3 text-[12px] leading-relaxed text-[#185fa5]">
                      <span className="mt-0.5 shrink-0" aria-hidden>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#185fa5" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <path strokeLinecap="round" d="M12 16v-4M12 8h.01" />
                        </svg>
                      </span>
                      <p>
                        &apos;Close valid_until&apos; is the safest option — it preserves full history for point-in-time
                        queries while excluding the episode from current results.
                      </p>
                    </div>
                  </div>
                </section>
              </>
            ) : null}

            {isEpisodicWizard && step === 4 ? (
              <>
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#3b6d11]">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
                    />
                  </svg>
                  Step 4 - User &amp; session scoping
                </div>
                <h1 className="text-base font-medium tracking-tight text-ink">Isolate memory per user or session</h1>
                <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted">
                  One Episodic instance can serve thousands of users. Pass{" "}
                  <code className="rounded bg-bg2 px-1 py-0.5 font-mono text-[11px] text-ink">user_id</code> on every
                  ingest and query to automatically isolate their episodes.
                </p>

                <section className="mt-7">
                  <h2 className={EPISODIC_SECTION_TITLE}>Scoping mode</h2>
                  <div className="flex items-start justify-between gap-3 border-b border-border py-2.5">
                    <div className="min-w-0 pr-2">
                      <div className="text-[13px] font-medium text-ink">Enable user_id scoping</div>
                      <p className="mt-1 text-[12px] leading-snug text-subtle">
                        Each user sees only their own episodes plus any global episodes (no{" "}
                        <code className="font-mono text-[11px] text-ink">user_id</code>). Standard for multi-user apps.
                      </p>
                    </div>
                    <Toggle
                      id="episodic-user-scope"
                      accent="episodic"
                      on={userScoping}
                      onToggle={() => setUserScoping((v) => !v)}
                    />
                  </div>
                  <div className="flex items-start justify-between gap-3 border-b border-border py-2.5">
                    <div className="min-w-0 pr-2">
                      <div className="text-[13px] font-medium text-ink">Enable session_id scoping</div>
                      <p className="mt-1 text-[12px] leading-snug text-subtle">
                        Further isolate episodes within a single conversation session. Useful for short-term working memory
                        within a session.
                      </p>
                    </div>
                    <Toggle
                      id="episodic-session-scope"
                      accent="episodic"
                      on={sessionScoping}
                      onToggle={() => setSessionScoping((v) => !v)}
                    />
                  </div>
                </section>

                <section className="mt-7">
                  <h2 className={EPISODIC_SECTION_TITLE}>How it works</h2>
                  <div className="rounded-[12px] border border-border bg-bg2 px-4 py-3.5">
                    <p className="text-[12px] leading-snug text-ink">
                      Query with{" "}
                      <code className="rounded border border-border bg-bg px-1 py-0.5 font-mono text-[11px]">
                        user_id = user_alice
                      </code>{" "}
                      → <span className="font-medium text-accent">user_alice</span>
                      <span className="text-subtle"> + </span>
                      <span className="font-medium text-muted">global</span>
                      <span className="text-subtle"> episodes</span>
                    </p>
                    <ul className="mt-3 space-y-2.5">
                      <li className="flex flex-wrap items-start gap-2 text-[12px] leading-snug text-ink">
                        <span className="mt-0.5 shrink-0 rounded-full bg-[#e6f1fb] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#185fa5]">
                          user_alice
                        </span>
                        <span>
                          <span className="text-muted">Episode:</span> &quot;Alice mentioned sleep issues&quot;{" "}
                          <span className="text-subtle">· 2d ago</span>
                        </span>
                      </li>
                      <li className="flex flex-wrap items-start gap-2 text-[12px] leading-snug text-ink">
                        <span className="mt-0.5 shrink-0 rounded-full bg-[#e6f1fb] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#185fa5]">
                          user_alice
                        </span>
                        <span>
                          <span className="text-muted">Episode:</span> &quot;Alice goals: lose 5kg by July&quot;{" "}
                          <span className="text-subtle">· 7w ago</span>
                        </span>
                      </li>
                      <li className="flex flex-wrap items-start gap-2 text-[12px] leading-snug text-ink">
                        <span className="mt-0.5 shrink-0 rounded-full border border-border bg-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle">
                          global
                        </span>
                        <span>
                          <span className="text-muted">Episode:</span> &quot;App-wide coaching guideline update&quot;{" "}
                          <span className="text-subtle">· 3d ago</span>
                        </span>
                      </li>
                    </ul>
                    <p className="mt-3 border-t border-border pt-3 text-[12px] font-medium text-ink">
                      user_bob cannot see alice&apos;s episodes
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="rounded-full bg-[#fcebeb] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#a32d2d]">
                        user_bob
                      </span>
                      <span className="text-subtle">+</span>
                      <span className="rounded-full bg-[#fcebeb] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#a32d2d]">
                        user_alice
                      </span>
                      <span className="text-subtle">→</span>
                      <span className="font-semibold text-[#a32d2d]">Filtered out</span>
                      <span className="text-subtle">— user isolation</span>
                    </div>
                  </div>
                </section>

                <section className="mt-7">
                  <h2 className={EPISODIC_SECTION_TITLE}>GDPR / data deletion</h2>
                  <div className="flex items-start justify-between gap-3 border-b border-border py-2.5">
                    <div className="min-w-0 pr-2">
                      <div className="text-[13px] font-medium text-ink">Enable per-user deletion (GDPR)</div>
                      <p className="mt-1 text-[12px] leading-snug text-subtle">
                        Exposes{" "}
                        <code className="whitespace-nowrap rounded bg-bg2 px-1 py-0.5 font-mono text-[10px] text-ink">
                          DELETE /api/v1/instances/:id/scopes/:user_id
                        </code>{" "}
                        — permanently removes all episodes for a specific user. Required for EU compliance.
                      </p>
                    </div>
                    <Toggle
                      id="episodic-gdpr"
                      accent="episodic"
                      on={gdprDeletionEnabled}
                      onToggle={() => setGdprDeletionEnabled((v) => !v)}
                    />
                  </div>
                  <div className="mt-3 flex gap-2.5 rounded-[12px] border border-[#c8d8f0] bg-[#e6f1fb] px-3.5 py-3 text-[12px] leading-relaxed text-[#185fa5]">
                    <span className="mt-0.5 shrink-0" aria-hidden>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#185fa5" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path strokeLinecap="round" d="M12 16v-4M12 8h.01" />
                      </svg>
                    </span>
                    <p>
                      Scope stats and per-user episode counts are available at{" "}
                      <code className="whitespace-nowrap rounded border border-[#b5d4f4] bg-bg px-1.5 py-0.5 font-mono text-[11px] text-[#185fa5]">
                        GET /api/v1/instances/:id/scopes
                      </code>
                    </p>
                  </div>
                </section>

                <section className="mt-7">
                  <h2 className={EPISODIC_SECTION_TITLE}>Retention policy</h2>
                  <label className="mb-0.5 block text-[12px] font-medium text-ink" htmlFor="episodic-retention">
                    Maximum episode age
                  </label>
                  <p className="mb-2 text-[11px] leading-snug text-subtle">
                    Episodes older than this are eligible for deletion.
                  </p>
                  <select
                    id="episodic-retention"
                    className="h-[38px] w-full rounded-lg border border-border2 bg-bg px-2.5 text-[12px] outline-none focus:border-[#3b6d11]"
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
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#3b6d11]">
                  <svg width="12" height="12" viewBox="0 0 8 8" fill="none" aria-hidden>
                    <polyline
                      points="1,4 3,6 7,2"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Step 5 - Confirm
                </div>
                <h1 className="text-base font-medium tracking-tight text-ink">Review and create</h1>
                <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted">
                  Your Episodic instance will be ready immediately. You can change any setting after creation.
                </p>

                <div className="mt-7 rounded-[12px] border border-border bg-bg px-4 py-4">
                  <div className="mb-4 flex items-start gap-3 border-b border-border pb-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#eaf3de] text-[#3b6d11]" aria-hidden>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="9" />
                        <path strokeLinecap="round" d="M12 7v6l4 2" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold tracking-tight text-ink">{name.trim() || "Untitled instance"}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-[#eaf3de] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#3b6d11]">
                          Episodic
                        </span>
                        <span className="text-[12px] text-subtle">Active after creation</span>
                      </div>
                    </div>
                  </div>
                  {(
                    [
                      [
                        "Embedding model",
                        "Server default",
                      ],
                      ["Decay rate", `${decayRateDaily.toFixed(2)} / day — ~${decayHalfLifeDays} days half-life`],
                      ["Decay worker", decayWorkerEnabled ? decaySchedule : "Disabled"],
                      [
                        "Bi-temporal facts",
                        !biTemporalEnabled
                          ? "Disabled"
                          : pointInTimeEnabled
                            ? "Enabled - point-in-time queries"
                            : "Enabled",
                      ],
                      [
                        "Invalidation",
                        invalidationMode === "close"
                          ? "Close valid_until"
                          : invalidationMode === "archive"
                            ? "Archive the episode"
                            : "Hard delete",
                      ],
                      ["user_id scoping", userScoping ? "Enabled" : "Disabled"],
                      ["session_id scoping", sessionScoping ? "Enabled" : "Disabled"],
                      ["Cross-session endpoint", gdprDeletionEnabled ? "Enabled" : "Disabled"],
                      [
                        "Retention policy",
                        EPISODIC_RETENTION_OPTIONS.find((x) => x.value === episodicRetention)?.label ?? "—",
                      ],
                    ] as const
                  ).map(([k, v]) => (
                    <div
                      key={k}
                      className="flex items-center justify-between gap-4 border-b border-border py-2.5 text-[12px] last:border-0"
                    >
                      <span className="shrink-0 text-subtle">{k}</span>
                      <span className="max-w-[58%] text-right font-medium leading-snug text-ink">{v}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex flex-col gap-3 rounded-[12px] border border-[#8ec95c] bg-[#eaf3de] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <p className="max-w-xl text-[12px] leading-relaxed text-[#2d6b0f]">
                    <span className="font-medium">Cost estimate:</span> ~$0.0002 per 1K episodes stored &amp; retrieved.
                    Embedding only — no language-model extraction cost for Episodic.
                  </p>
                  <div className="shrink-0 text-right sm:pl-2">
                    <div className="text-lg font-semibold text-[#3b6d11]">~$0.002</div>
                    <div className="text-[10px] font-medium text-[#2d6b0f]/85">/ 1K episodes</div>
                  </div>
                </div>

                <section className="mt-8">
                  <h2 className={EPISODIC_SECTION_TITLE}>What happens after creation</h2>
                  <ul className="mt-3 space-y-3">
                    {(
                      [
                        <>
                          <strong className="font-medium text-ink">Instance is live.</strong> Your API endpoint is ready:{" "}
                          <code className="whitespace-nowrap rounded bg-bg2 px-1 py-0.5 font-mono text-[11px] text-ink">
                            POST /api/v1/instances/:id/ingest
                          </code>
                        </>,
                        <>
                          <strong className="font-medium text-ink">Ingest episodes</strong> with{" "}
                          <code className="rounded bg-bg2 px-1 py-0.5 font-mono text-[11px] text-ink">user_id</code> to
                          isolate per user. Async requests return 202 with a{" "}
                          <code className="font-mono text-[11px] text-ink">task_id</code>.
                        </>,
                        <>
                          <strong className="font-medium text-ink">Query with user_id</strong> for decay-weighted results
                          and citations from this instance.
                        </>,
                        <>
                          <strong className="font-medium text-ink">Decay worker</strong>{" "}
                          {decayWorkerEnabled && decaySchedule !== "Manual only"
                            ? `runs ${decaySchedule.toLowerCase()} to update episode weights.`
                            : decayWorkerEnabled
                              ? "runs on manual trigger only to update episode weights."
                              : "is off; weights are updated lazily when you query."}{" "}
                          You can also trigger runs manually from the instance.
                        </>,
                      ]
                    ).map((content, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#3b6d11] text-[11px] font-bold text-white">
                          {i + 1}
                        </span>
                        <div className="min-w-0 pt-0.5 text-[12px] leading-relaxed text-muted">{content}</div>
                      </li>
                    ))}
                  </ul>
                </section>

                {err ? (
                  <div className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-xs text-error">
                    {err}
                  </div>
                ) : null}
              </>
            ) : null}

            {!isEpisodicWizard && !isWorkingWizard && !isGraphWizard && step === 2 ? (
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

            {!isEpisodicWizard && !isWorkingWizard && !isGraphWizard && step === 3 ? (
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

            {!isEpisodicWizard && !isWorkingWizard && !isGraphWizard && step === 4 ? (
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
                {isEpisodicWizard || isWorkingWizard || isGraphWizard ? "← Back" : "Back"}
              </button>
              {step < maxStep ? (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canContinue()}
                  className={clsx(
                    "rounded-lg px-[18px] py-2 text-[13px] font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
                    isEpisodicWizard
                      ? "bg-[#3b6d11] text-white"
                      : isWorkingWizard
                        ? "bg-[#854f0b] text-white"
                        : isGraphWizard
                          ? "bg-[#993c1d] text-white"
                          : "bg-ink text-bg",
                  )}
                >
                  {isEpisodicWizard || isWorkingWizard || isGraphWizard ? "Continue →" : "Continue"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void onCreate()}
                  disabled={saving || !name.trim()}
                  className={clsx(
                    "rounded-lg px-[18px] py-2 text-[13px] font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
                    isEpisodicWizard
                      ? "bg-[#3b6d11] text-white"
                      : isWorkingWizard
                        ? "bg-[#854f0b] text-white"
                        : isGraphWizard
                          ? "bg-[#993c1d] text-white"
                          : "bg-ink text-bg",
                  )}
                >
                  {saving
                    ? "Creating…"
                    : isWorkingWizard || isGraphWizard
                      ? "Create instance ✓"
                      : "Create instance"}
                </button>
              )}
            </div>
          </footer>
        </div>
      </div>
    </InstancesShell>
  );
}
