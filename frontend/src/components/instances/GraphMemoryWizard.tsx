"use client";

import clsx from "clsx";
import { useCallback, useMemo, useState } from "react";

export const GRAPH_STEP_LABELS = ["Basics", "Ontology", "Extraction", "Invalidation", "Review & create"] as const;
export const GRAPH_STEP_HINTS = [
  "Name & use case",
  "Entity & relation types",
  "SGR models & lineage",
  "Trust state & repair",
  "Confirm and launch",
] as const;

const USE_CASES = [
  {
    id: "tech_arch",
    title: "Tech architecture",
    desc: "Services, components, dependencies, infrastructure relations",
  },
  {
    id: "org_knowledge",
    title: "Org knowledge",
    desc: "Teams, people, projects, responsibilities, and reporting lines",
  },
  {
    id: "product",
    title: "Product graph",
    desc: "Features, bugs, epics, releases and their interdependencies",
  },
  {
    id: "research",
    title: "Research graph",
    desc: "Papers, concepts, authors, citations, findings",
  },
  {
    id: "user_crm",
    title: "User/CRM graph",
    desc: "Users, companies, contacts, deals, interaction history",
  },
  {
    id: "domain_ontology",
    title: "Domain ontology",
    desc: "Custom domain model with specific entity and relation vocabulary",
  },
] as const;

const ENTITY_TYPES = [
  { id: "entity", label: "entity", desc: "A named thing — service, person, team, product, tool" },
  { id: "fact", label: "fact", desc: "A verifiable claim about an entity or relationship" },
  { id: "project", label: "project", desc: "An ongoing or planned initiative with a goal" },
  { id: "event", label: "event", desc: "A timestamped occurrence — incident, release, decision" },
  { id: "goal", label: "goal", desc: "An objective or target state being worked toward" },
  { id: "belief", label: "belief", desc: "An assumption or hypothesis held by the team" },
  { id: "tension", label: "tension", desc: "A known conflict or trade-off between two things" },
  {
    id: "behavioral_pattern",
    label: "behavioral_pattern",
    desc: "A recurring behaviour across multiple events",
  },
] as const;

const RELATIONS = [
  { id: "causes", label: "causes", dot: "#993c1d" },
  { id: "conflicts_with", label: "conflicts_with", dot: "#a32d2d" },
  { id: "supports", label: "supports", dot: "#3b6d11" },
  { id: "instance_of", label: "instance_of", dot: "#185fa5" },
  { id: "enables", label: "enables", dot: "#534ab7" },
  { id: "depends_on", label: "depends_on", dot: "#854f0b" },
  { id: "evolved_into", label: "evolved_into", dot: "#993556" },
  { id: "part_of", label: "part_of", dot: "#185fa5" },
  { id: "blocks", label: "blocks", dot: "#a32d2d" },
  { id: "owns", label: "owns", dot: "#3b6d11" },
  { id: "replaces", label: "replaces", dot: "#534ab7" },
  { id: "monitors", label: "monitors", dot: "#854f0b" },
] as const;

const EXTRACTION_OPTIONS = [
  { value: "google/gemini-2.5-flash", label: "google/gemini-2.5-flash — recommended (cheap, fast, low reasoning)" },
  { value: "anthropic/claude-haiku-4.5", label: "anthropic/claude-haiku-4.5 — alternative cheap model" },
] as const;

const EMBEDDING_OPTIONS = [
  { value: "openai/text-embedding-3-large", label: "openai/text-embedding-3-large (3072-dim) — recommended" },
  { value: "openai/text-embedding-3-small", label: "openai/text-embedding-3-small (1536-dim) — faster" },
] as const;

const STALE_OPTIONS = [
  { value: "30", label: "30 days without new evidence" },
  { value: "60", label: "60 days without new evidence" },
  { value: "90", label: "90 days without new evidence" },
  { value: "never", label: "Never (manual only)" },
] as const;

const GARDENER_SCHEDULE_OPTIONS = ["Every 24 hours", "Every 48 hours", "Weekly", "Manual only"] as const;

const FS_T = "mb-3 border-b border-border pb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted";

function GraphToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={clsx(
        "relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full transition-colors",
        on ? "bg-[#993c1d]" : "bg-border2",
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

function GraphPreviewSvg() {
  return (
    <svg width="100%" height="180" viewBox="0 0 560 180" xmlns="http://www.w3.org/2000/svg" className="block max-h-[180px]">
      <line x1="130" y1="90" x2="230" y2="55" stroke="#d3d1c7" strokeWidth="1.5" />
      <line x1="130" y1="90" x2="230" y2="125" stroke="#d3d1c7" strokeWidth="1.5" />
      <line x1="270" y1="55" x2="370" y2="40" stroke="#d3d1c7" strokeWidth="1.5" />
      <line x1="270" y1="55" x2="370" y2="90" stroke="#d3d1c7" strokeWidth="1.5" />
      <line x1="270" y1="125" x2="370" y2="90" stroke="#d3d1c7" strokeWidth="1.5" />
      <line x1="270" y1="125" x2="370" y2="150" stroke="#d3d1c7" strokeWidth="1.5" />
      <line x1="370" y1="40" x2="460" y2="60" stroke="#d3d1c7" strokeWidth="1.5" />
      <text x="175" y="62" fontSize="8" fill="#888780" textAnchor="middle">
        enables
      </text>
      <text x="175" y="118" fontSize="8" fill="#888780" textAnchor="middle">
        depends_on
      </text>
      <text x="315" y="38" fontSize="8" fill="#888780" textAnchor="middle">
        part_of
      </text>
      <text x="318" y="82" fontSize="8" fill="#888780" textAnchor="middle">
        causes
      </text>
      <text x="318" y="118" fontSize="8" fill="#888780" textAnchor="middle">
        depends_on
      </text>
      <text x="318" y="148" fontSize="8" fill="#888780" textAnchor="middle">
        part_of
      </text>
      <text x="413" y="43" fontSize="8" fill="#888780" textAnchor="middle">
        instance_of
      </text>
      <g>
        <circle cx="110" cy="90" r="22" fill="#faece7" stroke="#993c1d" strokeWidth="1.5" />
        <text x="110" y="87" fontSize="9" fontWeight="500" fill="#993c1d" textAnchor="middle">
          Memory
        </text>
        <text x="110" y="98" fontSize="9" fill="#993c1d" textAnchor="middle">
          Service
        </text>
      </g>
      <g>
        <circle cx="250" cy="55" r="18" fill="#e6f1fb" stroke="#185fa5" strokeWidth="1.5" />
        <text x="250" y="52" fontSize="9" fontWeight="500" fill="#185fa5" textAnchor="middle">
          API
        </text>
        <text x="250" y="62" fontSize="9" fill="#185fa5" textAnchor="middle">
          Layer
        </text>
      </g>
      <g>
        <circle cx="250" cy="125" r="18" fill="#eeedfe" stroke="#534ab7" strokeWidth="1.5" />
        <text x="250" y="122" fontSize="9" fontWeight="500" fill="#534ab7" textAnchor="middle">
          Worker
        </text>
        <text x="250" y="132" fontSize="9" fill="#534ab7" textAnchor="middle">
          Pool
        </text>
      </g>
      <g>
        <circle cx="390" cy="40" r="16" fill="#eaf3de" stroke="#3b6d11" strokeWidth="1.5" />
        <text x="390" y="37" fontSize="9" fontWeight="500" fill="#3b6d11" textAnchor="middle">
          Rate
        </text>
        <text x="390" y="47" fontSize="9" fill="#3b6d11" textAnchor="middle">
          Limiter
        </text>
      </g>
      <g>
        <circle cx="390" cy="90" r="16" fill="#faeeda" stroke="#854f0b" strokeWidth="1.5" />
        <text x="390" y="87" fontSize="9" fontWeight="500" fill="#854f0b" textAnchor="middle">
          Postgres
        </text>
        <text x="390" y="97" fontSize="9" fill="#854f0b" textAnchor="middle">
          16+
        </text>
      </g>
      <g>
        <circle cx="390" cy="150" r="16" fill="#faece7" stroke="#993c1d" strokeWidth="1.5" />
        <text x="390" y="147" fontSize="9" fontWeight="500" fill="#993c1d" textAnchor="middle">
          MinIO
        </text>
        <text x="390" y="157" fontSize="9" fill="#993c1d" textAnchor="middle">
          store
        </text>
      </g>
      <g>
        <circle cx="470" cy="60" r="14" fill="#f8f8f7" stroke="#888780" strokeWidth="1.5" />
        <text x="470" y="57" fontSize="9" fill="#888780" textAnchor="middle">
          pgvec
        </text>
        <text x="470" y="67" fontSize="9" fill="#888780" textAnchor="middle">
          +AGE
        </text>
      </g>
      <rect x="96" y="112" width="28" height="12" rx="4" fill="#faece7" />
      <text x="110" y="121" fontSize="8" fill="#993c1d" textAnchor="middle">
        0.97
      </text>
      <rect x="236" y="73" width="28" height="12" rx="4" fill="#e6f1fb" />
      <text x="250" y="82" fontSize="8" fill="#185fa5" textAnchor="middle">
        0.91
      </text>
      <rect x="236" y="107" width="28" height="12" rx="4" fill="#eeedfe" />
      <text x="250" y="116" fontSize="8" fill="#534ab7" textAnchor="middle">
        0.85
      </text>
    </svg>
  );
}

export function useGraphMemoryForm() {
  const [useCaseId, setUseCaseId] = useState<string>("tech_arch");
  const [description, setDescription] = useState(
    "Entities and typed relations from product documentation, architecture ADRs, and team wikis.",
  );
  const [entityPick, setEntityPick] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const e of ENTITY_TYPES) {
      o[e.id] = ["entity", "fact", "project", "event"].includes(e.id);
    }
    return o;
  });
  const [relationPick, setRelationPick] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const r of RELATIONS) {
      o[r.id] = ["causes", "conflicts_with", "supports", "instance_of", "enables", "depends_on"].includes(r.id);
    }
    return o;
  });
  const [traverseDepth, setTraverseDepth] = useState(3);
  const [extractionModel, setExtractionModel] = useState<string>(EXTRACTION_OPTIONS[0].value);
  const [embeddingModel, setEmbeddingModel] = useState<string>(EMBEDDING_OPTIONS[0].value);
  const [requireEvidence, setRequireEvidence] = useState(true);
  const [confidenceCapping, setConfidenceCapping] = useState(true);
  const [lintEnabled, setLintEnabled] = useState(true);
  const [cascadeDelete, setCascadeDelete] = useState(true);
  const [contradictionDetect, setContradictionDetect] = useState(true);
  const [stalenessToggle, setStalenessToggle] = useState(true);
  const [staleDays, setStaleDays] = useState("60");
  const [autoGardener, setAutoGardener] = useState(false);
  const [gardenerSchedule, setGardenerSchedule] = useState<string>("Every 48 hours");

  const hasValidOntology = useCallback(() => {
    const entities = ENTITY_TYPES.filter((e) => entityPick[e.id]).length;
    const rels = RELATIONS.filter((r) => relationPick[r.id]).length;
    return entities > 0 && rels > 0;
  }, [entityPick, relationPick]);

  const toConfig = useCallback((): Record<string, unknown> => {
    const entityTypes = ENTITY_TYPES.filter((e) => entityPick[e.id]).map((e) => e.id);
    const relationTypes = RELATIONS.filter((r) => relationPick[r.id]).map((r) => r.id);
    return {
      description: description.trim() || undefined,
      wizard_use_case: useCaseId,
      ontology: {
        entity_types: entityTypes,
        relation_types: relationTypes,
        traverse_depth: traverseDepth,
      },
      models: {
        extraction_model: extractionModel,
        embedding_model: embeddingModel,
      },
      lineage: {
        require_evidence_spans: requireEvidence,
        confidence_capping: confidenceCapping,
        lint_endpoint_enabled: lintEnabled,
      },
      invalidation: {
        cascade_on_source_delete: cascadeDelete,
        contradiction_detection: contradictionDetect,
        staleness_enabled: stalenessToggle,
        staleness_days: staleDays === "never" ? null : Number(staleDays),
      },
      gardener: {
        auto_enabled: autoGardener,
        schedule: gardenerSchedule,
      },
    };
  }, [
    description,
    useCaseId,
    entityPick,
    relationPick,
    traverseDepth,
    extractionModel,
    embeddingModel,
    requireEvidence,
    confidenceCapping,
    lintEnabled,
    cascadeDelete,
    contradictionDetect,
    stalenessToggle,
    staleDays,
    autoGardener,
    gardenerSchedule,
  ]);

  return {
    useCaseId,
    setUseCaseId,
    description,
    setDescription,
    entityPick,
    setEntityPick,
    relationPick,
    setRelationPick,
    traverseDepth,
    setTraverseDepth,
    extractionModel,
    setExtractionModel,
    embeddingModel,
    setEmbeddingModel,
    requireEvidence,
    setRequireEvidence,
    confidenceCapping,
    setConfidenceCapping,
    lintEnabled,
    setLintEnabled,
    cascadeDelete,
    setCascadeDelete,
    contradictionDetect,
    setContradictionDetect,
    stalenessToggle,
    setStalenessToggle,
    staleDays,
    setStaleDays,
    autoGardener,
    setAutoGardener,
    gardenerSchedule,
    setGardenerSchedule,
    toConfig,
    hasValidOntology,
  };
}

