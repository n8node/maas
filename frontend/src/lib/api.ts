const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

export type ApiEnvelope<T> = { data: T };
export type ApiErrBody = { error: { code: string; message: string } };

async function parseJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function loginRequest(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = (await parseJson(res)) as ApiEnvelope<{ access_token: string }> & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Login failed");
  }
  return data.data.access_token;
}

export async function registerRequest(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = (await parseJson(res)) as ApiEnvelope<{ access_token: string }> & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Registration failed");
  }
  return data.data.access_token;
}

export type MeUser = { id: string; email: string; role: string };

export async function meRequest(token: string): Promise<MeUser> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data?: { user?: unknown } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Session expired");
  }
  const u = data.data?.user;
  if (!u || typeof u !== "object") {
    throw new Error("Invalid session");
  }
  const o = u as Record<string, unknown>;
  return {
    id: String(o.id ?? ""),
    email: typeof o.email === "string" ? o.email : "",
    role: typeof o.role === "string" ? o.role : "user",
  };
}

export type SubscriptionDTO = {
  id: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
};

export type PlanDTO = {
  id: string;
  name: string;
  slug: string;
  price_monthly_rub: number;
  price_yearly_rub: number;
  max_instances: number;
  monthly_tokens: number;
  max_storage_mb: number;
  allowed_memory_types: string[];
  gardener_enabled: boolean;
  reflective_enabled: boolean;
  bi_temporal_enabled: boolean;
  custom_models: boolean;
  priority_workers: boolean;
  support_level: string;
  is_public: boolean;
  is_archived: boolean;
  sort_order: number;
};

export type BucketDTO = {
  id: string;
  bucket_type: string;
  tokens_total: number;
  tokens_used: number;
  tokens_remaining: number;
  expires_at?: string | null;
};

export type PaymentDTO = {
  id: string;
  type: string;
  amount_kopecks: number;
  currency: string;
  status: string;
  created_at: string;
  completed_at?: string | null;
  notes?: string | null;
};

export type BillingMeData = {
  tokens_remaining: number;
  plan?: PlanDTO;
  subscription?: SubscriptionDTO;
  buckets: BucketDTO[];
  payments: PaymentDTO[];
};

