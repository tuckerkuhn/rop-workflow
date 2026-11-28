import { z } from "zod";

/**
 * Local currency (review round 1, MF-11): accounts and payments in afghanis (AFN) and quetzales
 * (GTQ) at the month's rate. Finance records each month's rate (local units per US dollar) with
 * where it came from; every screen and every payment in that month uses it. Until a month has a
 * rate, the afghani falls back to the old fixed 70 (and says so) and the quetzal has none, so an
 * amount in quetzales cannot be turned into dollars until finance enters one.
 *
 * Kept in organization_state ("fx-rates"); registered on the server per request and in the
 * browser with the session, like the authority table, so the money helpers stay plain functions.
 */

export const FX_KEY = "fx-rates";
export const LOCAL_CURRENCIES = ["AFN", "GTQ"] as const;
export type LocalCurrency = (typeof LOCAL_CURRENCIES)[number];
/** Used only while finance has entered no rate for the month: the app's old demo rate. */
export const FALLBACK_PER_USD: Partial<Record<LocalCurrency, number>> = { AFN: 70 };

export type FxRate = { currency: LocalCurrency; month: string; perUsd: number; source: string; by: string; byName: string; at: string };
export type FxState = { rates: FxRate[] };
export const EMPTY_FX: FxState = { rates: [] };

export const fxInput = z.object({
  currency: z.enum(LOCAL_CURRENCIES),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose the month."),
  perUsd: z.number().positive("The rate must be above zero.").max(1_000_000),
  source: z.string().trim().min(3, "Say where the rate comes from (for example the central bank's rate on the first working day).").max(300),
});
export type FxInput = z.infer<typeof fxInput>;

let table: FxRate[] = [];
/** Called with the organization's rates: on the server per request, in the browser with the session. */
export function registerRates(rates: FxRate[] | null | undefined) {
  table = rates ?? [];
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** The rate in force for a month: that month's, else the latest before it. Null when none was entered. */
export function rateEntry(currency: string, month = thisMonth(), rates: FxRate[] = table): FxRate | null {
  return rates.filter((r) => r.currency === currency && r.month <= month).sort((a, b) => b.month.localeCompare(a.month))[0] ?? null;
}

/** Local units per US dollar for a day or month: 1 for USD; the month's rate; the fallback; or null. */
export function perUsd(currency: string, when?: string, rates: FxRate[] = table): number | null {
  if (currency === "USD") return 1;
  const e = rateEntry(currency, when ? when.slice(0, 7) : thisMonth(), rates);
  return e?.perUsd ?? FALLBACK_PER_USD[currency as LocalCurrency] ?? null;
}

/** An amount in dollars, or null when the currency has no rate yet. */
export const toUsdAt = (amount: number, currency: string, when?: string, rates?: FxRate[]) => {
  const r = perUsd(currency, when, rates);
  return r ? amount / r : null;
};

/** The ledger's rate for a payment in this currency: dollars per one local unit (lib/ledger rules), as text. */
export const ledgerRate = (currency: string, when?: string, rates?: FxRate[]) => {
  const r = perUsd(currency, when, rates);
  return r ? String(Math.round((1 / r) * 1e8) / 1e8) : null;
};

/** "70 per USD (fixed fallback: no rate entered for 2026-11)" or "68.9 per USD (Da Afghanistan Bank, 1 Nov)". */
export function rateText(currency: LocalCurrency, month = thisMonth(), rates: FxRate[] = table): string {
  const e = rateEntry(currency, month, rates);
  if (e) return `${e.perUsd} ${currency} per USD (${e.source}${e.month !== month ? `, the rate for ${e.month}` : ""})`;
  const f = FALLBACK_PER_USD[currency];
  return f ? `${f} ${currency} per USD (a fixed fallback: finance has entered no rate for ${month})` : `no ${currency} rate entered yet`;
}
