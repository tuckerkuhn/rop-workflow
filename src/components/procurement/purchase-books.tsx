"use client";

import { useCallback, useEffect, useState } from "react";
import { BooksPanel } from "@/components/ledger/books-panel";
import { ledgerCall } from "@/components/ledger/entry-detail";
import type { PurchaseBooksView } from "@/app/api/projects/[code]/procurements/books/route";

/**
 * A purchase's paid instalments and the books, under the list of payments. Each payment recorded
 * as paid shows whether it is in the books. Finance posts it from here with one press: the entry
 * is filled in from the purchase.
 */
export function PurchaseBooks({ code, purchase, paid, user }: { code: string; purchase: string; /** How many instalments are recorded as paid: read again when it changes. */ paid: number; user: string | undefined }) {
  const [v, setV] = useState<PurchaseBooksView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const url = `/api/projects/${code}/procurements/books`;
  const load = useCallback(async () => {
    if (!user || !paid) return;
    try {
      setV(await ledgerCall<PurchaseBooksView>(`${url}?purchase=${encodeURIComponent(purchase)}`, user));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [url, purchase, user, paid]);
  useEffect(() => void load(), [load]);
  const mine = (v?.payments ?? []).filter((p) => p.purchase === purchase);
  // A payment recorded a moment ago is still being saved: read again shortly, a few times.
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!v || mine.length >= paid || tries >= 5) return;
    const t = setTimeout(() => (setTries(tries + 1), void load()), 2000);
    return () => clearTimeout(t);
  }, [v, mine.length, paid, tries, load]);
  if (!paid || !user) return null;
  return (
    <section aria-label="Payments and the books">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Payments and the books</p>
      <p className="mt-1 max-w-2xl text-sm text-muted">A payment counts as spent on its budget line once Finance has posted it to the books. Nothing is typed again: the entry is filled in from this purchase.</p>
      {error && (
        <p role="alert" className="mt-2 bg-clay-soft px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2 bg-mist px-3 py-2 text-sm text-leaf">
          {notice}
        </p>
      )}
      {!v && !error && <p className="mt-2 text-sm text-muted">Reading the books…</p>}
      {mine.map((p) => (
        <div key={p.key} className="mt-2">
          <p className="text-sm font-semibold">
            Payment {p.n}: {p.entry.payee}
          </p>
          <BooksPanel
            kind="purchase"
            name={p.key}
            books={p}
            accounts={v!.accounts}
            lines={v!.lines}
            shown
            onPost={async (f) => {
              setError("");
              try {
                setV(await ledgerCall<PurchaseBooksView>(url, user, { method: "POST", body: JSON.stringify({ purchase, n: p.n, ...f }) }));
                setNotice(`Payment ${p.n} is in the books. It now counts as spent on its budget line.`);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                throw e;
              }
            }}
            onReload={(m) => (setNotice(m), void load())}
          />
        </div>
      ))}
    </section>
  );
}
