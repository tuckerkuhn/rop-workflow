"use client";

import { useEffect } from "react";
import { useSession } from "@/components/app/session";
import { LogoMark } from "@/components/logo";
import { primaryBtn } from "@/components/workspace/ui";
import { formatMoney, holderOf } from "@/lib/demo";
import { documentFor } from "@/lib/procurement-docs";
import { signatureLines, type Procurement } from "@/lib/procurement";

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
              <LogoMark className="h-10 w-10" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Roots of Peace</p>
                <h2 className="font-display text-3xl tracking-tight">{d.title}</h2>
              </div>
            </div>
            <div className="text-right font-mono text-xs text-muted">
              <p>{d.number}</p>
              <p>Draft rules: Procurement Policy Draft 1.0</p>
            </div>
          </header>

          <table className="mt-6 w-full text-sm">
            <tbody className="divide-y divide-line">
              {d.rows.map(([k, v]) => (
                <tr key={k} className="align-top">
                  <th scope="row" className="w-48 py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    {k}
                  </th>
                  <td className="py-2 tabular-nums">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

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
                const who = holderOf("procurement", l.role)?.name;
                const isPending = pendingAs === l.as && !l.signed;
                return (
                  <div key={l.as}>
                    <div className={`flex h-14 items-end border-b ${l.signed ? "border-ink" : "border-dashed border-line"}`}>
                      {l.signed ? (
                        <span className="font-display text-2xl italic text-forest">{l.signed.name}</span>
                      ) : isPending ? (
                        <span className="text-sm text-ochre">You sign here when you complete your step</span>
                      ) : (
                        <span className="text-sm text-muted">Awaiting {who ?? "signature"}</span>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs font-semibold">{l.as}</p>
                    <p className="text-xs text-muted">
                      {l.signed ? `Signed electronically ${l.signed.date} · demo signature` : isPending ? (user?.name ?? "") : (who ?? "")}
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