export async function billingMeRequest(token: string): Promise<BillingMeData> {
  const res = await fetch(`${API_BASE}/billing/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data: BillingMeData } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load billing");
  }
  return data.data;
}

export async function listPlans(): Promise<PlanDTO[]> {
  const res = await fetch(`${API_BASE}/plans`);
  const data = (await parseJson(res)) as { data: { plans: PlanDTO[] } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load plans");
  }
  return data.data.plans.filter((p) => p.is_public && !p.is_archived);
}

export type TokenPackageDTO = {
  id: string;
  name: string;
  tokens: number;
  price_rub: number;
  sort_order: number;
};

export async function listTokenPackages(): Promise<TokenPackageDTO[]> {
  const res = await fetch(`${API_BASE}/token-packages`);
  const data = (await parseJson(res)) as { data: { packages: TokenPackageDTO[] } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load packages");
  }
  return data.data.packages;
}

export async function subscribePlan(token: string, planSlug: string): Promise<void> {
  const res = await fetch(`${API_BASE}/billing/subscribe`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ plan_slug: planSlug }),
  });
  if (!res.ok) {
    const data = (await parseJson(res)) as Partial<ApiErrBody>;
    throw new Error(data.error?.message ?? "Could not change plan");
  }
}

export async function cancelSubscription(token: string, cancelAtPeriodEnd: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/billing/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cancel_at_period_end: cancelAtPeriodEnd }),
  });
  if (!res.ok) {
    const data = (await parseJson(res)) as Partial<ApiErrBody>;
    throw new Error(data.error?.message ?? "Could not cancel subscription");
  }
}

export type PlanUpsertPayload = {
  name: string;
  slug: string;
  price_monthly_rub: number;
  price_yearly_rub: number;
  max_instances: number;
  monthly_tokens: number;
  max_storage_mb: number;
  allowed_memory_types: string[];
  gardener_enabled: boolean;
  sort_order: number;
  is_public: boolean;
  is_archived: boolean;
};

export async function adminListPlans(token: string): Promise<PlanDTO[]> {
  const res = await fetch(`${API_BASE}/admin/plans`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data: { plans: PlanDTO[] } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load plans");
  }
  return data.data.plans;
}

export async function adminCreatePlan(token: string, body: PlanUpsertPayload): Promise<string> {
  const res = await fetch(`${API_BASE}/admin/plans`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as { data: { id: string } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not create plan");
  }
  return data.data.id;
}

export async function adminUpdatePlan(token: string, id: string, body: PlanUpsertPayload): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/plans/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await parseJson(res)) as Partial<ApiErrBody>;
    throw new Error(data.error?.message ?? "Could not update plan");
  }
}

export async function adminDeletePlan(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/plans/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = (await parseJson(res)) as Partial<ApiErrBody>;
    throw new Error(data.error?.message ?? "Could not delete plan");
  }
}

export type MemoryInstanceDTO = {
  id: string;
  name: string;
  memory_type: string;
  status: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function normalizeMemoryInstance(raw: unknown): MemoryInstanceDTO {
  const now = new Date().toISOString();
  const fallback = {
    id: "",
    name: "Untitled",
    memory_type: "",
    status: "active",
    config: {} as Record<string, unknown>,
    created_at: now,
    updated_at: now,
  };
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const cfg = r.config;
  const config: Record<string, unknown> =
    cfg != null && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : {};
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? "Untitled"),
    memory_type: String(r.memory_type ?? "")
      .toLowerCase()
      .trim(),
    status: String(r.status ?? "active"),
    config,
    created_at: String(r.created_at ?? now),
    updated_at: String(r.updated_at ?? now),
  };
}

export async function listInstances(token: string): Promise<MemoryInstanceDTO[]> {
  const res = await fetch(`${API_BASE}/instances`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data?: { instances?: unknown } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load instances");
  }
  const rawList = data.data?.instances;
  return Array.isArray(rawList) ? rawList.map(normalizeMemoryInstance) : [];
}

export async function createInstance(
  token: string,
  body: { name: string; memory_type: string; config?: Record<string, unknown> },
): Promise<string> {
  const res = await fetch(`${API_BASE}/instances`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as { data: { id: string } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not create instance");
  }
  return data.data.id;
}

export async function getInstance(token: string, id: string): Promise<MemoryInstanceDTO> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data: { instance?: MemoryInstanceDTO } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load instance");
  }
  const raw = data.data?.instance;
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid instance response");
  }
  return normalizeMemoryInstance(raw);
}

export type RAGStatsDTO = {
  chunk_count: number;
  source_count: number;
  topic_cluster_count: number;
  last_ingest_at?: string;
  queries_today: number;
  avg_topk_score?: number;
  coverage_percent?: number;
  high_conf_percent?: number;
};

export type RAGTopicClusterDTO = {
  id: string;
  title: string;
  tags: string[];
  chunk_count: number;
  score: number;
};

export async function getRagStats(token: string, instanceId: string): Promise<RAGStatsDTO> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(instanceId)}/rag/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data?: unknown } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load RAG stats");
  }
  const d = data.data;
  if (!d || typeof d !== "object") {
    return {
      chunk_count: 0,
      source_count: 0,
      topic_cluster_count: 0,
      queries_today: 0,
    };
  }
  const o = d as Record<string, unknown>;
  return {
    chunk_count: typeof o.chunk_count === "number" && !Number.isNaN(o.chunk_count) ? o.chunk_count : 0,
    source_count: typeof o.source_count === "number" && !Number.isNaN(o.source_count) ? o.source_count : 0,
    topic_cluster_count:
      typeof o.topic_cluster_count === "number" && !Number.isNaN(o.topic_cluster_count) ? o.topic_cluster_count : 0,
    last_ingest_at: typeof o.last_ingest_at === "string" ? o.last_ingest_at : undefined,
    queries_today: typeof o.queries_today === "number" && !Number.isNaN(o.queries_today) ? o.queries_today : 0,
    avg_topk_score: typeof o.avg_topk_score === "number" && !Number.isNaN(o.avg_topk_score) ? o.avg_topk_score : undefined,
    coverage_percent:
      typeof o.coverage_percent === "number" && !Number.isNaN(o.coverage_percent) ? o.coverage_percent : undefined,
    high_conf_percent:
      typeof o.high_conf_percent === "number" && !Number.isNaN(o.high_conf_percent) ? o.high_conf_percent : undefined,
  };
}

export async function getRagTopics(token: string, instanceId: string): Promise<RAGTopicClusterDTO[]> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(instanceId)}/rag/topics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data: { topics: RAGTopicClusterDTO[] } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load topics");
  }
  const topics = data.data?.topics;
  const list = Array.isArray(topics) ? topics : [];
  return list
    .map((t): RAGTopicClusterDTO | null => {
      if (!t || typeof t !== "object") return null;
      const o = t as Record<string, unknown>;
      const tagsRaw = o.tags;
      const tags = Array.isArray(tagsRaw) ? tagsRaw.filter((x): x is string => typeof x === "string") : [];
      const score = typeof o.score === "number" && !Number.isNaN(o.score) ? o.score : 0;
      return {
        id: String(o.id ?? ""),
        title: typeof o.title === "string" ? o.title : String(o.title ?? ""),
        tags,
        chunk_count: typeof o.chunk_count === "number" && !Number.isNaN(o.chunk_count) ? o.chunk_count : 0,
        score,
      };
    })
    .filter((x): x is RAGTopicClusterDTO => x != null);
}

export async function deleteInstance(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = (await parseJson(res)) as Partial<ApiErrBody>;
    throw new Error(data.error?.message ?? "Could not delete instance");
  }
}

export type IngestResultDTO = {
  chunks_added: number;
  tokens_consumed: number;
  wiki_concepts_added?: number;
  wiki_extraction_note?: string;
};

export async function ingestInstance(
  token: string,
  id: string,
  body: {
    text: string;
    user_id?: string;
    session_id?: string;
    valid_from?: string;
    valid_until?: string;
    source_label?: string;
    source_title?: string;
    concepts?: Array<{ title: string; description: string }>;
  },
): Promise<IngestResultDTO> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(id)}/ingest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as { data: IngestResultDTO } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Ingest failed");
  }
  return data.data;
}

export type QueryResultDTO = {
  message: string;
  citations: Array<{ chunk_id: string; snippet: string; score: number }>;
  tokens_used: number;
  synthesized?: boolean;
  wiki_related_concepts?: Array<{ id: string; title: string; state: string }>;
};

export async function queryInstance(
  token: string,
  id: string,
  body: { query: string; top_k?: number; user_id?: string; session_id?: string; as_of?: string; synthesize?: boolean },
): Promise<QueryResultDTO> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(id)}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as { data?: QueryResultDTO } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Query failed");
  }
  const d = data.data;
  if (!d || typeof d !== "object") {
    throw new Error("Invalid query response");
  }
  const relRaw = (d as { wiki_related_concepts?: unknown }).wiki_related_concepts;
  let wiki_related_concepts: QueryResultDTO["wiki_related_concepts"];
  if (Array.isArray(relRaw)) {
    wiki_related_concepts = relRaw
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        const id = typeof o.id === "string" ? o.id : "";
        const title = typeof o.title === "string" ? o.title : "";
        const state = typeof o.state === "string" ? o.state : "";
        if (!id) return null;
        return { id, title, state };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    if (wiki_related_concepts.length === 0) wiki_related_concepts = undefined;
  }
  const synRaw = (d as { synthesized?: unknown }).synthesized;
  const synthesized = synRaw === true;
  return {
    message: typeof d.message === "string" ? d.message : "",
    citations: Array.isArray(d.citations) ? d.citations : [],
    tokens_used: typeof d.tokens_used === "number" && !Number.isNaN(d.tokens_used) ? d.tokens_used : 0,
    synthesized,
    wiki_related_concepts,
  };
}

export type EpisodicStatsDTO = {
  episodes_count: number;
  avg_decay: number;
  users_count: number;
  oldest_entry?: string;
  coverage: number;
  queries_today: number;
  history_months: number;
  anchored_pct: number;
};

export type EpisodicEpisodeDTO = {
  id: string;
  content: string;
  user_scope?: string;
  session_scope?: string;
  decay_weight: number;
  valid_from?: string;
  valid_until?: string;
  created_at: string;
};

export async function getEpisodicStats(token: string, instanceId: string): Promise<EpisodicStatsDTO> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(instanceId)}/episodic/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data?: unknown } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load episodic stats");
  }
  const d = data.data;
  if (!d || typeof d !== "object") {
    return {
      episodes_count: 0,
      avg_decay: 0,
      users_count: 0,
      coverage: 0,
      queries_today: 0,
      history_months: 0,
      anchored_pct: 0,
    };
  }
  const o = d as Record<string, unknown>;
  return {
    episodes_count: typeof o.episodes_count === "number" && !Number.isNaN(o.episodes_count) ? o.episodes_count : 0,
    avg_decay: typeof o.avg_decay === "number" && !Number.isNaN(o.avg_decay) ? o.avg_decay : 0,
    users_count: typeof o.users_count === "number" && !Number.isNaN(o.users_count) ? o.users_count : 0,
    oldest_entry: typeof o.oldest_entry === "string" ? o.oldest_entry : undefined,
    coverage: typeof o.coverage === "number" && !Number.isNaN(o.coverage) ? o.coverage : 0,
    queries_today: typeof o.queries_today === "number" && !Number.isNaN(o.queries_today) ? o.queries_today : 0,
    history_months: typeof o.history_months === "number" && !Number.isNaN(o.history_months) ? o.history_months : 0,
    anchored_pct: typeof o.anchored_pct === "number" && !Number.isNaN(o.anchored_pct) ? o.anchored_pct : 0,
  };
}

export async function listEpisodicEpisodes(
  token: string,
  instanceId: string,
  opts?: { user_id?: string; limit?: number },
): Promise<EpisodicEpisodeDTO[]> {
  const sp = new URLSearchParams();
  if (opts?.user_id) sp.set("user_id", opts.user_id);
  if (typeof opts?.limit === "number" && opts.limit > 0) sp.set("limit", String(Math.floor(opts.limit)));
  const qs = sp.toString();
  const res = await fetch(
    `${API_BASE}/instances/${encodeURIComponent(instanceId)}/episodic/episodes${qs ? `?${qs}` : ""}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const data = (await parseJson(res)) as { data?: { episodes?: unknown } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load episodes");
  }
  const eps = data.data?.episodes;
  const list = Array.isArray(eps) ? eps : [];
  return list
    .map((e): EpisodicEpisodeDTO | null => {
      if (!e || typeof e !== "object") return null;
      const o = e as Record<string, unknown>;
      const decay =
        typeof o.decay_weight === "number" && !Number.isNaN(o.decay_weight) ? o.decay_weight : 1;
      return {
        id: String(o.id ?? ""),
        content: typeof o.content === "string" ? o.content : "",
        user_scope: typeof o.user_scope === "string" ? o.user_scope : undefined,
        session_scope: typeof o.session_scope === "string" ? o.session_scope : undefined,
        decay_weight: decay,
        valid_from: typeof o.valid_from === "string" ? o.valid_from : undefined,
        valid_until: typeof o.valid_until === "string" ? o.valid_until : undefined,
        created_at: typeof o.created_at === "string" ? o.created_at : new Date(0).toISOString(),
      };
    })
    .filter((x): x is EpisodicEpisodeDTO => x != null);
}

export type WikiHealthDTO = {
  coverage: number;
  purity: number;
  stale_ratio: number;
  segment_count: number;
  concept_count: number;
  source_count: number;
  stale_concept_count?: number;
  disputed_concept_count?: number;
};

export async function getWikiHealth(token: string, instanceId: string): Promise<WikiHealthDTO> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(instanceId)}/wiki/health`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data?: unknown } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load wiki health");
  }
  const d = data.data;
  if (!d || typeof d !== "object") {
    return {
      coverage: 0,
      purity: 0,
      stale_ratio: 0,
      segment_count: 0,
      concept_count: 0,
      source_count: 0,
    };
  }
  const o = d as Record<string, unknown>;
  const num = (key: string) =>
    typeof o[key] === "number" && !Number.isNaN(o[key] as number) ? (o[key] as number) : 0;
  return {
    coverage: num("coverage"),
    purity: num("purity"),
    stale_ratio: num("stale_ratio"),
    segment_count: num("segment_count"),
    concept_count: num("concept_count"),
    source_count: num("source_count"),
    stale_concept_count:
      typeof o.stale_concept_count === "number" && !Number.isNaN(o.stale_concept_count as number)
        ? (o.stale_concept_count as number)
        : undefined,
    disputed_concept_count:
      typeof o.disputed_concept_count === "number" && !Number.isNaN(o.disputed_concept_count as number)
        ? (o.disputed_concept_count as number)
        : undefined,
  };
}

export type WikiSourceDTO = {
  id: string;
  title: string;
  user_scope?: string;
  segment_count: number;
  created_at: string;
};

export async function getWikiSources(token: string, instanceId: string): Promise<WikiSourceDTO[]> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(instanceId)}/wiki/sources`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data: { sources: WikiSourceDTO[] } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not list wiki sources");
  }
  return data.data.sources;
}

