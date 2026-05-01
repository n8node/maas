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
