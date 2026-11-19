"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/app/session";
import { Question } from "@/components/setup/question";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import type { Budget } from "@/lib/budget";
import { LOCATIONS } from "@/lib/voucher-codes";
import { EMPTY_VOUCHER_SETUP, type VoucherSetup } from "@/lib/voucher-setup";

/**
 * Project setup: the expense voucher's coding, set once (the CFO's rule). The contract, the account
 * the project pays from and the one withheld tax is held in, and each budget line's donor budget
 * code and location. Finance then picks only the GL account and department on each voucher.
 */

const input = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";

async function api<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

function LocationSelect({ value, onChange, blank }: { value: string; onChange: (v: string) => void; blank: string }) {
  const groups = [...new Set(LOCATIONS.map((l) => l.group ?? ""))];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={input}>
      <option value="">{blank}</option>
      {value && !LOCATIONS.some((l) => l.code === value) && <option value={value}>{value}</option>}
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {LOCATIONS.filter((l) => l.group === g).map((l) => (
            <option key={`${g}-${l.code}`} value={l.code}>
              {l.code} {l.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function VoucherCodingStep({ code, onDone }: { code: string; onDone: () => void }) {
  const { user } = useSession();
  const [setup, setSetup] = useState<VoucherSetup | null>(null);
  const [lines, setLines] = useState<Budget["lines"]>([]);
  const [all, setAll] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api<VoucherSetup>(`/api/projects/${code}/voucher-coding`, user?.id), api<Budget>(`/api/projects/${code}/budget`, user?.id)])
      .then(([s, b]) => {
        setSetup({ ...EMPTY_VOUCHER_SETUP, ...s });
        setLines(b.lines);
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, [code, user?.id]);

  if (!setup) return <p className="text-sm text-muted">{error || "Loading…"}</p>;
  const set = (patch: Partial<VoucherSetup>) => {
    setSetup({ ...setup, ...patch });
    setDirty(true);
  };
  const setLine = (c: string, patch: { budgetCode?: string; location?: string }) => set({ lines: { ...setup.lines, [c]: { ...setup.lines[c], ...patch } } });
  const shown = all ? lines : lines.filter((l) => l.procure);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/projects/${code}/voucher-coding`, user?.id, { method: "PUT", body: JSON.stringify(setup) });
      setDirty(false);
      onDone();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Question title="Coding for expense vouchers" help="Set once for the project. Each voucher starts from these, and Finance picks only the GL account and department when processing it.">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Contract
          <input value={setup.contract} onChange={(e) => set({ contract: e.target.value })} placeholder="e.g. ACRP-01003467" className={`mt-1 ${input}`} />
        </label>
        <label className="text-sm font-medium">
          Location (for lines without their own)
          <div className="mt-1">
            <LocationSelect value={setup.location} onChange={(location) => set({ location })} blank="Choose…" />
          </div>
        </label>
        <label className="text-sm font-medium">
          Paid from (bank or cash account)
          <input value={setup.bankGl} onChange={(e) => set({ bankGl: e.target.value })} placeholder="e.g. 1020 Citibank" className={`mt-1 ${input}`} />
        </label>
        <label className="text-sm font-medium">
          Withheld tax held in (account)
          <input value={setup.taxGl} onChange={(e) => set({ taxGl: e.target.value })} placeholder="e.g. 2300 Liabilities-Other" className={`mt-1 ${input}`} />
        </label>
      </div>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Budget code and location by budget line</h2>
        <button type="button" onClick={() => setAll(!all)} className="text-xs text-forest underline">
          {all ? "Show only lines bought through procurement" : `Show all ${lines.length} lines`}
        </button>
      </div>
      {!lines.length && <p className="mt-2 text-sm text-muted">Add the budget first; its lines appear here.</p>}
      {shown.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 pr-2 font-medium">Budget line</th>
                <th className="py-1 pr-2 font-medium">Budget code on the voucher</th>
                <th className="py-1 font-medium">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((l) => (
                <tr key={l.code} className="align-top">
                  <td className="py-2 pr-2">
                    <span className="font-mono text-xs">{l.code}</span> {l.description.slice(0, 60)}
                  </td>
                  <td className="py-2 pr-2">
                    <input value={setup.lines[l.code]?.budgetCode ?? ""} onChange={(e) => setLine(l.code, { budgetCode: e.target.value })} placeholder={l.code} className={input} aria-label={`Budget code for ${l.code}`} />
                  </td>
                  <td className="py-2">
                    <LocationSelect value={setup.lines[l.code]?.location ?? ""} onChange={(location) => setLine(l.code, { location })} blank={setup.location ? "Project location" : "Choose…"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-clay">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={() => void save()} disabled={busy || !dirty} className={`${primaryBtn} px-6`}>
          {busy ? "Saving…" : "Save and continue"}
        </button>
        <button type="button" onClick={onDone} className={quietBtn}>
          {dirty ? "Skip without saving" : "Continue"}
        </button>
      </div>
    </Question>
  );
}
