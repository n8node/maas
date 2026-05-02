"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { InstancesShell } from "@/components/instances/InstancesShell";
import { billingMeRequest, createInstance, listInstances, type BillingMeData, type MeUser } from "@/lib/api";
import { getToken } from "@/lib/token";
import clsx from "clsx";

type MemoryKind = "rag" | "wiki";

const STEP_LABELS = ["Memory type", "Configuration", "Ingest & sources", "Confirm & create"] as const;

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
];

const EXTRACTION_MODELS = ["Gemini 2.5 Flash", "Claude Haiku 4.5"] as const;
const EMBEDDING_MODELS = ["text-embedding-3-large", "text-embedding-3-small"] as const;
const WIKI_CONCEPTS = ["fact", "entity", "event", "goal", "belief", "tension", "project", "pattern"] as const;
const GARDENER_SCHEDULES = ["Every 24 hours", "Every 12 hours", "Manual only"] as const;

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

  const [step, setStep] = useState(1);
  const [memoryType, setMemoryType] = useState<MemoryKind>(() =>
    searchParams.get("type") === "rag" ? "rag" : "wiki",
  );
  const [name, setName] = useState("Product Knowledge Base");
  const [extractionModel, setExtractionModel] = useState<string>(EXTRACTION_MODELS[0]);
  const [embeddingModel, setEmbeddingModel] = useState<string>(EMBEDDING_MODELS[0]);
  const [conceptPick, setConceptPick] = useState(defaultConcepts);
  const [gardenerEnabled, setGardenerEnabled] = useState(true);
  const [gardenerSchedule, setGardenerSchedule] = useState<string>(GARDENER_SCHEDULES[0]);
  const [userScoping, setUserScoping] = useState(true);
  const [sessionScoping, setSessionScoping] = useState(false);
  const [chunkSize, setChunkSize] = useState(512);
  const [chunkOverlap, setChunkOverlap] = useState(64);
  const [hierarchicalClustering, setHierarchicalClustering] = useState(true);

  const [seedText, setSeedText] = useState("");
  const [wizFiles, setWizFiles] = useState<Array<{ name: string; ext: string }>>([]);

  const [billing, setBilling] = useState<BillingMeData | null>(null);
  const [instanceTotal, setInstanceTotal] = useState(0);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = searchParams.get("type");
    if (t === "rag" || t === "wiki") {
      setMemoryType(t);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!token) return;
    billingMeRequest(token).then(setBilling).catch(() => setBilling(null));
    listInstances(token).then((l) => setInstanceTotal(l.length)).catch(() => setInstanceTotal(0));
  }, [token]);

  const buildConfig = useCallback(() => {
    const base = {
      extraction_model: extractionModel,
      embedding_model: embeddingModel,
      scoping: { user_id: userScoping, session_id: sessionScoping },
    };
    if (memoryType === "wiki") {
      return {
        ...base,
        concept_types: WIKI_CONCEPTS.filter((c) => conceptPick[c]),
        gardener: { enabled: gardenerEnabled, schedule: gardenerSchedule },
        auto_extract: gardenerEnabled,
      };
    }
    return {
      ...base,
      chunking: { chunk_size_tokens: chunkSize, overlap_tokens: chunkOverlap },
      features: { hierarchical_clustering: hierarchicalClustering },
    };
  }, [
    chunkOverlap,
    chunkSize,
    conceptPick,
    embeddingModel,
    extractionModel,
    gardenerEnabled,
    gardenerSchedule,
    hierarchicalClustering,
    memoryType,
    sessionScoping,
    userScoping,
  ]);

  const configPayload = useMemo(() => {
    const c = buildConfig() as Record<string, unknown>;
    if (seedText.trim()) {
      c.seed_draft_text = seedText.trim();
    }
    if (wizFiles.length) {
      c.wizard_queued_files = wizFiles.map((f) => f.name);
    }
    return c;
  }, [buildConfig, seedText, wizFiles]);

  function addWizFilesFromList(fileList: FileList | File[]) {
    const list = Array.from(fileList);
    if (list.length === 0) return;
    setWizFiles((prev) => [
      ...prev,
      ...list.map((file) => {
        const base = file.name.split(/[/\\]/).pop() ?? file.name;
        const dot = base.lastIndexOf(".");
        const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
        return { name: base, ext };
      }),
    ]);
  }

  function removeWizFile(i: number) {
    setWizFiles((prev) => prev.filter((_, j) => j !== i));
  }

  function canContinue(): boolean {
    if (step === 2) return name.trim().length > 0;
    return true;
  }

  function goNext() {
    if (!canContinue()) return;
    setErr(null);
    setStep((s) => Math.min(4, s + 1));
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
            {STEP_LABELS.map((label, i) => {
              const n = i + 1;
              const done = step > n;
              const active = step === n;
              const isLast = i === STEP_LABELS.length - 1;
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
            {step === 1 ? (
              <>
                <h1 className="text-base font-medium tracking-tight text-ink">Choose memory type</h1>
                <p className="mt-1 text-[13px] text-muted">Select the type of memory that fits your use case.</p>
                <div className="mt-7 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {MEMORY_TYPES.map((t) => {
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

            {step === 2 ? (
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
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <label className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px] text-muted" htmlFor="ex-model">
                            Extraction model
                            <span className="text-[11px] font-normal text-[#ba7517]">cheap · low reasoning</span>
                          </label>
                          <select
                            id="ex-model"
                            className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-2.5 text-[13px] text-ink"
                            value={extractionModel}
                            onChange={(e) => setExtractionModel(e.target.value)}
                          >
                            {EXTRACTION_MODELS.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[12px] text-muted" htmlFor="emb-model">
                            Embedding model
                          </label>
                          <select
                            id="emb-model"
                            className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-2.5 text-[13px] text-ink"
                            value={embeddingModel}
                            onChange={(e) => setEmbeddingModel(e.target.value)}
                          >
                            {EMBEDDING_MODELS.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </div>
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

            {step === 3 ? (
              <>
                <h1 className="text-base font-medium tracking-tight text-ink">Ingest &amp; sources</h1>
                <p className="mt-1 text-[13px] text-muted">
                  Optionally add your first data sources. You can always add more from the Playground.
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
                      Formats follow your plan (documents, audio, video). Queued here for reference — upload from the
                      instance Playground after creation.
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

            {step === 4 ? (
              <>
                <h1 className="text-base font-medium tracking-tight text-ink">Confirm and create</h1>
                <p className="mt-1 text-[13px] text-muted">Review your configuration before creating the instance.</p>

                <div className="mt-6 rounded-[12px] border border-border bg-bg px-4 py-3">
                  {(
                    [
                      ["Memory type", typeMeta.name],
                      ["Name", name.trim() || "—"],
                      ["Extraction model", extractionModel],
                      ["Embedding model", embeddingModel],
                      ["User_id scoping", userScoping ? "Enabled" : "Disabled"],
                      ["Session_id scoping", sessionScoping ? "Enabled" : "Disabled"],
                      ["Files queued", wizFiles.length ? `${wizFiles.length} file(s)` : "None — add from Playground"],
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
                    <div className="mb-1.5 text-[11px] font-medium text-muted">Files to ingest after creation</div>
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
                  After creation you&apos;ll open the Playground; file ingestion uses your instance API from there.
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
              Step {step} of 4 — {STEP_LABELS[step - 1]}
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
              {step < 4 ? (
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