export type WikiConceptDTO = {
  id: string;
  title: string;
  description: string;
  concept_type: string;
  state: string;
  confidence: number;
  source_id?: string;
  /** Wiki source document title (evidence lineage). */
  source_title?: string;
  created_at: string;
  updated_at: string;
};

export async function getWikiConcepts(token: string, instanceId: string, search?: string): Promise<WikiConceptDTO[]> {
  const q = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(instanceId)}/wiki/concepts${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data: { concepts: WikiConceptDTO[] } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not list concepts");
  }
  const concepts = data.data?.concepts;
  return Array.isArray(concepts) ? concepts : [];
}

export type WikiActionLogEntryDTO = {
  id: string;
  actor: string;
  action: string;
  target_kind: string;
  target_id?: string;
  payload: Record<string, unknown>;
  rationale: string;
  created_at: string;
};

export async function getWikiActionLog(token: string, instanceId: string): Promise<WikiActionLogEntryDTO[]> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(instanceId)}/wiki/action-log`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data: { entries: WikiActionLogEntryDTO[] } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load action log");
  }
  const entries = data.data?.entries;
  return Array.isArray(entries) ? entries : [];
}

export type WikiProposalDTO = {
  id: string;
  proposal_type: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
  resolved_at?: string;
};

export async function getWikiProposals(token: string, instanceId: string, status?: string): Promise<WikiProposalDTO[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(instanceId)}/wiki/gardener/proposals${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data: { proposals: WikiProposalDTO[] } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load proposals");
  }
  const proposals = data.data?.proposals;
  return Array.isArray(proposals) ? proposals : [];
}

export async function getWikiRepairConcepts(token: string, instanceId: string): Promise<WikiConceptDTO[]> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(instanceId)}/wiki/gardener/repair`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data: { concepts: WikiConceptDTO[] } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load repair concepts");
  }
  const concepts = data.data?.concepts;
  return Array.isArray(concepts) ? concepts : [];
}

