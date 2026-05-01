"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { loginRequest } from "@/lib/api";
import { setToken } from "@/lib/token";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const token = await loginRequest(email.trim(), password);
      setToken(token);
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg3 px-6 py-12">
      <div className="w-full max-w-sm rounded-lg border border-border bg-bg p-6 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-muted">Mnemoniqa</p>
        <h1 className="mt-1 text-lg font-medium text-ink">Sign in</h1>
        <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-border bg-bg2 px-3 py-2 text-ink outline-none ring-border focus:ring-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-border bg-bg2 px-3 py-2 text-ink outline-none ring-border focus:ring-2"
            />
          </label>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-bg transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Continue"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-muted">
          No account?{" "}
          <Link href="/register" className="text-ink underline underline-offset-4">
            Register
          </Link>
        </p>
      </div>
    </main>
  );
}
