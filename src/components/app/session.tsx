"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { formatMoney, userById, type AppUser, type Currency } from "@/lib/demo";

/**
 * Demo sign-in: picking a person stores their id in this browser. No credentials, no server.
 */

type Session = {
  user: AppUser | null;
  ready: boolean;
  signIn: (id: string) => void;
  signOut: () => void;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  money: (usd: number) => string;
};

const SessionContext = createContext<Session | null>(null);
const KEY = "rop-session-v1";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [currency, setCurrencyState] = useState<Currency>("USD");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      if (s.userId) setUserId(s.userId);
      if (s.currency) setCurrencyState(s.currency);
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ userId, currency }));
    } catch {}
  }, [userId, currency, ready]);

  const money = useCallback((usd: number) => formatMoney(usd, currency), [currency]);

  return (
    <SessionContext.Provider
      value={{
        user: userId ? (userById(userId) ?? null) : null,
        ready,
        signIn: setUserId,
        signOut: () => setUserId(null),
        currency,
        setCurrency: setCurrencyState,
        money,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
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
