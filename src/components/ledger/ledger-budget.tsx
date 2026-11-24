"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Why } from "@/components/app/why";
import { ledgerCall, money } from "@/components/ledger/entry-detail";
import type { BudgetActualView, DrillRow } from "@/server/ledger-view";

/**
 * Budget vs actual from the books, on the Budget page: what the posted payments put on each budget
 * line, by donor, with the entries behind each figure. It stands beside the imported workbook
 * figures above it and changes none of them.
 */

type Row = BudgetActualView["rows"][number];
const rowKey = (r: Row) => `${r.budgetLineId ?? "none"}:${r.donorId ?? "none"}`;

/** How far through its budget a line is, when both are in the same currency. Null: not comparable. */
const used = (r: Row, currency: string) => (r.budget && Number(r.budget) > 0 && r.budgetCurrency === currency ? Number(r.actual) / Number(r.budget) : null);

export function LedgerBudget({ code, user }: { code: string; user: string }) {
  const [v, setV] = useState<BudgetActualView | null>(null);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setV(await ledgerCall<BudgetActualView>(`/api/projects/${code}/ledger/budget-vs-actual`, user));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [code, user]);
  useEffect(() => void load(), [load]);

  const spent = v?.rows.filter((r) => r.entries > 0) ?? [];
  const shown = all ? (v?.rows ?? []) : spent;
  // The row to look at first: the line furthest through its budget, else the one with the most spent.
  const first = v ? [...spent].sort((a, b) => (used(b, v.currency) ?? -1) - (used(a, v.currency) ?? -1) || Number(b.actual) - Number(a.actual))[0] : undefined;
  const otherCurrencies = v ? [...new Set(v.rows.map((r) => r.budgetCurrency).filter((c): c is string => !!c && c !== v.currency))] : [];

  return (
    <section aria-labelledby="ledger-bva" className="mt-10">
      <h2 id="ledger-bva" className="border-s-[6px] border-ochre ps-2 font-ledger text-xl font-bold leading-tight">
        Budget vs actual from the books
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        What the payments posted for this project put on each budget line, by donor. It counts only what was recorded on{" "}
        <Link href="/work/payments" className="font-semibold text-forest hover:underline">
          Record a payment
        </Link>{" "}
        or posted to the books another way; the figures above come from the imported workbook.
      </p>
      <Why>A donor asks what was spent on each line of their grant. An auditor picks figures from this table and asks for the payments behind them: open a line to see them.</Why>
      {error ? (
        <p className="mt-3 bg-sunken px-4 py-3 text-sm text-muted">{error}</p>
      ) : !v ? (
        <p className="mt-3 text-sm text-muted">Reading the books…</p>
      ) : (
        <>
          {otherCurrencies.length > 0 && (
            <p className="mt-3 max-w-3xl text-sm">
              Budgets are in {otherCurrencies.join(" or ")}, as in the agreement. Spending is in {v.currency}, the currency the books are kept in. The two are not converted here, so there is no &ldquo;left&rdquo; figure for those lines.
            </p>
          )}
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-y border-line py-3">
            <div>
              <dt className="text-xs uppercase tracking-[0.12em] text-muted">Spent, all donors</dt>
              <dd className="font-mono text-lg tabular-nums">{money(v.total, v.currency)}</dd>
            </div>
            {v.byDonor.map((d) => (
              <div key={d.donorId ?? "none"}>
                <dt className="text-xs uppercase tracking-[0.12em] text-muted">{d.donorName ?? "No donor named"}</dt>
                <dd className="font-mono text-lg tabular-nums">{money(d.actual, v.currency)}</dd>
              </div>
            ))}
          </dl>
          {!spent.length && <p className="mt-3 border border-dashed border-line p-6 text-center text-sm text-muted">Nothing posted for this project yet.</p>}
          {shown.length > 0 && (
            <ol className="mt-3 border-t-2 border-ink">
              <li aria-hidden className="hidden gap-4 border-b border-line px-2 py-1 text-xs uppercase tracking-[0.12em] text-muted sm:flex">
                <span className="w-6" />
                <span className="flex-1">Budget line and donor</span>
                <span className="w-32 text-end">Budget</span>
                <span className="w-32 text-end">Spent</span>
                <span className="w-32 text-end">Left</span>
              </li>
              {shown.map((r, k) => {
                const id = rowKey(r);
                const share = used(r, v.currency);
                const left = share === null || !r.budget ? null : Number(r.budget) - Number(r.actual);
                return (
                  <li key={id} className={`border-b border-line ${first && rowKey(first) === id ? "bg-ochre-soft" : ""}`}>
                    <button type="button" aria-expanded={open === id} disabled={!r.entries} onClick={() => setOpen(open === id ? null : id)} className="group flex min-h-12 w-full flex-wrap items-center gap-x-4 gap-y-1 px-2 py-2 text-start enabled:hover:bg-ochre-soft">
                      <span aria-hidden className="w-6 shrink-0 font-mono text-xs text-muted">
                        {String(k + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold">
                          {r.code ? `${r.code} ` : ""}
                          {r.description}
                        </span>
                        <span className="block text-xs text-muted">
                          {r.donorName ?? (r.entries ? "No donor named" : "Nothing spent yet")}
                          {r.entries ? ` · ${r.entries} ${r.entries === 1 ? "payment" : "payments"}` : ""}
                        </span>
                      </span>
                      <span className="w-32 shrink-0 text-end font-mono text-sm tabular-nums">{r.budget && r.budgetCurrency ? money(r.budget, r.budgetCurrency) : "None"}</span>
                      <span className="w-32 shrink-0 text-end font-mono text-sm tabular-nums">{money(r.actual, v.currency)}</span>
                      <span className={`w-32 shrink-0 text-end font-mono text-sm tabular-nums ${left !== null && left < 0 ? "font-semibold text-warn" : ""}`}>
                        {left === null ? "" : left < 0 ? `${money(-left, v.currency)} over` : money(left, v.currency)}
                      </span>
                    </button>
                    {open === id && <Drill code={code} user={user} r={r} currency={v.currency} />}
                  </li>
                );
              })}
            </ol>
          )}
          {v.rows.length > spent.length && (
            <button type="button" className="mt-2 text-sm font-semibold text-forest hover:underline" onClick={() => setAll(!all)}>
              {all ? "Show only the lines with spending" : `Show all ${v.rows.length} lines`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** The posted entries behind one figure: date, who was paid, what for, the amount on this line and a way to what each one wrote. */
function Drill({ code, user, r, currency }: { code: string; user: string; r: Row; currency: string }) {
  const [rows, setRows] = useState<DrillRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const q = new URLSearchParams({ line: r.budgetLineId ?? "none", donor: r.donorId ?? "none" });
    ledgerCall<{ entries: DrillRow[] }>(`/api/projects/${code}/ledger/budget-vs-actual?${q}`, user)
      .then((d) => setRows(d.entries))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [code, user, r.budgetLineId, r.donorId]);
  if (error) return <p className="px-2 pb-2 ps-10 text-sm text-clay">{error}</p>;
  if (!rows) return <p className="px-2 pb-2 ps-10 text-sm text-muted">Reading the entries…</p>;
  return (
    <ol className="mx-2 mb-3 ms-10 border-t border-ink">
      {rows.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line py-2 text-sm">
          <span className="w-24 shrink-0 font-mono text-warn">{e.date}</span>
          <span className="min-w-0 flex-1">
            <span className="font-medium">{e.payee ?? (e.kind === "reversal" ? "Reversal" : "Payment")}</span>
            <span className="block text-muted">{e.what}</span>
          </span>
          <span className="w-32 shrink-0 text-end font-mono tabular-nums">{money(e.onLine, currency)}</span>
          <Link href={`/work/payments?entry=${e.id}`} className="font-semibold text-forest hover:underline">
            What this wrote
          </Link>
        </li>
      ))}
    </ol>
  );
}