export type WikiTriageResultDTO = {
  proposals_added: number;
  heuristic_added: number;
  llm_added: number;
  tokens_used: number;
};

export async function postWikiGardenerTriage(token: string, instanceId: string): Promise<WikiTriageResultDTO> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(instanceId)}/wiki/gardener/triage`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data: WikiTriageResultDTO } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Triage failed");
  }
  return data.data;
}

export async function approveWikiProposal(token: string, instanceId: string, proposalId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/instances/${encodeURIComponent(instanceId)}/wiki/gardener/proposals/${encodeURIComponent(proposalId)}/approve`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const data = (await parseJson(res)) as Partial<ApiErrBody>;
    throw new Error(data.error?.message ?? "Approve failed");
  }
}

export async function rejectWikiProposal(token: string, instanceId: string, proposalId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/instances/${encodeURIComponent(instanceId)}/wiki/gardener/proposals/${encodeURIComponent(proposalId)}/reject`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const data = (await parseJson(res)) as Partial<ApiErrBody>;
    throw new Error(data.error?.message ?? "Reject failed");
  }
}

export async function dismissWikiProposal(token: string, instanceId: string, proposalId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/instances/${encodeURIComponent(instanceId)}/wiki/gardener/proposals/${encodeURIComponent(proposalId)}/dismiss`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const data = (await parseJson(res)) as Partial<ApiErrBody>;
    throw new Error(data.error?.message ?? "Dismiss failed");
  }
}

