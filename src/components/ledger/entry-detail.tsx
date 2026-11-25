"use client";

import { useCallback, useEffect, useState } from "react";
import { acct } from "@/lib/file-store";
import { newKey, type SaveOutcome } from "@/lib/ledger/screens";
import { plainError } from "@/lib/plain-error";
import { dangerBtn, quietBtn } from "@/components/workspace/ui";
import { Fig, LedgerRow, LedgerTable, Sheet } from "@/components/workspace/ledger";
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
  // The account column, then debit and credit; in another currency, the rate and the same in the organization's own.
  const cols = `minmax(12rem,1fr) 7rem 7rem${foreign ? " 11rem 7rem 7rem" : ""}`;
  const fx = { label: "Rate", end: true };
  return (
    <div className="mt-2">
      <div className="overflow-x-auto">
        <LedgerTable
          cols={`2.25rem ${cols}`}
          head={["No.", "Account", { label: "Debit", end: true }, { label: "Credit", end: true }, ...(foreign ? [fx, { label: `Debit ${currency}`, end: true }, { label: `Credit ${currency}`, end: true }] : [])]}
          label="What this wrote"
          className={`mt-0 ${foreign ? "min-w-[52rem]" : "min-w-[520px]"}`}
        >
          {lines.map((l) => (
            <LedgerRow key={l.no} n={l.no} cols={cols} className="text-sm">
              <span>
                <span className="font-mono text-xs text-muted">{l.code}</span> {l.account}
                {(l.budgetLine || l.donor) && <span className="block text-xs text-muted">{[l.budgetLine && `Budget line ${l.budgetLine}`, l.donor && `Donor: ${l.donor}`].filter(Boolean).join(" · ")}</span>}
              </span>
              <Fig>{figure(l.debit)}</Fig>
              <Fig>{figure(l.credit)}</Fig>
              {foreign && <Fig className="text-xs">{l.currency === currency ? "1" : `${Number(l.fxRate)} ${currency} for 1 ${l.currency}`}</Fig>}
              {foreign && <Fig>{figure(l.functionalDebit)}</Fig>}
              {foreign && <Fig>{figure(l.functionalCredit)}</Fig>}
            </LedgerRow>
          ))}
        </LedgerTable>
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
    <Sheet className="mt-2">
      <p className="text-sm text-muted">
        Recorded by {e.recordedBy}
        {e.postedBy ? `, posted by ${e.postedBy}` : ". Not posted yet"}. {e.memo}
      </p>
      {e.receipt && (
        <button type="button" onClick={() => void openLedgerReceipt(code, e.receipt!.hash, user)} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-forest hover:underline">
          Open the receipt ({e.receipt.name})
        </button>
      )}
      {e.reversesId && <p className="mt-1 text-sm text-warn">This entry reverses an earlier one.</p>}
      {e.reversedBy && <p className="mt-1 text-sm text-warn">This entry was reversed: the two cancel out.</p>}
      <h4 className="mt-4 border-s-[6px] border-ochre ps-2.5 font-ledger text-base font-bold leading-tight">What this wrote</h4>
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
              <input value={reason} onChange={(x) => setReason(x.target.value)} placeholder="Paid twice by mistake" className="mt-1 block min-h-11 w-full border border-line-strong bg-paper px-3 py-2.5 text-base" />
            </label>
            <p className="mt-1 text-xs text-muted">A posted entry is never changed or deleted. Reversing writes the same lines the other way round, dated today, so the two cancel out and both stay on record.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={busy || reason.trim().length < 3} className={dangerBtn} onClick={() => void reverse()}>
                Reverse the entry
              </button>
              <button type="button" className={quietBtn} onClick={() => setReason(null)}>
                Cancel
              </button>
            </div>
          </div>
        ))}
    </Sheet>
  );
}
