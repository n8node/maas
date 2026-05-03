"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";

import { ingestInstance, patchInstance, type MemoryInstanceDTO } from "@/lib/api";
import { MemoryTypePillsRow } from "@/components/instances/MemoryTypePillsRow";
import { getToken } from "@/lib/token";

type GraphTab = "playground" | "entities" | "relations" | "repair" | "settings";

const gCol = "#993c1d";
const gBg = "#faece7";

const MOCK_ENTITIES = [
  { name: "MemoryService", type: "product", typeCol: "#185fa5", typeBg: "#e6f1fb", confidence: 0.93, relations: 3 },
  { name: "API Layer", type: "component", typeCol: "#534ab7", typeBg: "#eeedfe", confidence: 0.91, relations: 2 },
  { name: "Rate Limiter", type: "infrastructure", typeCol: "#3b6d11", typeBg: "#eaf3de", confidence: 0.87, relations: 1 },
  { name: "Database", type: "infrastructure", typeCol: "#3b6d11", typeBg: "#eaf3de", confidence: 0.95, relations: 2 },
  { name: "Redis", type: "component", typeCol: "#534ab7", typeBg: "#eeedfe", confidence: 0.72, relations: 2 },
] as const;

const MOCK_RELATIONS = [
  { from: "MemoryService", rel: "enables", to: "API Layer", confidence: 0.91, state: "active" as const },
  { from: "API Layer", rel: "depends on", to: "Database", confidence: 0.95, state: "active" as const },
  { from: "Rate Limiter", rel: "part_of", to: "API Layer", confidence: 0.87, state: "active" as const },
  { from: "Redis", rel: "enables", to: "Rate Limiter", confidence: 0.72, state: "disputed" as const },
] as const;

const MOCK_REPAIR = [
  {
    pri: "H" as const,
    title: "Redis — Rate Limiter (enables)",
    sub: "Source deleted — confidence dropped to 0.31",
    dot: "#a32d2d",
    bg: "#fcebeb",
  },
  {
    pri: "H" as const,
    title: "API Layer — PostgreSQL (depends_on)",
    sub: "Contradicting evidence from source_789",
    dot: "#a32d2d",
    bg: "#fcebeb",
  },
  {
    pri: "M" as const,
    title: "MemoryService (entity)",
    sub: "Description stale — last updated 45 days ago",
    dot: "#ba7517",
    bg: "#faeeda",
  },
  {
    pri: "L" as const,
    title: "Component — Infrastructure",
    sub: "Weak evidence — single mention only",
    dot: "#888780",
    bg: "#f3f2ef",
  },
] as const;

const SECTION_LABEL = "mb-3 text-[10px] font-medium uppercase tracking-[0.1em] text-subtle";
const CARD = "rounded-[12px] border border-border bg-bg";

function formatGraphInstanceId(id: string): string {
  const c = id.replace(/-/g, "");
  return `inst_${c.slice(0, 6)}`;
}

function formatCreatedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function tabUnderlineColor(tab: GraphTab, active: GraphTab): string | undefined {
  if (tab !== active) return undefined;
  if (tab === "entities" || tab === "relations") return gCol;
  return "#1a1a1a";
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="flex min-w-[120px] items-center gap-2">
      <div className="h-1.5 w-[72px] shrink-0 overflow-hidden rounded-full bg-bg2">
        <div className="h-full rounded-full bg-[#993c1d]" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[12px] font-medium tabular-nums text-ink">{value.toFixed(2)}</span>
    </div>
  );
}