export type GraphMemoryForm = ReturnType<typeof useGraphMemoryForm>;

function CheckCard({
  on,
  onToggle,
  title,
  desc,
}: {
  on: boolean;
  onToggle: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        "flex w-full cursor-pointer items-start gap-2 rounded-lg border bg-bg px-[11px] py-[9px] text-left transition-colors select-none",
        on ? "border-[1.5px] border-[#993c1d] bg-[#faece7]" : "border border-border hover:border-border2",
      )}
    >
      <span
        className={clsx(
          "mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] transition-colors",
          on ? "border-[#993c1d] bg-[#993c1d]" : "border-border2 bg-bg",
        )}
      >
        {on ? (
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
            <polyline points=".5,4 2.5,6 7.5,1.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        ) : null}
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-[10px] leading-[1.35] text-subtle">{desc}</span>
      </span>
    </button>
  );
}

/** Eyebrow icons per step — match HTML. */
function EyebrowIcon({ step }: { step: 1 | 2 | 3 | 4 | 5 }) {
  if (step === 1) {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        <circle cx="3" cy="6" r="1.8" stroke="currentColor" strokeWidth="1" />
        <circle cx="9.5" cy="2.5" r="1.5" stroke="currentColor" strokeWidth="1" />
        <circle cx="9.5" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1" />
        <line x1="4.8" y1="5.5" x2="8" y2="3.2" stroke="currentColor" strokeWidth="0.9" />
        <line x1="4.8" y1="6.5" x2="8" y2="8.8" stroke="currentColor" strokeWidth="0.9" />
      </svg>
    );
  }
  if (step === 2) {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        <rect x="1" y="1" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1" />
        <rect x="6.5" y="1" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1" />
        <rect x="1" y="6.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1" />
        <rect x="6.5" y="6.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1" />
      </svg>
    );
  }
  if (step === 3) {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path
          d="M2 10L5 3l2 4 2-3 1 2h2"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    );
  }
  if (step === 4) {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path
          d="M6 1.5v2M6 8.5v2M1.5 6h2M8.5 6h2"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="1" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <polyline points="2,6 5,9 10,3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

const EYEBROW_LABELS: Record<number, string> = {
  1: "Step 1 · Graph memory",
  2: "Step 2 · Ontology",
  3: "Step 3 · Extraction & lineage",
  4: "Step 4 · Invalidation & repair",
  5: "Step 5 · Confirm",
};

export function GraphMemoryWizardStep({
  step,
  form,
  name,
  setName,
}: {
  step: number;
  form: GraphMemoryForm;
  name: string;
  setName: (v: string) => void;
}) {
  const selectedEntities = useMemo(
    () => ENTITY_TYPES.filter((e) => form.entityPick[e.id]).map((e) => e.label),
    [form.entityPick],
  );
  const selectedRels = useMemo(
    () => RELATIONS.filter((r) => form.relationPick[r.id]).map((r) => r.label),
    [form.relationPick],
  );

  const extractionLabel = EXTRACTION_OPTIONS.find((o) => o.value === form.extractionModel)?.label ?? "";

  const staleLabel = STALE_OPTIONS.find((o) => o.value === form.staleDays)?.label ?? "";

  const revInvalidation = [
    form.cascadeDelete ? "Source cascade" : "",
    form.contradictionDetect ? "Contradiction detect" : "",
    form.stalenessToggle ? staleLabel : "",
  ]
    .filter(Boolean)
    .join(" + ");

  if (step === 1) {
    return (
      <>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-[#c04d25]">
          <EyebrowIcon step={1} />
          {EYEBROW_LABELS[1]}
        </div>
        <h1 className="text-[18px] font-medium tracking-[-0.02em] text-ink">Entities, relations, and typed knowledge</h1>
        <p className="mt-1.5 text-[13px] leading-[1.5] text-subtle">
          Graph memory stores named entities and typed relations extracted from text — powered by Apache AGE (PostgreSQL
          graph extension). Each node and edge must be grounded to a source document. No source = Graph Sludge.
        </p>

        <div className="mt-6">
          <div className={FS_T}>Identity</div>
          <div className="space-y-3.5">
            <div>
              <label className="mb-1.5 block text-[12px] text-muted">Instance name</label>
              <input
                className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-[11px] text-[13px] text-ink outline-none focus:border-[#c04d25]"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Company Knowledge Graph, Tech Stack Graph"
                autoComplete="off"
                maxLength={128}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] text-muted">
                Description <span className="text-[11px] font-normal text-subtle">— optional</span>
              </label>
              <textarea
                className="min-h-14 w-full resize-y rounded-lg border border-border2 bg-bg px-[11px] py-2 text-[12px] leading-normal text-ink outline-none focus:border-[#c04d25]"
                value={form.description}
                onChange={(e) => form.setDescription(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="mt-[22px]">
          <div className={FS_T}>Use case</div>
          <div className="grid grid-cols-2 gap-1.5">
            {USE_CASES.map((uc) => {
              const on = form.useCaseId === uc.id;
              return (
                <CheckCard
                  key={uc.id}
                  on={on}
                  onToggle={() => form.setUseCaseId(uc.id)}
                  title={uc.title}
                  desc={uc.desc}
                />
              );
            })}
          </div>
        </div>

        <div className="mt-[22px]">
          <div className={FS_T}>Graph preview</div>
          <div className="rounded-[12px] border border-border bg-bg p-3.5">
            <div className="mb-2.5 flex items-center justify-between text-[11px] font-medium text-muted">
              <span>Example — tech architecture graph</span>
              <span className="text-[10px] text-subtle">Powered by Apache AGE</span>
            </div>
            <GraphPreviewSvg />
          </div>
        </div>
      </>
    );
  }

  if (step === 2) {
    return (
      <>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-[#c04d25]">
          <EyebrowIcon step={2} />
          {EYEBROW_LABELS[2]}
        </div>
        <h1 className="text-[18px] font-medium tracking-[-0.02em] text-ink">Define your entity and relation types</h1>
        <p className="mt-1.5 text-[13px] leading-[1.5] text-subtle">
          The ontology is the schema of your graph — what kinds of nodes exist and what kinds of edges connect them. The
          extraction model uses these types as a constrained vocabulary (SGR).
        </p>

        <div className="mt-6">
          <div className={FS_T}>
            Entity types{" "}
            <span className="ml-1.5 text-[10px] font-normal normal-case tracking-normal text-subtle">
              — nodes in the graph
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {ENTITY_TYPES.map((e) => (
              <CheckCard
                key={e.id}
                on={!!form.entityPick[e.id]}
                onToggle={() => form.setEntityPick((p) => ({ ...p, [e.id]: !p[e.id] }))}
                title={e.label}
                desc={e.desc}
              />
            ))}
          </div>
        </div>

        <div className="mt-[22px]">
          <div className={FS_T}>
            Relation types{" "}
            <span className="ml-1.5 text-[10px] font-normal normal-case tracking-normal text-subtle">
              — directed typed edges
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RELATIONS.map((r) => {
              const on = !!form.relationPick[r.id];
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => form.setRelationPick((p) => ({ ...p, [r.id]: !p[r.id] }))}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-2.5 py-1 text-[11px] font-medium transition-colors",
                    on ? "border-[#993c1d] bg-[#faece7] text-[#993c1d]" : "border-border2 bg-bg text-muted",
                  )}
                >
                  <span
                    className="h-[5px] w-[5px] shrink-0 rounded-full"
                    style={{ backgroundColor: on ? r.dot : "#d3d1c7" }}
                  />
                  {r.label}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2 rounded-lg border border-[#c8d8f0] bg-[#f0f4fb] px-3.5 py-2.5 text-[12px] leading-normal text-[#1d3a6b]">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-px shrink-0 text-[#185fa5]" aria-hidden>
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1" />
              <line x1="7" y1="6" x2="7" y2="10" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="7" cy="4.5" r="0.7" fill="currentColor" />
            </svg>
            <span>
              Relation types form a <strong className="font-medium">closed vocabulary</strong> used by the extraction model
              (SGR). Adding too many weakens precision — start with 6–8 and expand based on coverage metrics.
            </span>
          </div>
        </div>

        <div className="mt-[22px]">
          <div className={FS_T}>Traverse depth limit</div>
          <div>
            <label className="mb-1.5 block text-[12px] text-muted">
              Max graph traversal depth <span className="text-[11px] text-subtle">— for POST /traverse queries</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={6}
                value={form.traverseDepth}
                onChange={(e) => form.setTraverseDepth(Number(e.target.value))}
                className="h-2 flex-1 cursor-pointer accent-[#993c1d]"
              />
              <span className="min-w-[52px] text-right text-[13px] font-medium text-[#993c1d]">{form.traverseDepth} hops</span>
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-subtle">
              <span>1 hop</span>
              <span>2–3 hops (rec.)</span>
              <span>6 hops</span>
            </div>
          </div>
          <div className="mt-2 flex gap-2 rounded-lg border border-border bg-bg2 px-3.5 py-2.5 text-[12px] leading-normal text-muted">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-px shrink-0 text-subtle" aria-hidden>
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1" />
              <line x1="7" y1="6" x2="7" y2="10" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="7" cy="4.5" r="0.7" fill="currentColor" />
            </svg>
            <span>
              Deep traversal (5+ hops) on large graphs can be slow. Use targeted entity IDs as start points and keep depth
              ≤ 3 for sub-second responses.
            </span>
          </div>
        </div>
      </>
    );
  }

  if (step === 3) {
    return (
      <>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-[#c04d25]">
          <EyebrowIcon step={3} />
          {EYEBROW_LABELS[3]}
        </div>
        <h1 className="text-[18px] font-medium tracking-[-0.02em] text-ink">SGR extraction and mandatory grounding</h1>
        <p className="mt-1.5 text-[13px] leading-[1.5] text-subtle">
          Every entity and relation must trace back to a source document. Without this lineage chain, your graph becomes{" "}
          <strong className="font-medium text-ink">Graph Sludge</strong> — confident-looking data with no verifiable basis.
        </p>

        <div className="mt-3.5 flex gap-2.5 rounded-lg border border-[#f5c842] bg-[#fdf3e0] px-3.5 py-3">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-px shrink-0" aria-hidden>
            <path d="M8 1.5L15 14H1L8 1.5z" stroke="#c04d25" strokeWidth="1.2" />
            <line x1="8" y1="5.5" x2="8" y2="10" stroke="#c04d25" strokeWidth="1.1" />
            <circle cx="8" cy="12" r="0.9" fill="#c04d25" />
          </svg>
          <div>
            <div className="text-[12px] font-semibold text-[#5a3200]">⚠️ Graph Sludge — know the anti-pattern</div>
            <p className="mt-1 text-[11px] leading-normal text-[#633806]">
              Nodes without <code className="rounded bg-bg2 px-1 py-0 font-mono text-[10px]">evidence_spans</code>,
              entities without <code className="rounded bg-bg2 px-1 py-0 font-mono text-[10px]">source_id</code>,{" "}
              <code className="rounded bg-bg2 px-1 py-0 font-mono text-[10px]">confidence = 1.0</code> everywhere,
              duplicate nodes with different names. Protect against this with lineage enforcement, mandatory grounding, and
              confidence capping.
            </p>
          </div>
        </div>

        <div className="mt-3.5">
          <div className={FS_T}>Extraction model (SGR)</div>
          <div className="space-y-3.5">
            <div>
              <label className="mb-1.5 block text-[12px] text-muted">
                Extraction model{" "}
                <span className="text-[11px] font-normal text-[#854f0b]">
                  — CHEAP + LOW reasoning. Never use a smart model here.
                </span>
              </label>
              <select
                className="h-[34px] w-full cursor-pointer rounded-lg border border-border2 bg-bg px-[11px] text-[12px] text-ink outline-none focus:border-[#c04d25]"
                value={form.extractionModel}
                onChange={(e) => form.setExtractionModel(e.target.value)}
              >
                {EXTRACTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] text-muted">
                Embedding model <span className="text-[11px] text-subtle">— for semantic entity search</span>
              </label>
              <select
                className="h-[34px] w-full cursor-pointer rounded-lg border border-border2 bg-bg px-[11px] text-[12px] text-ink outline-none focus:border-[#c04d25]"
                value={form.embeddingModel}
                onChange={(e) => form.setEmbeddingModel(e.target.value)}
              >
                {EMBEDDING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-2.5 overflow-hidden rounded-lg border border-border">
            <div className="border-b border-border bg-bg2 px-3 py-2 text-[11px] font-medium text-muted">Why cheap model for extraction?</div>
            <div className="grid grid-cols-2 gap-2.5 bg-bg px-3 py-2.5 text-[11px]">
              <div className="text-[#3b6d11]">
                <div className="mb-1 font-medium">✓ Cheap model (Gemini Flash)</div>
                <div className="leading-normal text-subtle">
                  Follows the JSON schema exactly.
                  <br />
                  Fills all required fields.
                  <br />
                  Returns &quot;&quot; or [] for empty values.
                  <br />
                  Cost: −48% · Quality: +36%
                </div>
              </div>
              <div className="text-[#a32d2d]">
                <div className="mb-1 font-medium">✕ Smart model (Claude Sonnet)</div>
                <div className="leading-normal text-subtle">
                  Tries to &quot;improve&quot; the schema.
                  <br />
                  Merges entities that shouldn&apos;t merge.
                  <br />
                  Skips fields it deems redundant.
                  <br />
                  +113% redundancy, +144% errors
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-[22px]">
          <div className={FS_T}>Lineage enforcement</div>
          <div className="border-b border-border py-2.5">
            <div className="flex justify-between gap-4">
              <div className="min-w-0 pr-3">
                <div className="text-[13px] font-medium text-ink">Require evidence_spans on every entity</div>
                <p className="mt-0.5 text-[11px] leading-snug text-subtle">
                  Entities without evidence are rejected and logged as residuals. No source = no entry. Enforces the Graph
                  Sludge protection rule.
                </p>
              </div>
              <GraphToggle on={form.requireEvidence} onToggle={() => form.setRequireEvidence((x) => !x)} />
            </div>
          </div>
          <div className="border-b border-border py-2.5">
            <div className="flex justify-between gap-4">
              <div className="min-w-0 pr-3">
                <div className="text-[13px] font-medium text-ink">Confidence capping</div>
                <p className="mt-0.5 text-[11px] leading-snug text-subtle">
                  Confidence is capped by the weakest surviving evidence span. If a source is deleted, confidence
                  automatically drops.
                </p>
              </div>
              <GraphToggle on={form.confidenceCapping} onToggle={() => form.setConfidenceCapping((x) => !x)} />
            </div>
          </div>
          <div className="py-2.5">
            <div className="flex justify-between gap-4">
              <div className="min-w-0 pr-3">
                <div className="text-[13px] font-medium text-ink">Lint endpoint</div>
                <p className="mt-0.5 text-[11px] leading-snug text-subtle">
                  Enables <code className="rounded bg-bg2 px-1 font-mono text-[10px]">POST /instances/:id/lint</code> to
                  scan for sludge patterns — ungrounded nodes, orphan entities, suspicious confidence scores.
                </p>
              </div>
              <GraphToggle on={form.lintEnabled} onToggle={() => form.setLintEnabled((x) => !x)} />
            </div>
          </div>

          <div className="mt-2.5">
            <div className="mb-1.5 text-[12px] text-muted">Lineage chain for every entity</div>
            <div className="flex flex-wrap items-center gap-0 rounded-lg bg-bg2 px-3.5 py-2.5">
              <span className="rounded px-2 py-1 text-[11px] font-medium text-[#185fa5]" style={{ background: "#e6f1fb" }}>
                Source file
              </span>
              <span className="px-1 text-[13px] text-border2">→</span>
              <span className="rounded px-2 py-1 text-[11px] font-medium text-[#3b6d11]" style={{ background: "#eaf3de" }}>
                MinIO object
              </span>
              <span className="px-1 text-[13px] text-border2">→</span>
              <span className="rounded px-2 py-1 text-[11px] font-medium text-[#534ab7]" style={{ background: "#eeedfe" }}>
                Segment
              </span>
              <span className="px-1 text-[13px] text-border2">→</span>
              <span className="rounded px-2 py-1 text-[11px] font-medium text-[#993c1d]" style={{ background: "#faece7" }}>
                Evidence span
              </span>
              <span className="px-1 text-[13px] text-border2">→</span>
              <span className="rounded px-2 py-1 text-[11px] font-medium text-white" style={{ background: "#1a1a1a" }}>
                Graph entity
              </span>
            </div>
          </div>
        </div>

        <div className="mt-[22px]">
          <div className={FS_T}>Router decisions</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-[#eaf3de] px-2 py-2.5 text-center">
              <div className="text-[11px] font-semibold text-[#3b6d11]">create</div>
              <div className="mt-1 text-[10px] leading-snug text-[#3b6d11] opacity-80">New entity hypothesis — no match in graph</div>
            </div>
            <div className="rounded-lg bg-[#e6f1fb] px-2 py-2.5 text-center">
              <div className="text-[11px] font-semibold text-[#185fa5]">attach</div>
              <div className="mt-1 text-[10px] leading-snug text-[#185fa5] opacity-80">Add evidence to existing entity — confidence ↑</div>
            </div>
            <div className="rounded-lg bg-[#eeedfe] px-2 py-2.5 text-center">
              <div className="text-[11px] font-semibold text-[#534ab7]">refine</div>
              <div className="mt-1 text-[10px] leading-snug text-[#534ab7] opacity-80">Update description or aliases</div>
            </div>
            <div className="rounded-lg bg-bg2 px-2 py-2.5 text-center">
              <div className="text-[11px] font-semibold text-subtle">reject</div>
              <div className="mt-1 text-[10px] leading-snug text-subtle opacity-80">Too generic → residuals for Gardener</div>
            </div>
          </div>
          <div className="mt-2 flex gap-2 rounded-lg border border-border bg-bg2 px-3.5 py-2.5 text-[12px] leading-normal text-muted">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-px shrink-0 text-subtle" aria-hidden>
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1" />
              <line x1="7" y1="6" x2="7" y2="10" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="7" cy="4.5" r="0.7" fill="currentColor" />
            </svg>
            <span>
              Rejected candidates go to <strong className="font-medium text-ink">residuals</strong> — they&apos;re never
              deleted, and the Gardener can promote them later if more evidence accumulates. Dangerous operations (merge,
              split, archive) are <strong className="font-medium text-ink">Gardener-only</strong>.
            </span>
          </div>
        </div>
      </>
    );
  }

  if (step === 4) {
    return (
      <>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-[#c04d25]">
          <EyebrowIcon step={4} />
          {EYEBROW_LABELS[4]}
        </div>
        <h1 className="text-[18px] font-medium tracking-[-0.02em] text-ink">Trust state pipeline and repair queue</h1>
        <p className="mt-1.5 text-[13px] leading-[1.5] text-subtle">
          Every entity has a trust state. When a source is deleted or contradicted, affected entities automatically move down
          the trust pipeline and enter the repair queue for human or Gardener review.
        </p>

        <div className="mt-6">
          <div className={FS_T}>Trust state pipeline</div>
          <div className="rounded-[12px] border border-border bg-bg px-3.5 py-3">
            <div className="flex items-start gap-0 overflow-x-auto pb-1 pt-2">
              {(
                [
                  { k: "active", bg: "#eaf3de", fg: "#3b6d11", d: "Well-supported entity" },
                  { k: "stale", bg: "#faeeda", fg: "#854f0b", d: "Evidence not refreshed recently" },
                  { k: "disputed", bg: "#fcebeb", fg: "#a32d2d", d: "Contradicting evidence found" },
                  { k: "weakened", bg: "#fcebeb", fg: "#7a1f1f", d: "Evidence deleted, confidence capped" },
                  { k: "archived", bg: "#f1efe8", fg: "#5f5e5a", d: "Gardener-only safe removal" },
                ] as const
              ).map((s, i, arr) => (
                <div key={s.k} className="flex items-start">
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <span
                      className="whitespace-nowrap rounded-xl px-2.5 py-1 text-[10px] font-medium"
                      style={{ background: s.bg, color: s.fg }}
                    >
                      {s.k}
                    </span>
                    <span className="max-w-[60px] text-center text-[9px] leading-snug text-subtle">{s.d}</span>
                  </div>
                  {i < arr.length - 1 ? <span className="mx-0.5 mt-1.5 shrink-0 px-px text-sm text-border2">→</span> : null}
                </div>
              ))}
            </div>
            <p className="mt-2.5 text-[11px] leading-normal text-subtle">
              Entities in <span className="font-medium text-[#854f0b]">stale</span>,{" "}
              <span className="font-medium text-[#a32d2d]">disputed</span> or{" "}
              <span className="font-medium text-[#7a1f1f]">weakened</span> states → automatically added to repair queue. Only
              Gardener (smart model, Phase 1) can merge, split or archive.
            </p>
          </div>
        </div>

        <div className="mt-[22px]">
          <div className={FS_T}>Invalidation triggers</div>
          <div className="border-b border-border py-2.5">
            <div className="flex justify-between gap-4">
              <div className="min-w-0 pr-3">
                <div className="text-[13px] font-medium text-ink">Source deletion → cascade to dependent entities</div>
                <p className="mt-0.5 text-[11px] leading-snug text-subtle">
                  When a source document is deleted, all entities whose confidence depended on it are automatically
                  recalculated and moved to <code className="font-mono text-[10px]">stale</code> or{" "}
                  <code className="font-mono text-[10px]">weakened</code>.
                </p>
              </div>
              <GraphToggle on={form.cascadeDelete} onToggle={() => form.setCascadeDelete((x) => !x)} />
            </div>
          </div>
          <div className="border-b border-border py-2.5">
            <div className="flex justify-between gap-4">
              <div className="min-w-0 pr-3">
                <div className="text-[13px] font-medium text-ink">Contradiction detection</div>
                <p className="mt-0.5 text-[11px] leading-snug text-subtle">
                  When a new ingest contradicts an existing entity (opposite claim with evidence), both are marked{" "}
                  <code className="font-mono text-[10px]">disputed</code> and added to the repair queue.
                </p>
              </div>
              <GraphToggle on={form.contradictionDetect} onToggle={() => form.setContradictionDetect((x) => !x)} />
            </div>
          </div>
          <div className="border-b border-border py-2.5">
            <div className="flex justify-between gap-4">
              <div className="min-w-0 pr-3">
                <div className="text-[13px] font-medium text-ink">Staleness threshold</div>
                <p className="mt-0.5 text-[11px] leading-snug text-subtle">
                  Entities with no new evidence for this period are marked <code className="font-mono text-[10px]">stale</code>{" "}
                  automatically.
                </p>
              </div>
              <GraphToggle on={form.stalenessToggle} onToggle={() => form.setStalenessToggle((x) => !x)} />
            </div>
          </div>
          <div className="mt-2.5">
            <label className="mb-1.5 block text-[12px] text-muted">Stale after</label>
            <select
              className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-[11px] text-[12px] text-ink outline-none focus:border-[#c04d25]"
              value={form.staleDays}
              onChange={(e) => form.setStaleDays(e.target.value)}
            >
              {STALE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-[22px]">
          <div className={FS_T}>Repair queue preview</div>
          <div className="overflow-hidden rounded-[12px] border border-border">
            <div className="flex items-center justify-between border-b border-border bg-bg2 px-3.5 py-2 text-[10px] font-medium uppercase tracking-[0.06em] text-subtle">
              <span>Repair queue — example</span>
              <span>3 items</span>
            </div>
            <div className="flex gap-2.5 border-b border-border bg-bg px-3 py-2.5 hover:bg-bg2">
              <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#fcebeb] text-[9px] font-semibold text-[#a32d2d]">
                H
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-ink">Rate Limiter → depends_on → Redis</div>
                <div className="mt-px text-[11px] text-subtle">Source deleted — confidence dropped from 0.91 to 0.0 · cascade triggered</div>
              </div>
              <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-[#a32d2d]" style={{ background: "#fcebeb" }}>
                weakened
              </span>
            </div>
            <div className="flex gap-2.5 border-b border-border bg-bg px-3 py-2.5 hover:bg-bg2">
              <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#fcebeb] text-[9px] font-semibold text-[#a32d2d]">
                H
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-ink">API Layer (entity)</div>
                <div className="mt-px text-[11px] text-subtle">New ingest contradicts existing description — two conflicting evidence spans</div>
              </div>
              <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-[#a32d2d]" style={{ background: "#fcebeb" }}>
                disputed
              </span>
            </div>
            <div className="flex gap-2.5 bg-bg px-3 py-2.5 hover:bg-bg2">
              <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#faece7] text-[9px] font-semibold text-[#993c1d]">
                M
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-ink">MemoryService (entity)</div>
                <div className="mt-px text-[11px] text-subtle">No new evidence for 63 days — stale threshold reached</div>
              </div>
              <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-[#854f0b]" style={{ background: "#faeeda" }}>
                stale
              </span>
            </div>
          </div>
          <div className="mt-2 flex gap-2 rounded-lg border border-[#f0b8a0] bg-[#faece7] px-3.5 py-2.5 text-[12px] leading-normal text-[#5a1f0a]">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-px shrink-0 text-[#c04d25]" aria-hidden>
              <path d="M7 1.5L13 12.5H1L7 1.5Z" stroke="currentColor" strokeWidth="1.1" />
              <line x1="7" y1="5" x2="7" y2="9" stroke="currentColor" strokeWidth="1" />
              <circle cx="7" cy="11" r="0.75" fill="currentColor" />
            </svg>
            <span>
              Repair items are resolved by the <strong className="font-medium">Gardener (Phase 1) using a smart model only</strong>
              . Cheap models are forbidden from repair — they produce +113% redundancy and +144% errors (EXP-GARDENER-001).
            </span>
          </div>
        </div>

        <div className="mt-[22px]">
          <div className={FS_T}>Gardener schedule</div>
          <div className="border-b border-border py-2.5">
            <div className="flex justify-between gap-4">
              <div className="min-w-0 pr-3">
                <div className="text-[13px] font-medium text-ink">Auto-Gardener</div>
                <p className="mt-0.5 text-[11px] leading-snug text-subtle">
                  Automatically runs Phase 0 triage and Phase 1 refactoring on schedule. Pro plan required for auto-Gardener.
                </p>
              </div>
              <GraphToggle on={form.autoGardener} onToggle={() => form.setAutoGardener((x) => !x)} />
            </div>
          </div>
          <div className="mt-2.5">
            <label className="mb-1.5 block text-[12px] text-muted">
              Gardener schedule <span className="text-[11px] text-subtle">— Phase 0 triage frequency</span>
            </label>
            <select
              className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-[11px] text-[12px] text-ink outline-none focus:border-[#c04d25]"
              value={form.gardenerSchedule}
              onChange={(e) => form.setGardenerSchedule(e.target.value)}
            >
              {GARDENER_SCHEDULE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex gap-2 rounded-lg border border-[#c8d8f0] bg-[#f0f4fb] px-3.5 py-2.5 text-[12px] leading-normal text-[#1d3a6b]">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-px shrink-0 text-[#185fa5]" aria-hidden>
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1" />
              <line x1="7" y1="6" x2="7" y2="10" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="7" cy="4.5" r="0.7" fill="currentColor" />
            </svg>
            <span>
              Phase 0 outputs proposals only — it never mutates the graph. Phase 1 applies proposals after human or
              auto-approval. You can always run Gardener manually from the instance dashboard.
            </span>
          </div>
        </div>
      </>
    );
  }

  /* step 5 */
  const embedShort = form.embeddingModel.replace("openai/", "");
  return (
    <>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-[#c04d25]">
        <EyebrowIcon step={5} />
        {EYEBROW_LABELS[5]}
      </div>
      <h1 className="text-[18px] font-medium tracking-[-0.02em] text-ink">Review and create</h1>
      <p className="mt-1.5 text-[13px] leading-[1.5] text-subtle">
        Your Graph memory instance is ready. Apache AGE graph will be initialised on creation.
      </p>

      <div className="mt-6 overflow-hidden rounded-[12px] border border-border bg-bg">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#faece7]">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <circle cx="4" cy="9" r="2.5" stroke="#993c1d" strokeWidth="1.2" />
              <circle cx="14" cy="4" r="2" stroke="#993c1d" strokeWidth="1.2" />
              <circle cx="14" cy="14" r="2" stroke="#993c1d" strokeWidth="1.2" />
              <line x1="6.3" y1="8.1" x2="12" y2="5" stroke="#993c1d" strokeWidth="1" />
              <line x1="6.3" y1="9.9" x2="12" y2="13" stroke="#993c1d" strokeWidth="1" />
            </svg>
          </div>
          <div>
            <div className="text-[15px] font-medium text-ink">{name.trim() || "Graph Memory"}</div>
            <div className="mt-px text-[11px] text-subtle">
              <span className="inline-flex items-center gap-1 rounded bg-[#faece7] px-1.5 py-0.5 text-[10px] font-medium text-[#993c1d]">
                Graph
              </span>
              <span className="ml-1">· Apache AGE · Initialised on create</span>
            </div>
          </div>
        </div>
        <div>
          {(
            [
              ["Extraction model", extractionLabel.split(" —")[0]],
              ["Embedding model", embedShort],
              ["Entity types", selectedEntities.join(", ") || "—"],
              ["Relation types", selectedRels.join(", ") || "—"],
              ["Traverse depth", `${form.traverseDepth} hops`],
              [
                "Lineage enforcement",
                form.requireEvidence && form.confidenceCapping ? "Enabled · confidence capping on" : "Adjusted — check toggles",
              ],
              ["Invalidation", revInvalidation || "—"],
              ["Gardener", form.autoGardener ? form.gardenerSchedule : "Manual only"],
              ["Lint endpoint", form.lintEnabled ? "Enabled" : "Disabled"],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-3 border-b border-border px-4 py-2.5 text-[12px] last:border-b-0">
              <span className="shrink-0 text-subtle">{k}</span>
              <span className="text-right font-medium text-ink">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-[12px] border border-[#f0b8a0] bg-[#faece7] px-4 py-3">
        <div className="min-w-0 flex-1 pr-3">
          <div className="text-[13px] font-medium text-[#5a1f0a]">Cost estimate</div>
          <div className="mt-0.5 text-[12px] leading-normal text-[#993c1d]">
            ~$0.004 per 1K entities ingested (embedding + extraction).
            <br />
            Gardener Phase 1 uses smart model — ~$0.01 per proposal applied.
          </div>
        </div>
        <div className="shrink-0 whitespace-nowrap text-right text-xl font-medium text-[#993c1d]">
          ~$0.004
          <div className="text-xs font-normal text-[#993c1d]">/1K entities</div>
        </div>
      </div>

      <div className="mt-3 rounded-[12px] border border-border bg-bg px-4 py-3.5">
        <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Quick API reference</div>
        <pre className="overflow-x-auto rounded-lg bg-bg2 p-3.5 font-mono text-[11px] leading-relaxed text-muted">
          <span className="text-subtle"># Ingest text → entities + relations auto-extracted</span>
          {"\n"}
          <span className="text-[#185fa5]">POST</span> /api/v1/instances/<span className="text-[#993c1d]">:id</span>/ingest{"\n"}
          {`{ "content": "Rate Limiter depends on Redis..." }`}
          {"\n\n"}
          <span className="text-subtle"># Traverse from an entity</span>
          {"\n"}
          <span className="text-[#185fa5]">POST</span> /api/v1/instances/<span className="text-[#993c1d]">:id</span>/traverse{"\n"}
          {`{ "start_entity_id": "e_001", "depth": 2, "relations": ["depends_on"] }`}
          {"\n\n"}
          <span className="text-subtle"># Semantic entity search</span>
          {"\n"}
          <span className="text-[#185fa5]">POST</span> /api/v1/instances/<span className="text-[#993c1d]">:id</span>/query{"\n"}
          {`{ "query": "What does the API Layer depend on?" }`}
          {"\n\n"}
          <span className="text-subtle"># View repair queue</span>
          {"\n"}
          <span className="text-[#185fa5]">GET</span> /api/v1/instances/<span className="text-[#993c1d]">:id</span>/repair-queue{"\n\n"}
          <span className="text-subtle"># Run lint check</span>
          {"\n"}
          <span className="text-[#185fa5]">POST</span> /api/v1/instances/<span className="text-[#993c1d]">:id</span>/lint
        </pre>
      </div>

      <div className="mt-3 rounded-[12px] border border-border bg-bg px-4 py-3.5">
        <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">After creation</div>
        <div className="flex gap-2.5 text-[12px] text-muted">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#993c1d] text-[10px] font-semibold text-white">
            1
          </span>
          <div>
            <strong className="font-medium text-ink">Ingest your first documents.</strong> The extraction worker will
            auto-identify entities and typed relations using the ontology you defined. Each takes ~5–15 seconds (async).
          </div>
        </div>
        <div className="mt-2 flex gap-2.5 text-[12px] text-muted">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#993c1d] text-[10px] font-semibold text-white">
            2
          </span>
          <div>
            <strong className="font-medium text-ink">Traverse the graph.</strong> Use{" "}
            <code className="rounded bg-bg2 px-1 font-mono text-[10px]">POST /traverse</code> with an entity ID and depth to
            walk the graph and find connected entities.
          </div>
        </div>
        <div className="mt-2 flex gap-2.5 text-[12px] text-muted">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#993c1d] text-[10px] font-semibold text-white">
            3
          </span>
          <div>
            <strong className="font-medium text-ink">Monitor health.</strong> Check{" "}
            <code className="rounded bg-bg2 px-1 font-mono text-[10px]">GET /health</code> for evidence_grounding (target:
            100%), stale_ratio (&lt;10%), and concept_purity (&gt;0.70).
          </div>
        </div>
        <div className="mt-2 flex gap-2.5 text-[12px] text-muted">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#993c1d] text-[10px] font-semibold text-white">
            4
          </span>
          <div>
            <strong className="font-medium text-ink">Run lint.</strong> Use{" "}
            <code className="rounded bg-bg2 px-1 font-mono text-[10px]">POST /lint</code> regularly to detect Graph Sludge — ungrounded nodes, orphan
            entities, inflated confidence scores.
          </div>
        </div>
      </div>
    </>
  );
}
