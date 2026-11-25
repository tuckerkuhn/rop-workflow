"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/app/i18n";
import { useSession } from "@/components/app/session";
import { EntryDetail } from "@/components/ledger/entry-detail";
import { Sheet } from "@/components/workspace/ledger";
import { primaryBtn } from "@/components/workspace/ui";
import { longDate } from "@/lib/weekly";
import type { BooksView } from "@/server/books-posting";
import type { MoneyAccount } from "@/server/ledger-setup";

const input = "mt-1 block min-h-11 w-full border border-line-strong bg-paper px-3 py-2.5 text-base";
const money = (n: number, c: string) => (c === "AFN" ? `${Math.round(n).toLocaleString("en-US")} AFN` : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * A filed bill or a paid purchase and the books, on the bill or the purchase itself. Finance is
 * shown the entry filled in from it and posts it with one press: the day it was paid and the
 * account it was paid from are the only things to check. Once posted, the entry is one press
 * away, with what it wrote and Reverse. After a reversal the corrected entry is posted here.
 */
export function BooksPanel({ kind, name, books, accounts, lines, shown, onPost, onReload }: { kind: "bill" | "purchase"; name: string; books: BooksView; accounts: MoneyAccount[]; lines: { code: string; description: string }[]; /** Whether to say why it is not in the books when it cannot be posted. */ shown: boolean; onPost: (f: { date: string; paidFrom: string; budgetLine?: string }) => Promise<void>; onReload: (message: string) => void }) {
  const { user } = useSession();
  const { tx } = useT();
  const e = books.entry;
  // The main bank account when there is one in a currency this can be paid in.
  const usable = accounts.filter((a) => a.currency === e.currency || a.currency === "USD");
  const [date, setDate] = useState(e.date);
  const [from, setFrom] = useState((usable.find((a) => a.code === "1010") ?? usable[0])?.code ?? "");
  const [line, setLine] = useState(e.budgetLine);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const now = books.standing;
  const corrected = books.reversed.length > 0;
  const account = accounts.find((a) => a.code === from);
  const doc = kind === "bill" ? tx("the bill") : tx("the purchase");
  const post = async () => {
    setBusy(true);
    try {
      await onPost({ date, paidFrom: from, ...(corrected && line !== e.budgetLine ? { budgetLine: line } : {}) });
    } catch {
      /* shown by the page */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3" data-books={name}>
      {books.reversed.map((p) => (
        <p key={p.entryId} className="mt-1 bg-clay-soft px-3 py-2 text-sm">
          {tx("The entry of {date} was reversed by {name} on {on}: {reason}. Both stay on record and cancel out.", { date: longDate(p.date), name: p.reversal!.by, on: longDate(p.reversal!.date), reason: p.reversal!.reason })}
        </p>
      ))}
      {now ? (
        <div className="mt-1 border-s-[6px] border-forest bg-mist px-3 py-2 text-sm">
          <p>
            {now.budgetLine
              ? tx("In the books: {amount} on line {line}, dated {date}, paid from {account}. Posted by {name}.", { amount: money(Number(now.amount), now.currency), line: now.budgetLine, date: longDate(now.date), account: now.paidFromName, name: now.name })
              : tx("In the books as general and admin: {amount}, dated {date}, paid from {account}. Posted by {name}.", { amount: money(Number(now.amount), now.currency), date: longDate(now.date), account: now.paidFromName, name: now.name })}
            {now.reversal && !now.reversal.posted ? ` ${tx("A reversal waits for a second person in Finance to post it, under Record a payment.")}` : ""}
          </p>
          <button type="button" aria-expanded={open} className="inline-flex min-h-11 items-center text-sm font-semibold text-forest hover:underline" onClick={() => setOpen(!open)}>
            {open ? tx("Close the entry") : tx("See the entry in the books")}
          </button>
          {open && user && <EntryDetail code={e.project} id={now.entryId} user={user.id} onChanged={(m) => (setOpen(false), onReload(m))} />}
        </div>
      ) : books.canPost ? (
        <Sheet className="mt-1">
          <p className="font-ledger text-sm font-bold">{corrected ? tx("Post the corrected entry to the books") : tx("Post to the books")}</p>
          <p className="mt-1 text-sm text-muted">{e.budgetLine ? tx("This is filled in from {doc}. Nothing is typed again. Check it, then post it: it then counts as spent on the budget line.", { doc }) : tx("This is filled in from {doc}. Nothing is typed again. Check it, then post it: it then counts as a general and admin cost, on no project.", { doc })}</p>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="text-muted">{tx("Paid to")}</dt>
            <dd>{e.payee}</dd>
            <dt className="text-muted">{tx("What for")}</dt>
            <dd>{e.what}</dd>
            <dt className="text-muted">{e.budgetLine ? tx("Budget line") : tx("Charged to")}</dt>
            <dd>
              {corrected && e.budgetLine ? (
                <select value={line} onChange={(x) => setLine(x.target.value)} className={input} aria-label={tx("Budget line")}>
                  {lines.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.code} {l.description}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <span className="font-mono">{e.budgetLine}</span> {e.budgetLineName}
                </>
              )}
            </dd>
            <dt className="text-muted">{tx("Amount")}</dt>
            <dd>
              {money(e.amount, e.currency)}
              {e.currency !== "USD" ? ` (${money(e.usd, "USD")} ${tx("at the rate recorded on it")})` : ""}
              {kind === "purchase" ? <span className="block text-xs text-muted">{tx("The invoice in full, before any tax withheld: what the budget line is charged.")}</span> : null}
            </dd>
          </dl>
          {!accounts.length ? (
            <p className="mt-2 text-sm text-warn">
              {tx("The books have no bank or cash account to pay from yet.")}{" "}
              <Link href="/work/payments" className="font-semibold text-forest hover:underline">
                {tx("Set them up under Record a payment")}
              </Link>
            </p>
          ) : (
            <>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="text-muted">{kind === "bill" ? tx("Day it was paid (the day the voucher was filed)") : tx("Day it was paid (as recorded on the purchase)")}</span>
                  <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(x) => setDate(x.target.value)} className={input} />
                </label>
                <label className="text-sm">
                  <span className="text-muted">{tx("Paid from")}</span>
                  <select value={from} onChange={(x) => setFrom(x.target.value)} className={input}>
                    {accounts.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} {a.name} ({a.currency})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {account && account.currency !== e.currency && <p className="mt-1 text-xs text-muted">{tx("This account holds {currency}, so the entry is written as {amount}.", { currency: account.currency, amount: money(e.usd, "USD") })}</p>}
              <button type="button" disabled={busy || !from || !date} className={`${primaryBtn} mt-3 min-h-12`} onClick={() => void post()}>
                {corrected ? tx("Post the corrected entry") : tx("Post to the books")}
              </button>
            </>
          )}
        </Sheet>
      ) : books.second ? (
        <p className="mt-1 bg-ochre-soft px-3 py-2 text-sm">
          {kind === "bill" ? tx("Not in the books yet. You recorded this bill and it is over {limit}, so someone else in Finance posts it to the books.", { limit: books.second.limit }) : tx("Not in the books yet. You recorded this payment and it is over {limit}, so someone else in Finance posts it to the books.", { limit: books.second.limit })}
          {books.second.who.length ? ` ${tx("They can: {names}.", { names: books.second.who.join(", ") })}` : ""}
        </p>
      ) : (
        books.whyNot && shown && <p className="mt-1 text-sm text-muted">{tx("Not in the books yet.")} {tx(books.whyNot)}</p>
      )}
    </div>
  );
}