/** Playground graph: MemoryService, API Layer, Database, Rate Limiter, PostgreSQL — match mock. */
function GraphPlaygroundVisualization() {
  return (
    <svg
      width="100%"
      height="240"
      viewBox="0 0 520 240"
      xmlns="http://www.w3.org/2000/svg"
      className="block max-h-[240px]"
      aria-hidden
    >
      <line x1="120" y1="120" x2="220" y2="70" stroke="#d3d1c7" strokeWidth="1.5" />
      <line x1="120" y1="120" x2="220" y2="170" stroke="#d3d1c7" strokeWidth="1.5" />
      <line x1="260" y1="70" x2="350" y2="50" stroke="#d3d1c7" strokeWidth="1.5" />
      <line x1="260" y1="70" x2="350" y2="120" stroke="#d3d1c7" strokeWidth="1.5" />
      <line x1="260" y1="170" x2="350" y2="120" stroke="#d3d1c7" strokeWidth="1.5" />
      <line x1="260" y1="170" x2="350" y2="190" stroke="#d3d1c7" strokeWidth="1.5" />
      <text x="175" y="88" fontSize="8" fill="#888780" textAnchor="middle">
        enables
      </text>
      <text x="175" y="148" fontSize="8" fill="#888780" textAnchor="middle">
        depends on
      </text>
      <text x="302" y="52" fontSize="8" fill="#888780" textAnchor="middle">
        part of
      </text>
      <g>
        <circle cx="95" cy="120" r="24" fill="#faece7" stroke="#993c1d" strokeWidth="1.5" />
        <text x="95" y="116" fontSize="8.5" fontWeight="500" fill="#993c1d" textAnchor="middle">
          Memory
        </text>
        <text x="95" y="127" fontSize="8.5" fill="#993c1d" textAnchor="middle">
          Service
        </text>
      </g>
      <g>
        <circle cx="240" cy="70" r="20" fill="#e6f1fb" stroke="#185fa5" strokeWidth="1.5" />
        <text x="240" y="68" fontSize="8.5" fontWeight="500" fill="#185fa5" textAnchor="middle">
          API Layer
        </text>
      </g>
      <g>
        <circle cx="240" cy="170" r="20" fill="#faeeda" stroke="#854f0b" strokeWidth="1.5" />
        <text x="240" y="164" fontSize="8.5" fontWeight="500" fill="#854f0b" textAnchor="middle">
          Rate
        </text>
        <text x="240" y="174" fontSize="8.5" fill="#854f0b" textAnchor="middle">
          Limiter
        </text>
      </g>
      <g>
        <circle cx="375" cy="50" r="18" fill="#eaf3de" stroke="#3b6d11" strokeWidth="1.5" />
        <text x="375" y="53" fontSize="8.5" fontWeight="500" fill="#3b6d11" textAnchor="middle">
          Database
        </text>
      </g>
      <g>
        <circle cx="375" cy="120" r="18" fill="#f8f8f7" stroke="#888780" strokeWidth="1.5" />
        <text x="375" y="123" fontSize="8.5" fontWeight="500" fill="#5f5e5a" textAnchor="middle">
          PostgreSQL
        </text>
      </g>
      <g>
        <circle cx="375" cy="190" r="16" fill="#faece7" stroke="#993c1d" strokeWidth="1.5" />
        <text x="375" y="186" fontSize="8" fontWeight="500" fill="#993c1d" textAnchor="middle">
          Redis
        </text>
      </g>
    </svg>
  );
}

function GraphKpiCell({
  value,
  label,
  sub,
  className,
}: {
  value: string;
  label: string;
  sub: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "min-w-0 border-b border-border px-3 py-3 sm:px-4 sm:py-4 lg:border-b-0 lg:border-r lg:border-border lg:py-4 lg:last:border-r-0",
        className,
      )}
    >
      <div className="text-2xl font-medium tracking-tight text-ink">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-subtle">{label}</div>
      <div className="mt-0.5 text-[11px] text-muted">{sub}</div>
    </div>
  );
}

