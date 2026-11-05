"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { formatMoney, registerPeople, userById, type AppUser, type Currency } from "@/lib/demo";
import { registerAuthority, type Authority } from "@/lib/authority";
import { hasFeature, type Feature, type Plan } from "@/lib/plans";

/**
 * Who is using the app.
 *
 * Live mode: Supabase Auth with an emailed one-time code; the server says who is signed in.
 * Demo mode (DEMO_SIGN_IN=1 on the server): picking a person stores their id in this browser.
 */

type Mode = "loading" | "demo" | "live";

type Session = {
  mode: Mode;
  /** Live mode: false when the server lacks the Supabase keys, so nobody can sign in yet. */
  configured: boolean;
  user: AppUser | null;
  /** Who is actually signed in. Differs from `user` only under "View as". */
  actor: AppUser | null;
  viewingAs: boolean;
  ready: boolean;
  /** Demo mode only. */
  signIn: (id: string) => void;
  signOut: () => Promise<void>;
  /** Re-reads the signed-in person from the server (after a code is verified). */
  refresh: () => Promise<void>;
  /** Admins in live mode: view the app as another person, read-only. null stops. */
  viewAs: (id: string | null) => Promise<void>;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  money: (usd: number) => string;
  /** The organization's plan; check features with `useFeature`. */
  plan: Plan;
};

const SessionContext = createContext<Session | null>(null);
const KEY = "rop-session-v1";

/** Browser Supabase client for the sign-in screens. Only created in live mode. */
export function supabaseBrowser() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

type ServerSession = { mode: "demo" | "live"; configured: boolean; user: AppUser | null; actor: AppUser | null; viewingAs: boolean; people: AppUser[]; plan: Plan; authority?: Authority };

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>("loading");
  const [configured, setConfigured] = useState(true);
  const [demoId, setDemoId] = useState<string | null>(null);
  const [live, setLive] = useState<{ user: AppUser | null; actor: AppUser | null; viewingAs: boolean }>({ user: null, actor: null, viewingAs: false });
  const [currency, setCurrencyState] = useState<Currency>("USD");
  const [stored, setStored] = useState(false);
  const [plan, setPlan] = useState<Plan>("free");

  const refresh = useCallback(async () => {
    try {
      const s = (await (await fetch("/api/session", { cache: "no-store" })).json()) as ServerSession;
      // Who holds each role type, before any screen asks who signs what.
      registerAuthority(s.authority);
      if (s.mode === "live") {
        registerPeople(s.people);
        setLive({ user: s.user, actor: s.actor, viewingAs: s.viewingAs });
      }
      setConfigured(s.configured);
      setPlan(s.plan ?? "free");
      setMode(s.mode);
    } catch {
      // Without the server we cannot tell who is signed in; fall back to the demo picker.
      setMode("demo");
    }
  }, []);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      if (s.userId) setDemoId(s.userId);
      if (s.currency) setCurrencyState(s.currency);
    } catch {}
    setStored(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!stored) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ userId: demoId, currency }));
    } catch {}
  }, [demoId, currency, stored]);

  const signOut = useCallback(async () => {
    if (mode === "live") {
      await fetch("/api/session/view-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: null }) }).catch(() => {});
      await supabaseBrowser().auth.signOut();
      setLive({ user: null, actor: null, viewingAs: false });
    } else setDemoId(null);
  }, [mode]);

  const viewAs = useCallback(
    async (id: string | null) => {
      const res = await fetch("/api/session/view-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not switch.");
      await refresh();
    },
    [refresh],
  );

  const money = useCallback((usd: number) => formatMoney(usd, currency), [currency]);
  const demoUser = mode === "demo" && demoId ? (userById(demoId) ?? null) : null;

  const value = useMemo<Session>(
    () => ({
      mode,
      configured,
      user: mode === "live" ? live.user : demoUser,
      actor: mode === "live" ? live.actor : demoUser,
      viewingAs: mode === "live" && live.viewingAs,
      ready: stored && mode !== "loading",
      signIn: setDemoId,
      signOut,
      refresh,
      viewAs,
      currency,
      setCurrency: setCurrencyState,
      money,
      plan,
    }),
    [mode, configured, live, demoUser, stored, signOut, refresh, viewAs, currency, money, plan],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
}

/** Whether the organization's plan includes a paid feature. */
export function useFeature(feature: Feature) {
  return hasFeature(useSession().plan, feature);
}

/** Sends anyone who is not signed in back to the sign-in page. */
export function useRequireUser() {
  const s = useSession();
  const router = useRouter();
  useEffect(() => {
    if (s.ready && !s.user) router.replace("/");
  }, [s.ready, s.user, router]);
  return s;
}

export function CurrencyToggle() {
  const { currency, setCurrency } = useSession();
  return (
    <div role="radiogroup" aria-label="Currency" className="flex rounded-full border border-line bg-surface p-0.5 text-xs font-semibold" title="Afs at a demo rate of 70 per USD">
      {(["USD", "AFN"] as Currency[]).map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={currency === c}
          onClick={() => setCurrency(c)}
          className={`rounded-full px-2.5 py-1 transition ${currency === c ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
        >
          {c === "USD" ? "USD" : "Afs"}
        </button>
      ))}
    </div>
  );
}

export function Initials({ name, className = "h-9 w-9 text-sm" }: { name: string; className?: string }) {
  const i = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return <span className={`grid shrink-0 place-items-center rounded-full bg-mist font-display text-forest ${className}`}>{i}</span>;
}
