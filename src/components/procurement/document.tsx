"use client";

import { useEffect } from "react";
import { useSession } from "@/components/app/session";
import { Logo } from "@/components/logo";
import { primaryBtn } from "@/components/workspace/ui";
import { formatMoney } from "@/lib/demo";
import { documentFor } from "@/lib/procurement-docs";
import { holderFor, otherHolder, signatureLines, type Procurement } from "@/lib/procurement";

/** A generated document, shown as a sheet with its signature lines. */
export function DocumentViewer({
  p,
  doc,
  onClose,
  onConfirm,
  pendingAs,
}: {
  p: Procurement;
  doc: string;
  onClose: () => void;
  /** Present when the viewer is the person about to sign: confirms they reviewed it. */
  onConfirm?: () => void;
  /** The signature line the viewer will sign when they complete their step. */
  pendingAs?: string;
}) {
  const { money, currency, user } = useSession();
  const other = (usd: number) => formatMoney(usd, currency === "USD" ? "AFN" : "USD");
  const d = documentFor(p, doc, money, other);
  const lines = signatureLines(p, doc);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={d.title} onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-2xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-6 py-3 backdrop-blur">
          <p className="text-xs text-muted">Generated from the procurement record. To change it, change the record.</p>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm text-muted hover:bg-sunken hover:text-ink">
            Close
          </button>
        </div>

        <article className="px-6 py-8 sm:px-10">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-4">
            <div className="flex items-center gap-3">
              <Logo className="w-[130px]" />
              <div>
                <h2 className="font-display text-3xl tracking-tight">{d.title}</h2>
              </div>
            </div>
            <div className="text-right font-mono text-xs text-muted">
              <p>{d.number}</p>
              <p>ROP Procurement Policy, April 2025</p>
            </div>
          </header>

          <table className="mt-6 w-full text-sm">
            <tbody className="divide-y divide-line">
              {d.rows.map(([k, v]) => (
                <tr key={k} className="align-top">
                  <th scope="row" className="w-48 py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    {k}
                  </th>
                  <td className="whitespace-pre-line py-2 tabular-nums">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {d.ledger && (
            <section className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Accounting section</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[40rem] text-xs">
                  <thead className="border-b border-ink text-left text-muted">
                    <tr>
                      <th className="py-1.5 pr-2 font-semibold"></th>
                      <th className="py-1.5 pr-2 font-semibold">GL code</th>
                      <th className="py-1.5 pr-2 font-semibold">Dept</th>
                      <th className="py-1.5 pr-2 font-semibold">Contract</th>
                      <th className="py-1.5 pr-2 font-semibold">Budget code</th>
                      <th className="py-1.5 pr-2 font-semibold">Location</th>
                      <th className="py-1.5 pr-2 font-semibold">Description</th>
                      <th className="py-1.5 pr-2 text-right font-semibold">AFS</th>
                      <th className="py-1.5 text-right font-semibold">US$</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line align-top">
                    {d.ledger.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="py-1.5 pr-2 font-semibold">{l.side}</td>
                        <td className="py-1.5 pr-2">{l.gl}</td>
                        <td className="py-1.5 pr-2">{l.dept}</td>
                        <td className="py-1.5 pr-2">{l.contract}</td>
                        <td className="py-1.5 pr-2">{l.budgetCode}</td>
                        <td className="py-1.5 pr-2">{l.location}</td>
                        <td className="py-1.5 pr-2">{l.description}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{l.afn}</td>
                        <td className="py-1.5 text-right tabular-nums">{l.usd}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs tabular-nums">
                Debits {d.ledger.totals.dr} · Credits {d.ledger.totals.cr} ·{" "}
                <span className={d.ledger.balanced ? "font-semibold text-forest" : "font-semibold text-clay"}>{d.ledger.balanced ? "Balance" : "Out of balance"}</span>
              </p>
              <p className="text-xs text-muted">{d.ledger.rate}</p>
            </section>
          )}

          {d.notes.length > 0 && (
            <ul className="mt-6 space-y-1.5 text-xs leading-relaxed text-muted">
              {d.notes.map((n) => (
                <li key={n}>· {n}</li>
              ))}
            </ul>
          )}

          {lines.length > 0 && (
            <section className="mt-8 grid gap-6 sm:grid-cols-2">
              {lines.map((l) => {
                // The voucher's reviewer is a second Finance person: never name the one who prepared it.
                const preparer = (p.signatures["Expense voucher"] ?? []).find((x) => x.as === "Prepared and entered by (finance)")?.name;
                const who = l.as === "Reviewed and approved by (finance)" && preparer ? (otherHolder(p, l.role, preparer)?.name ?? "a second Finance person") : holderFor(p, l.role)?.name;
                const isPending = pendingAs === l.as && !l.signed;
                return (
                  <div key={l.as}>
                    <div className={`flex h-14 items-end border-b ${l.signed ? "border-ink" : "border-dashed border-line"}`}>
                      {l.signed ? (
                        <span className="font-display text-2xl italic text-forest">{l.signed.name}</span>
                      ) : isPending ? (
                        <span className="text-sm text-warn">You sign here when you complete your step</span>
                      ) : (
                        <span className="text-sm text-muted">Awaiting {who ?? "signature"}</span>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs font-semibold">{l.as}</p>
                    <p className="text-xs text-muted">
                      {l.signed ? `Signed electronically in ROP Workflow, ${l.signed.date}` : isPending ? (user?.name ?? "") : (who ?? "")}
                    </p>
                  </div>
                );
              })}
            </section>
          )}
        </article>

        {onConfirm && (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface/95 px-6 py-4 backdrop-blur">
            <p className="text-sm text-muted">Check every line. If something is wrong, close this and fix the record.</p>
            <button
              type="button"
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className={primaryBtn}
            >
              It&rsquo;s correct
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