export async function getWikiConcept(token: string, instanceId: string, conceptId: string): Promise<WikiConceptDTO> {
  const res = await fetch(
    `${API_BASE}/instances/${encodeURIComponent(instanceId)}/wiki/concepts/${encodeURIComponent(conceptId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = (await parseJson(res)) as { data?: { concept?: WikiConceptDTO } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load concept");
  }
  const c = data.data?.concept;
  if (!c || typeof c !== "object") {
    throw new Error("Invalid concept response");
  }
  return c;
}

export async function patchWikiConcept(
  token: string,
  instanceId: string,
  conceptId: string,
  body: { state?: string; description?: string },
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/instances/${encodeURIComponent(instanceId)}/wiki/concepts/${encodeURIComponent(conceptId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const data = (await parseJson(res)) as Partial<ApiErrBody>;
    throw new Error(data.error?.message ?? "Update failed");
  }
}

export async function patchInstance(
  token: string,
  instanceId: string,
  body: { config?: Record<string, unknown>; name?: string; status?: string },
): Promise<void> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(instanceId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await parseJson(res)) as Partial<ApiErrBody>;
    throw new Error(data.error?.message ?? "Could not update instance");
  }
}

export type RAGSourceDTO = {
  id: string;
  instance_id: string;
  filename: string;
  byte_size: number;
  mime_type: string;
  embedding_model: string;
  tokens_total: number;
  chunk_count: number;
  created_at: string;
};

export async function listSources(token: string, instanceId: string): Promise<RAGSourceDTO[]> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(instanceId)}/sources`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data: { sources: RAGSourceDTO[] } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not list files");
  }
  return data.data.sources;
}