export function GraphInstancePanels({
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
  const [tab, setTab] = useState<GraphTab>("playground");
  const [settingsBusy, setSettingsBusy] = useState(false);

  const [startEntity, setStartEntity] = useState("");
  const [traverseDepth, setTraverseDepth] = useState("2");
  const [traverseResult, setTraverseResult] = useState<React.ReactNode>(
    <>
      MemoryService —{" "}
      <span className="font-medium text-[#993c1d]">(enables)</span>
      {` → API Layer `}
      <span className="font-medium text-[#993c1d]">(EntityID_02)</span>
      {` — `}
      <span className="font-medium text-[#993c1d]">(depends_on)</span>
      {` → Rate Limiter `}
      <span className="font-medium text-[#993c1d]">(EntityID_04)</span>
      . Path confidence: 0.87.
    </>,
  );
  const [traverseMeta] = useState("Depth: 2 — Relations: 3 — Entities: 4");

  const [ingestText, setIngestText] = useState(
    "Redis caches API responses for Rate Limiter (enables)",
  );
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);

  const idLabel = useMemo(() => formatGraphInstanceId(inst.id || "00000000"), [inst.id]);
  const createdLabel = useMemo(() => formatCreatedDate(inst.created_at), [inst.created_at]);

  const statusLabel = inst.status ? inst.status.charAt(0).toUpperCase() + inst.status.slice(1) : "—";

  async function runIngestExtract() {
    if (!token) return;
    const t = ingestText.trim();
    if (!t) return;
    setIngestBusy(true);
    setIngestMsg(null);
    try {
      await ingestInstance(token, instanceId, {
        text: t,
        source_label: "graph-playground",
      });
      setIngestMsg("Request accepted. Extraction may run asynchronously.");
    } catch (e) {
      setIngestMsg(e instanceof Error ? e.message : "Ingest failed");
    } finally {
      setIngestBusy(false);
    }
  }

  function runTraverse() {
    const d = traverseDepth;
    const seed = startEntity.trim() || "MemoryService";
    setTraverseResult(
      <>
        {seed} — <span className="font-medium text-[#993c1d]">(enables)</span>
        {` → API Layer `}
        <span className="font-medium text-[#993c1d]">(EntityID_02)</span>
        {d === "1"
          ? ". Path confidence: 0.82."
          : (
              <>
                {` — `}
                <span className="font-medium text-[#993c1d]">(depends_on)</span>
                {` → Rate Limiter `}
                <span className="font-medium text-[#993c1d]">(EntityID_04)</span>
                . Path confidence: 0.87.
              </>
            )}
      </>,
    );
  }

  async function onPauseToggle() {
    if (!token) return;
    setSettingsBusy(true);
    try {
      await patchInstance(token, instanceId, {
        status: inst.status === "active" ? "paused" : "active",
      });
      await onRefreshInstance();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not update status");
    } finally {
      setSettingsBusy(false);
    }
  }

  async function onDangerDelete() {
    await onDeleteInstance();
  }

  const tabs: [GraphTab, string][] = [
    ["playground", "Playground"],
    ["entities", "Entities"],
    ["relations", "Relations"],
    ["repair", "Repair queue"],
    ["settings", "Settings"],
  ];

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col bg-bg3">
      <div className="border-b border-border bg-accent-bg px-4 py-3 text-[12px] leading-relaxed text-accent sm:px-6 lg:px-7">
        <strong className="font-medium text-ink">Demo UI only:</strong>{" "}
        <span className="text-muted">
          Graph memory ingest/query and traverse are not wired to production handlers yet — actions here do not mutate a real knowledge graph backend.
          Use Agents or Wiki/RAG flows for backed APIs today.
        </span>
      </div>
      <div className="border-b border-border bg-bg px-4 py-3 sm:px-6 lg:px-7">
        <MemoryTypePillsRow activeId="graph" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg px-4 py-3 sm:px-6 lg:px-7">
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <Link href="/instances" className="hover:text-ink">
            Instances
          </Link>
          <span className="text-border2">›</span>
          <span className="font-semibold text-ink">{inst.name}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-border2 px-2.5 py-1 text-[12px] text-muted"
            style={{ backgroundColor: "#faeeda" }}
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#ba7517]" aria-hidden />
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={() => setTab("repair")}
            className="rounded-lg border border-border2 bg-bg px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-bg2"
          >
            Run invalidation
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
            onClick={() => setTab("playground")}
            className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-bg hover:opacity-90"
          >
            Ingest
          </button>
        </div>
      </div>

      <div className="grid w-full min-w-0 grid-cols-2 border-b border-border bg-bg sm:grid-cols-3 lg:grid-cols-5">
        <GraphKpiCell value="1.1K" label="Entities" sub="8 types" />
        <GraphKpiCell value="3.4K" label="Relations" sub="6 relation types" />
        <GraphKpiCell value="4" label="Repair queue" sub="2 high priority" />
        <GraphKpiCell value="100%" label="Grounding" sub="all have source_id" />
        <GraphKpiCell value="0.81" label="Avg confidence" sub="17 disputed" className="lg:border-r-0" />
      </div>

      <div className="border-b border-border bg-bg px-4 sm:px-6 lg:px-7">
        <nav className="flex flex-wrap gap-1 pt-1" aria-label="Graph instance">
          {tabs.map(([id, label]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={clsx(
                  "-mb-px border-b-2 px-3 py-3 text-[13px] transition-colors",
                  active ? "font-medium text-ink" : "border-transparent text-muted hover:text-ink",
                )}
                style={
                  active
                    ? { borderBottomColor: tabUnderlineColor(id, tab) ?? "#1a1a1a" }
                    : { borderBottomColor: "transparent" }
                }
              >
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "playground" ? (
          <div className="grid w-full min-w-0 grid-cols-1 gap-5 px-4 py-6 lg:grid-cols-2 lg:gap-6 sm:px-6 lg:px-7">
            <div className={clsx(CARD, "p-4 sm:p-5")}>
              <h2 className={SECTION_LABEL}>Graph visualization</h2>
              <GraphPlaygroundVisualization />
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <label className="min-w-[140px] flex-1">
                  <span className="mb-1 block text-[11px] text-subtle">Start entity</span>
                  <input
                    className="h-[34px] w-full rounded-lg border border-border2 bg-bg px-2.5 text-[13px] text-ink outline-none focus:border-[#c04d25]"
                    placeholder="Start entity"
                    value={startEntity}
                    onChange={(e) => setStartEntity(e.target.value)}
                  />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] text-subtle">Depth</span>
                  <select
                    className="h-[34px] cursor-pointer rounded-lg border border-border2 bg-bg px-2.5 text-[13px] text-ink outline-none focus:border-[#c04d25]"
                    value={traverseDepth}
                    onChange={(e) => setTraverseDepth(e.target.value)}
                  >
                    <option value="1">depth 1</option>
                    <option value="2">depth 2</option>
                    <option value="3">depth 3</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={runTraverse}
                  className="h-[34px] rounded-lg bg-ink px-4 text-[13px] font-medium text-bg hover:opacity-90"
                >
                  Traverse
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-5">
              <div className={clsx(CARD, "p-4 sm:p-5")}>
                <h2 className={SECTION_LABEL}>Traverse result</h2>
                <p className="text-[13px] leading-relaxed text-ink">{traverseResult}</p>
                <p className="mt-3 text-[11px] text-subtle">{traverseMeta}</p>
              </div>
              <div className={clsx(CARD, "p-4 sm:p-5")}>
                <h2 className={SECTION_LABEL}>Ingest entity/relation</h2>
                <textarea
                  className="min-h-[100px] w-full resize-y rounded-lg border border-border2 bg-bg px-3 py-2 text-[13px] text-ink outline-none focus:border-[#c04d25]"
                  value={ingestText}
                  onChange={(e) => setIngestText(e.target.value)}
                />
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={ingestBusy || !ingestText.trim()}
                    onClick={() => void runIngestExtract()}
                    className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
                  >
                    {ingestBusy ? "Sending…" : "Extract & Ingest"}
                  </button>
                  {ingestMsg ? <p className="mt-2 text-[12px] text-muted">{ingestMsg}</p> : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "entities" ? (
          <div className="px-4 py-6 sm:px-6 lg:px-7">
            <div className={clsx(CARD, "overflow-hidden")}>
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-bg2">
                    <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">Entity</th>
                    <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">Type</th>
                    <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">
                      Confidence
                    </th>
                    <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">
                      Relations
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_ENTITIES.map((row) => (
                    <tr key={row.name} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium text-ink">{row.name}</td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium"
                          style={{ color: row.typeCol, backgroundColor: row.typeBg }}
                        >
                          {row.type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <ConfidenceBar value={row.confidence} />
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted">{row.relations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "relations" ? (
          <div className="px-4 py-6 sm:px-6 lg:px-7">
            <div className={clsx(CARD, "overflow-hidden")}>
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-bg2">
                    <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">From</th>
                    <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">Relation</th>
                    <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">To</th>
                    <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">
                      Confidence
                    </th>
                    <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">State</th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_RELATIONS.map((row) => (
                    <tr key={`${row.from}-${row.rel}-${row.to}`} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium text-ink">{row.from}</td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex rounded-full border border-[#993c1d] px-2 py-0.5 text-[11px] font-medium text-[#993c1d]"
                          style={{ backgroundColor: gBg }}
                        >
                          {row.rel}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-ink">{row.to}</td>
                      <td className="px-4 py-3">
                        <ConfidenceBar value={row.confidence} />
                      </td>
                      <td className="px-4 py-3">
                        {row.state === "active" ? (
                          <span className="inline-flex rounded-full bg-[#eaf3de] px-2 py-0.5 text-[11px] font-medium text-[#3b6d11]">
                            active
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full border border-[#f09595] bg-[#fcebeb] px-2 py-0.5 text-[11px] font-medium text-[#a32d2d]">
                            disputed
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "repair" ? (
          <div className="px-4 py-6 sm:px-6 lg:px-7">
            <div
              className="mb-5 flex flex-col gap-3 rounded-[12px] border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderColor: "#e8c9bf", backgroundColor: gBg }}
            >
              <div>
                <div className="text-[13px] font-semibold text-[#993c1d]">4 items in repair queue</div>
                <div className="mt-0.5 text-[12px] text-[#993c1d]/90">2 high priority — source invalidation detected</div>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-lg px-4 py-2 text-[12px] font-medium text-white hover:opacity-90"
                style={{ backgroundColor: gCol }}
              >
                Run Invalidation
              </button>
            </div>
            <div className={clsx(CARD, "divide-y divide-border")}>
              {MOCK_REPAIR.map((item) => (
                <div key={item.title} className="flex items-start gap-3 px-4 py-3.5">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ backgroundColor: item.dot }}
                  >
                    {item.pri}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">{item.title}</div>
                    <div className="mt-0.5 text-[12px] text-muted">{item.sub}</div>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-border2 bg-bg px-3 py-1.5 text-[11px] font-medium text-muted hover:bg-bg2"
                  >
                    Resolve
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {tab === "settings" ? (
          <div className="px-4 py-6 sm:px-6 lg:px-7">
            <div className="mx-auto grid max-w-4xl grid-cols-1 gap-5 lg:grid-cols-2">
              <div className={clsx(CARD, "p-5")}>
                <h2 className={SECTION_LABEL}>Basic</h2>
                <dl className="divide-y divide-border">
                  {(
                    [
                      ["Name", inst.name],
                      ["Type", "Graph"],
                      ["Created", createdLabel],
                      ["Instance ID", idLabel],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-4 py-2.5 text-[13px]">
                      <dt className="text-muted">{k}</dt>
                      <dd className="text-right font-medium text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className={clsx(CARD, "p-5")}>
                <h2 className={SECTION_LABEL}>Danger zone</h2>
                <p className="text-[13px] leading-relaxed text-muted">
                  Pausing stops all operations. Deleting is permanent.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={settingsBusy}
                    onClick={() => void onPauseToggle()}
                    className="rounded-lg border border-border2 bg-bg px-4 py-2 text-[13px] font-medium text-ink hover:bg-bg2 disabled:opacity-50"
                  >
                    {inst.status === "active" ? "Pause instance" : "Resume instance"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDangerDelete()}
                    className="rounded-lg border border-error-border bg-bg px-4 py-2 text-[13px] font-medium text-error hover:bg-error-bg"
                  >
                    Delete instance
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
