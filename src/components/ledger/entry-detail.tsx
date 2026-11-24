"use client";

import { useCallback, useEffect, useState } from "react";
import { acct } from "@/lib/file-store";
import { newKey, type SaveOutcome } from "@/lib/ledger/screens";
import { plainError } from "@/lib/plain-error";
import { dangerBtn, quietBtn } from "@/components/workspace/ui";
import type { EntryLineView, EntryView } from "@/server/ledger-view";

/**
 * Shared by the ledger screens: the request helper, how money is shown and one entry opened up
 * with what it wrote to the books, its receipt and the Reverse action.
 */

export async function ledgerCall<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as T;
}

/** "1234.5" in USD → "USD 1,234.50". Shown only: every sum is made on the server in cents. */
export const money = (v: string | number, currency: string) => `${currency} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const figure = (v: string) => (Number(v) === 0 ? "" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Opens a payment's receipt in a new tab. */
export async function openLedgerReceipt(code: string, hash: string, user: string | undefined) {
  const res = await fetch(`/api/projects/${code}/ledger/receipt/${hash}`, { headers: { "x-demo-user": user ?? "" } });
  if (!res.ok) return;
  window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
}

/**
 * The journal lines of an entry, in a ruled table: the account, what went in and out and the
 * same in the organization's own currency. The one place debits and credits are named.
 */
export function JournalLines({ lines, currency, rule }: { lines: Pick<EntryLineView, "no" | "code" | "account" | "debit" | "credit" | "currency" | "fxRate" | "functionalDebit" | "functionalCredit" | "budgetLine" | "donor">[]; currency: string; rule: string }) {
  const foreign = lines.some((l) => l.currency !== currency);
  return (
    <div className="mt-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-t-2 border-ink text-sm">
          <thead className="text-xs uppercase tracking-[0.12em] text-muted">
            <tr className="border-b border-line">
              <th className="w-8 px-2 py-2 text-start font-semibold">No.</th>
              <th className="px-2 py-2 text-start font-semibold">Account</th>
              <th className="px-2 py-2 text-end font-semibold">Debit</th>
              <th className="px-2 py-2 text-end font-semibold">Credit</th>
              {foreign && <th className="px-2 py-2 text-end font-semibold">Rate</th>}
              {foreign && <th className="px-2 py-2 text-end font-semibold">Debit {currency}</th>}
              {foreign && <th className="px-2 py-2 text-end font-semibold">Credit {currency}</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.no} className="border-b border-line align-top">
                <td className="px-2 py-2 font-mono text-xs text-muted">{String(l.no).padStart(2, "0")}</td>
                <td className="px-2 py-2">
                  <span className="font-mono text-xs text-muted">{l.code}</span> {l.account}
                  {(l.budgetLine || l.donor) && <span className="block text-xs text-muted">{[l.budgetLine && `Budget line ${l.budgetLine}`, l.donor && `Donor: ${l.donor}`].filter(Boolean).join(" · ")}</span>}
                </td>
                <td className="px-2 py-2 text-end font-mono tabular-nums">{figure(l.debit)}</td>
                <td className="px-2 py-2 text-end font-mono tabular-nums">{figure(l.credit)}</td>
                {foreign && <td className="px-2 py-2 text-end font-mono text-xs tabular-nums">{l.currency === currency ? "1" : `${Number(l.fxRate)} ${currency} for 1 ${l.currency}`}</td>}
                {foreign && <td className="px-2 py-2 text-end font-mono tabular-nums">{figure(l.functionalDebit)}</td>}
                {foreign && <td className="px-2 py-2 text-end font-mono tabular-nums">{figure(l.functionalCredit)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 max-w-2xl text-xs text-muted">
        Amounts in {lines[0]?.currency ?? currency}. The two columns always add up to the same figure. {rule}
      </p>
    </div>
  );
}

/** One entry opened up: who recorded and posted it, the receipt, what it wrote and Reverse. */
export function EntryDetail({ code, id, user, onChanged }: { code: string; id: string; user: string; onChanged?: (message: string) => void }) {
  const [v, setV] = useState<EntryView | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [key, setKey] = useState(() => newKey("rev"));
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setV(await ledgerCall<EntryView>(`/api/projects/${code}/ledger/entries/${id}`, user));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [code, id, user]);
  useEffect(() => void load(), [load]);

  if (error) return <p role="alert" className="mt-2 bg-clay-soft px-3 py-2 text-sm text-clay">{error}</p>;
  if (!v) return <p className="mt-2 text-sm text-muted">Opening the entry…</p>;
  const e = v.entry;
  const reverse = async () => {
    if (!reason) return;
    setBusy(true);
    setError("");
    try {
      const r = await ledgerCall<SaveOutcome>(`/api/projects/${code}/ledger/entries/${id}/reverse`, user, { method: "POST", body: JSON.stringify({ idempotencyKey: key, reason }) });
      setReason(null);
      setKey(newKey("rev"));
      await load();
      onChanged?.(r.outcome === "posted" ? "Reversed. The entry and its reversal now cancel out in the books." : `The reversal is over the limit, so it is saved as a draft for someone else to post${r.whoCanPost.length ? `: ${r.whoCanPost.join(" or ")}` : ""}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 border-s-2 border-line ps-3">
      <p className="text-sm text-muted">
        Recorded by {e.recordedBy}
        {e.postedBy ? `, posted by ${e.postedBy}` : ". Not posted yet"}. {e.memo}
      </p>
      {e.receipt && (
        <button type="button" onClick={() => void openLedgerReceipt(code, e.receipt!.hash, user)} className="mt-1 text-sm font-semibold text-forest hover:underline">
          Open the receipt ({e.receipt.name})
        </button>
      )}
      {e.reversesId && <p className="mt-1 text-sm text-warn">This entry reverses an earlier one.</p>}
      {e.reversedBy && <p className="mt-1 text-sm text-warn">This entry was reversed: the two cancel out.</p>}
      <h4 className="mt-3 border-s-[6px] border-ochre ps-2 font-ledger text-base font-bold">What this wrote</h4>
      <p className="text-xs text-muted">The lines in the books behind this {e.kind === "reversal" ? "reversal" : "payment"}, as an accountant or {acct()} would show them.</p>
      <JournalLines lines={v.lines} currency={v.currency} rule={v.balancingRule} />
      {e.canReverse &&
        (reason === null ? (
          <button type="button" className={`${quietBtn} mt-3`} onClick={() => setReason("")}>
            Reverse
          </button>
        ) : (
          <div className="mt-3 max-w-xl">
            <label className="text-sm">
              <span className="font-medium">Why it is being reversed</span>
              <input value={reason} onChange={(x) => setReason(x.target.value)} placeholder="Paid twice by mistake" className="mt-1 block w-full rounded-sm border border-line-strong bg-paper px-3 py-2.5 text-base" />
            </label>
            <p className="mt-1 text-xs text-muted">A posted entry is never changed or deleted. Reversing writes the same lines the other way round, dated today, so the two cancel out and both stay on record.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={busy || reason.trim().length < 3} className={dangerBtn} onClick={() => void reverse()}>
                Reverse the entry
              </button>
              <button type="button" className={quietBtn} onClick={() => setReason(null)}>
                Cancel
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}