/** DELETE source by id — RAG file sources and Wiki sources use the same route. */
export async function deleteInstanceSource(
  token: string,
  instanceId: string,
  sourceId: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/instances/${encodeURIComponent(instanceId)}/sources/${encodeURIComponent(sourceId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    const data = (await parseJson(res)) as Partial<ApiErrBody>;
    throw new Error(data.error?.message ?? "Could not delete document");
  }
}

/** @deprecated Prefer deleteInstanceSource — same behavior. */
export const deleteRagSource = deleteInstanceSource;

export type FileIngestResultDTO = {
  source_id: string;
  chunks_added: number;
  tokens_consumed: number;
  embedding_model: string;
  wiki_concepts_added?: number;
  wiki_extraction_note?: string;
};

export async function ingestInstanceFile(
  token: string,
  instanceId: string,
  file: File,
  userId?: string,
): Promise<FileIngestResultDTO> {
  const fd = new FormData();
  fd.append("file", file);
  if (userId) {
    fd.append("user_id", userId);
  }
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(instanceId)}/ingest-file`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const data = (await parseJson(res)) as { data: FileIngestResultDTO } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "File ingest failed");
  }
  return data.data;
}

export type SourceChunkDTO = {
  id: string;
  content: string;
  token_estimate: number;
  created_at: string;
  ordinal: number;
  embedding: number[] | null;
};

export async function listSourceChunks(
  token: string,
  instanceId: string,
  sourceId: string,
  limit = 20,
  offset = 0,
): Promise<{ chunks: SourceChunkDTO[]; total: number }> {
  const path = `${API_BASE}/instances/${encodeURIComponent(instanceId)}/sources/${encodeURIComponent(sourceId)}/chunks?limit=${limit}&offset=${offset}`;
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data: { chunks: SourceChunkDTO[]; total: number } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load chunks");
  }
  return { chunks: data.data.chunks, total: data.data.total };
}

export async function deleteInstanceChunk(
  token: string,
  instanceId: string,
  chunkId: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/instances/${encodeURIComponent(instanceId)}/chunks/${encodeURIComponent(chunkId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    const data = (await parseJson(res)) as Partial<ApiErrBody>;
    throw new Error(data.error?.message ?? "Could not delete chunk");
  }
}

// --- Working memory (session key-value)

export type WorkingStatsDTO = {
  sessions_total: number;
  sessions_active: number;
  keys_total: number;
  default_ttl_minutes: number;
  default_ttl_label: string;
  max_ttl_label: string;
  hit_rate_pct?: number | null;
  storage_used_bytes: number;
  max_storage_mb: number;
};

export type WorkingSessionRowDTO = {
  session_id: string;
  scope_user_id: string;
  key_count: number;
  last_active_at: string;
  status: string;
};

export type WorkingKeyRowDTO = {
  key: string;
  value: unknown;
  expires_at?: string | null;
  is_core: boolean;
  scope_user_id: string;
};

export async function getWorkingStats(token: string, instanceId: string): Promise<WorkingStatsDTO> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(instanceId)}/working/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data?: unknown } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load stats");
  }
  const d = data.data;
  if (!d || typeof d !== "object") {
    return {
      sessions_total: 0,
      sessions_active: 0,
      keys_total: 0,
      default_ttl_minutes: 0,
      default_ttl_label: "—",
      max_ttl_label: "—",
      hit_rate_pct: null,
      storage_used_bytes: 0,
      max_storage_mb: 0,
    };
  }
  const o = d as Record<string, unknown>;
  const num = (key: string) =>
    typeof o[key] === "number" && !Number.isNaN(o[key] as number) ? (o[key] as number) : 0;
  const str = (key: string, fb: string) => (typeof o[key] === "string" ? (o[key] as string) : fb);
  return {
    sessions_total: num("sessions_total"),
    sessions_active: num("sessions_active"),
    keys_total: num("keys_total"),
    default_ttl_minutes: num("default_ttl_minutes"),
    default_ttl_label: str("default_ttl_label", "—"),
    max_ttl_label: str("max_ttl_label", "—"),
    hit_rate_pct: typeof o.hit_rate_pct === "number" && !Number.isNaN(o.hit_rate_pct as number) ? o.hit_rate_pct : null,
    storage_used_bytes: num("storage_used_bytes"),
    max_storage_mb: num("max_storage_mb"),
  };
}

export async function listWorkingSessions(
  token: string,
  instanceId: string,
  opts?: { q?: string; filter?: "active" | "all" },
): Promise<WorkingSessionRowDTO[]> {
  const p = new URLSearchParams();
  if (opts?.q) p.set("q", opts.q);
  if (opts?.filter) p.set("filter", opts.filter);
  const qs = p.toString();
  const res = await fetch(
    `${API_BASE}/instances/${encodeURIComponent(instanceId)}/working/sessions${qs ? `?${qs}` : ""}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = (await parseJson(res)) as { data?: { sessions?: unknown } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not list sessions");
  }
  const rows = data.data?.sessions;
  return Array.isArray(rows) ? (rows as WorkingSessionRowDTO[]) : [];
}

