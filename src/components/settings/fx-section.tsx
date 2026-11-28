"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session";
import { primaryBtn } from "@/components/workspace/ui";
import { LOCAL_CURRENCIES, registerRates, type FxRate, type LocalCurrency } from "@/lib/fx";
import { plainError } from "@/lib/plain-error";

type View = { month: string; may: boolean; now: Record<LocalCurrency, string>; rates: FxRate[] };
const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";

/**
 * MF-11: the month's exchange rates. Every screen and every payment in afghanis or quetzales uses
 * the rate for its month; finance records it at the start of each month, with where it came from.
 */
export function FxSection() {
  const { user } = useSession();
  const [v, setV] = useState<View | null>(null);
  const [f, setF] = useState({ currency: "AFN" as LocalCurrency, month: new Date().toISOString().slice(0, 7), perUsd: "", source: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!user) return;
    const res = await fetch("/api/fx-rates", { cache: "no-store", headers: { "x-demo-user": user.id } });
    if (res.ok) setV(await res.json());
  }, [user]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!user || user.kind !== "employee" || !v) return null;
  const save = async () => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/fx-rates", { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user.id }, body: JSON.stringify({ ...f, perUsd: Number(f.perUsd.replace(",", ".")) }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? plainError(res.status));
    setV(body);
    registerRates(body.rates);
    setF({ ...f, perUsd: "", source: "" });
  };
  return (
    <section className="mt-8" aria-labelledby="fx-heading">
      <h2 id="fx-heading" className="font-semibold">
        Exchange rates
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">Amounts and payments in afghanis and quetzales use the rate for their month. Finance records it at the start of each month.</p>
      <ul className="mt-2 text-sm">
        {LOCAL_CURRENCIES.map((c) => (
          <li key={c}>
            <span className="font-semibold">{c}</span> in {v.month}: {v.now[c]}
          </li>
        ))}
      </ul>
      {v.may && (
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="block text-sm font-medium">
            Currency
            <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as LocalCurrency })} className={field}>
              {LOCAL_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Month
            <input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} className={field} />
          </label>
          <label className="block text-sm font-medium">
            Per US dollar
            <input inputMode="decimal" value={f.perUsd} onChange={(e) => setF({ ...f, perUsd: e.target.value })} className={field} />
          </label>
          <label className="block text-sm font-medium">
            Where it comes from
            <input value={f.source} maxLength={300} placeholder="Central bank, first working day" onChange={(e) => setF({ ...f, source: e.target.value })} className={field} />
          </label>
          <div className="sm:col-span-4">
            <button type="button" disabled={busy || !f.perUsd || f.source.trim().length < 3} onClick={() => void save()} className={primaryBtn}>
              Save the rate
            </button>
            {error && (
              <p role="alert" className="mt-2 text-sm text-clay">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
      {v.rates.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1">Month</th>
              <th>Currency</th>
              <th>Per USD</th>
              <th>Source</th>
              <th>Recorded by</th>
            </tr>
          </thead>
          <tbody>
            {v.rates.slice(0, 24).map((r) => (
              <tr key={`${r.currency}-${r.month}`} className="border-t border-line">
                <td className="py-1 font-mono">{r.month}</td>
                <td>{r.currency}</td>
                <td className="font-mono">{r.perUsd}</td>
                <td>{r.source}</td>
                <td>{r.byName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
