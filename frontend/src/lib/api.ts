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
