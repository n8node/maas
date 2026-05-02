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
  const data = (await parseJson(res)) as { data: { user: MeUser } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Session expired");
  }
  return data.data.user;
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

export async function listInstances(token: string): Promise<MemoryInstanceDTO[]> {
  const res = await fetch(`${API_BASE}/instances`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await parseJson(res)) as { data: { instances: MemoryInstanceDTO[] } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load instances");
  }
  return data.data.instances;
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
  const data = (await parseJson(res)) as { data: { instance: MemoryInstanceDTO } } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not load instance");
  }
  return data.data.instance;
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
};

export async function ingestInstance(
  token: string,
  id: string,
  body: { text: string; user_id?: string; source_label?: string },
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
};

export async function queryInstance(
  token: string,
  id: string,
  body: { query: string; top_k?: number; user_id?: string },
): Promise<QueryResultDTO> {
  const res = await fetch(`${API_BASE}/instances/${encodeURIComponent(id)}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await parseJson(res)) as { data: QueryResultDTO } & Partial<ApiErrBody>;
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Query failed");
  }
  return data.data;
}