export async function listWorkingKeys(
  token: string,
  instanceId: string,
  sessionId: string,
  keyPrefix?: string,
): Promise<WorkingKeyRowDTO[]> {
  const p = new URLSearchParams();
  if (keyPrefix) p.set("key_prefix", keyPrefix);
  const qs = p.toString();
  const res = await fetch(
    `${API_BASE}/instances/${encodeURIComponent(instanceId)}/working/sessions/${encodeURIComponent(sessionId)}/keys${qs ? `?${qs}` : ""}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = (await parseJson(res)) as { data?: { keys?: unknown } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not list keys");
  }
  const rows = data.data?.keys;
  return Array.isArray(rows) ? (rows as WorkingKeyRowDTO[]) : [];
}

export async function putWorkingKey(
  token: string,
  instanceId: string,
  sessionId: string,
  key: string,
  body: { value: unknown; ttl_seconds?: number | null; scope_user_id?: string | null },
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/instances/${encodeURIComponent(instanceId)}/working/sessions/${encodeURIComponent(sessionId)}/keys/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        value: body.value,
        ttl_seconds: body.ttl_seconds ?? undefined,
        scope_user_id: body.scope_user_id ?? undefined,
      }),
    },
  );
  if (!res.ok) {
    const data = (await parseJson(res)) as Partial<ApiErrBody>;
    throw new Error(data.error?.message ?? "Could not save key");
  }
}

export async function deleteWorkingKey(
  token: string,
  instanceId: string,
  sessionId: string,
  key: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/instances/${encodeURIComponent(instanceId)}/working/sessions/${encodeURIComponent(sessionId)}/keys/${encodeURIComponent(key)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    const data = (await parseJson(res)) as Partial<ApiErrBody>;
    throw new Error(data.error?.message ?? "Could not delete key");
  }
}

export async function flushWorkingExpired(token: string, instanceId: string): Promise<number> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(instanceId)}/working/flush-expired`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data: { deleted: number } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Flush failed");
  }
  return data.data.deleted;
}
