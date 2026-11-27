"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { Why } from "@/components/app/why";
import { EntryDetail, JournalLines, ledgerCall, money } from "@/components/ledger/entry-detail";
import { shrink } from "@/components/people/expense-page";
import { Loading, TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { Empty, Fig, LedgerTable, PageHead, SectionHead, Sheet } from "@/components/workspace/ledger";
import type { Receipt } from "@/lib/expense";
import { payment } from "@/lib/ledger/rules";
import { REASON_MIN, openOnLine } from "@/lib/ledger/payment-guard";
import { newKey, type SaveOutcome } from "@/lib/ledger/screens";
import type { EntryRow, PaymentsView } from "@/server/ledger-view";

/**
 * Record a payment: who was paid, what for, the budget line, the amount and the account it was
 * paid from, with the receipt. The app writes the entry in the books behind it; the lines show only
 * when someone opens "What this writes". Over the organization's limit, the payment waits as a
 * draft for a second person in Finance, listed here under "Drafts to post".
 */

const field = "mt-1 block min-h-11 w-full border border-line-strong bg-paper px-3 py-2.5 text-base";
const focus = "focus-visible:outline focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-forest";
const today = () => new Date().toISOString().slice(0, 10);

export function PaymentsPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const search = useSearchParams();
  const opened = search.get("entry");
  const fromStatement = search.get("from");
  const [v, setV] = useState<PaymentsView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const url = `/api/projects/${project.id}/ledger/payments`;

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await ledgerCall<PaymentsView>(url, user.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, url]);
  useEffect(() => {
    if (ready && user && project.saved) void load();
  }, [ready, user, project.saved, load]);

  if (!user) return null;
  const done = (message: string) => {
    setNotice(message);
    void load();
    // The confirmation sits at the top of the page: bring it into view.
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-screen">
      <TopBar active="procurement" />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <PageHead kicker={project.name} title="Record a payment">
          A payment the project has made: who was paid, what for and from which account, with the receipt. The app keeps the books behind it. A bill still waiting for approval goes on{" "}
          <Link href="/work/bills" className="font-semibold text-forest hover:underline">
            Bills
          </Link>{" "}
          first.
        </PageHead>
        <Why>Every payment needs a receipt and a budget line. A donor can refuse to pay for a cost that has neither. Auditors check a sample of payments against both.</Why>
        {!project.saved && <Empty className="mt-6">Choose a project saved in the database (for example ACRP).</Empty>}
        {error && (
          <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 border-s-[6px] border-forest bg-mist px-4 py-3 text-sm">
            {notice}
            {fromStatement && (
              <>
                {" "}
                <Link href={`/work/closeout?${new URLSearchParams({ bank: fromStatement, ...(/^\d{4}-\d{2}/.test(search.get("date") ?? "") ? { month: search.get("date")!.slice(0, 7) } : {}) })}#bank`} className="font-medium underline underline-offset-2">
                  Back to the bank reconciliation
                </Link>
              </>
            )}
          </p>
        )}
        {project.saved && !v && !error && <Loading className="mt-6" />}
        {v && (
          <>
            {!v.ready ? (
              <SetUp v={v} code={project.id} user={user.id} onDone={() => done("The main bank account and cash on hand are set up. Payments can be recorded now.")} />
            ) : v.may.record ? (
              <PaymentForm v={v} code={project.id} user={user.id} onSaved={done} />
            ) : (
              <p className="mt-6 bg-sunken px-4 py-3 text-sm text-muted">Payments are recorded by Finance and by the people named for bill entry. Give the receipt to Finance.</p>
            )}
            <Drafts v={v} code={project.id} user={user.id} onChanged={done} onError={setError} />
            <Entries v={v} code={project.id} user={user.id} opened={opened} onChanged={done} />
          </>
        )}
      </main>
    </div>
  );
}

function SetUp({ v, code, user, onDone }: { v: PaymentsView; code: string; user: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!v.may.setup) return <p className="mt-6 bg-sunken px-4 py-3 text-sm text-muted">The books have no bank or cash account to pay from yet. Finance sets them up first.</p>;
  return (
    <section className="mt-6 border-s-[6px] border-ochre bg-ochre-soft px-4 py-3">
      <p className="text-sm">
        The books have no bank or cash account to pay from yet. This adds two: the main bank account and cash on hand, both in {v.currency}.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-clay">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        className={`${primaryBtn} mt-3`}
        onClick={async () => {
          setBusy(true);
          try {
            await ledgerCall(`/api/projects/${code}/ledger/setup`, user, { method: "POST", body: "{}" });
            onDone();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Set up the bank and cash accounts
      </button>
    </section>
  );
}

type Form = { payee: string; what: string; budgetLineId: string; donorId: string; amount: string; currency: string; fxRate: string; paidFrom: string; date: string; notAPurchase: string; third: boolean; receivedBy: string; screenedOn: string };

function PaymentForm({ v, code, user, onSaved }: { v: PaymentsView; code: string; user: string; onSaved: (message: string) => void }) {
  const currencies = useMemo(() => [...new Set(v.money.map((m) => m.currency))], [v.money]);
  const blank = useCallback(
    (): Form => ({ payee: "", what: "", budgetLineId: "", donorId: v.donors.length === 1 ? v.donors[0].id : "", amount: "", currency: currencies.includes(v.currency) ? v.currency : (currencies[0] ?? v.currency), fxRate: "1", paidFrom: "", date: today(), notAPurchase: "", third: false, receivedBy: "", screenedOn: "" }),
    [v.donors, v.currency, currencies],
  );
  // Opened from a bank statement line (Month close › Bank reconciliation): the date, amount, what it
  // was and the account come with the link, so nothing is typed twice.
  const params = useSearchParams();
  const fromStatement = params.get("from");
  const [f, setF] = useState<Form>(() => {
    const start = blank();
    if (!fromStatement) return start;
    const account = v.money.find((m) => m.bankAccountId === fromStatement || m.ledgerAccountId === fromStatement);
    const amount = (params.get("amount") ?? "").replace(/^-/, "");
    const date = params.get("date") ?? "";
    return {
      ...start,
      what: params.get("what") ?? "",
      payee: params.get("payee") ?? (account ? account.name : ""),
      amount: Number(amount) > 0 ? amount : "",
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : start.date,
      ...(account ? { paidFrom: account.ledgerAccountId, currency: account.currency, fxRate: account.currency === v.currency ? "1" : "" } : {}),
    };
  });
  const [file, setFile] = useState<Receipt | null>(null);
  // The payee's written authorization, when the money was handed to someone else.
  const [authFile, setAuthFile] = useState<Receipt | null>(null);
  // One key per form: a double click, or a retry after a lost answer, never posts the payment twice.
  const [key, setKey] = useState(() => newKey("pay"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));

  const own = f.currency === v.currency;
  const accounts = v.money.filter((m) => m.currency === f.currency);
  const paidFrom = accounts.some((m) => m.ledgerAccountId === f.paidFrom) ? f.paidFrom : accounts.length === 1 ? accounts[0].ledgerAccountId : "";
  const line = v.budgetLines.find((l) => l.id === f.budgetLineId);
  const rate = own ? "1" : f.fxRate.trim();

  // The lines this payment will write, worked out here by the same rules the server uses.
  const preview = useMemo(() => {
    if (!line?.expenseAccountId || !paidFrom || !(Number(f.amount) > 0) || (!own && !(Number(rate) > 0))) return null;
    try {
      const d = payment({ functionalCurrency: v.currency, date: f.date || today(), memo: f.what || "Payment", paidFrom, currency: f.currency, fxRate: rate, expenses: [{ accountId: line.expenseAccountId, amount: f.amount, donorId: f.donorId || null, budgetLineId: line.id }] });
      return {
        lines: d.lines.map((l, i) => ({ ...l, no: i + 1, code: v.chart[l.accountId]?.code ?? "", account: v.chart[l.accountId]?.name ?? "", budgetLine: l.budgetLineId ? `${line.code} ${line.description}` : null, donor: l.donorId ? (v.donors.find((x) => x.id === l.donorId)?.name ?? null) : null })),
        total: d.lines.at(-1)!.functionalCredit,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [line, paidFrom, f.amount, f.currency, f.date, f.what, f.donorId, own, rate, v.currency, v.chart, v.donors]);
  const overLimit = preview && "total" in preview && Number(preview.total) > Number(v.selfPostLimit);

  // Purchases not yet closed on the chosen line: a payment for one of them belongs on the purchase.
  const openHere = line ? openOnLine(line.code, v.openPurchases) : [];
  const upload = async (x: File): Promise<Receipt> => {
    const body = new FormData();
    body.append("file", await shrink(x));
    return ledgerCall<Receipt>("/api/files", user, { method: "POST", body });
  };

  const missing = [!file && "the receipt", openHere.length > 0 && f.notAPurchase.trim().length < REASON_MIN && "why this is not one of the open purchases", f.third && f.receivedBy.trim().length < 2 && "who received the money", f.third && !authFile && "the payee's written authorization", f.third && !f.screenedOn && "the date the receiver was screened", f.payee.trim().length < 2 && "who was paid", f.what.trim().length < 3 && "what it was for", !line && "the budget line", !(Number(f.amount) > 0) && "the amount", !own && !(Number(rate) > 0) && "the rate", !paidFrom && "the account it was paid from", !f.date && "the date"].filter(Boolean) as string[];

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await ledgerCall<SaveOutcome>(`/api/projects/${code}/ledger/payments`, user, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: key, payee: f.payee, what: f.what, budgetLineId: f.budgetLineId, donorId: f.donorId || null, amount: f.amount.trim(), currency: f.currency, fxRate: rate, paidFrom, date: f.date, receipt: file, notAPurchase: openHere.length ? f.notAPurchase : null, thirdParty: f.third && authFile ? { receivedBy: f.receivedBy, authorization: authFile, screenedOn: f.screenedOn } : null }),
      });
      setF(blank());
      setFile(null);
      setAuthFile(null);
      setKey(newKey("pay"));
      onSaved(
        r.outcome === "posted"
          ? "Recorded and posted to the books. It counts in budget vs actual now."
          : `Saved as a draft. It is over ${money(v.selfPostLimit, v.currency)}, so someone else in Finance posts it${r.whoCanPost.length ? `: ${r.whoCanPost.join(" or ")}` : ""}. They see it under Drafts to post on this page.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SectionHead>The payment</SectionHead>
      <Sheet className="mt-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="text-sm sm:col-span-2">
            <span className="font-medium">The receipt (photo or PDF)</span>
            <label className={`${quietBtn} mt-1 block cursor-pointer text-center`}>
              {file ? `Attached: ${file.name}` : fromStatement ? "Attach the bank statement: for a bank charge it is the receipt" : "Choose or photograph the receipt"}
              <input
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="sr-only"
                onChange={async (e) => {
                  const x = e.target.files?.[0];
                  if (!x) return;
                  setError("");
                  try {
                    setFile(await upload(x));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                }}
              />
            </label>
          </div>
          <label className="text-sm">
            <span className="font-medium">Who was paid</span>
            <input value={f.payee} onChange={(e) => set({ payee: e.target.value })} className={field} />
          </label>
          <label className="text-sm">
            <span className="font-medium">What it was for</span>
            <input value={f.what} onChange={(e) => set({ what: e.target.value })} placeholder="Bank charges for October" className={field} />
          </label>
          <div className="text-sm sm:col-span-2">
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={f.third} onChange={(e) => set({ third: e.target.checked })} />
              <span>The money was handed to someone other than the payee</span>
            </label>
            {f.third && (
              <div className="mt-1 grid gap-3 rounded-xl bg-ochre-soft px-3 py-3 sm:grid-cols-2">
                <p className="text-xs sm:col-span-2">Paying someone else needs the payee&rsquo;s written authorization on file, and the person who received the money screened like any payee.</p>
                <label>
                  <span className="font-medium">Who received the money</span>
                  <input value={f.receivedBy} onChange={(e) => set({ receivedBy: e.target.value })} className={field} />
                </label>
                <label>
                  <span className="font-medium">Date they were screened</span>
                  <input type="date" value={f.screenedOn} max={today()} onChange={(e) => set({ screenedOn: e.target.value })} className={field} />
                </label>
                <label className={`${quietBtn} block cursor-pointer text-center sm:col-span-2`}>
                  {authFile ? `Attached: ${authFile.name}` : "Attach the payee's written authorization"}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="sr-only"
                    onChange={async (e) => {
                      const x = e.target.files?.[0];
                      if (!x) return;
                      setError("");
                      try {
                        setAuthFile(await upload(x));
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  />
                </label>
              </div>
            )}
          </div>
          <label className="text-sm sm:col-span-2">
            <span className="font-medium">Budget line</span>
            {v.budgetLines.length ? (
              <select value={f.budgetLineId} onChange={(e) => set({ budgetLineId: e.target.value })} className={field}>
                <option value="">Choose the line this is charged to</option>
                {v.budgetLines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} {l.description}
                  </option>
                ))}
              </select>
            ) : (
              <span className="mt-1 block text-xs text-muted">This project has no budget loaded yet, so there is no line to choose. Load it in Set up first.</span>
            )}
          </label>
          {openHere.length > 0 && (
            <div className="rounded-xl bg-ochre-soft px-3 py-3 text-sm sm:col-span-2">
              <p className="font-medium">{openHere.length === 1 ? "A purchase on this line is not yet closed" : "Purchases on this line are not yet closed"}</p>
              <ul className="mt-1 list-disc ps-5 text-xs">
                {openHere.map((p) => (
                  <li key={p.id}>
                    {p.id} {p.title}
                    {p.supplier ? `, ${p.supplier}` : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs">
                A payment for {openHere.length === 1 ? "it" : "one of them"} is made from the purchase itself (<Link href="/work/procurements" className="underline">Procurement</Link>, its Pay step), which checks the invoice, the goods received, the tax and the supplier&rsquo;s screening. Recorded here it would skip those checks.
              </p>
              <label className="mt-2 block">
                <span className="font-medium">If this is something else, say what it is for instead</span>
                <input value={f.notAPurchase} onChange={(e) => set({ notAPurchase: e.target.value })} placeholder="Hall hire for the input fair: no purchase record exists for it" className={field} />
              </label>
            </div>
          )}
          {v.donors.length > 1 && (
            <label className="text-sm sm:col-span-2">
              <span className="font-medium">Whose money paid for it</span>
              <select value={f.donorId} onChange={(e) => set({ donorId: e.target.value })} className={field}>
                <option value="">No donor named</option>
                {v.donors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-sm">
            <span className="font-medium">Amount</span>
            <input inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, "") })} placeholder="0.00" className={`${field} font-mono tabular-nums`} />
          </label>
          <label className="text-sm">
            <span className="font-medium">Currency</span>
            <select value={f.currency} onChange={(e) => set({ currency: e.target.value, paidFrom: "", fxRate: e.target.value === v.currency ? "1" : "" })} className={field}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium">Exchange rate</span>
            {own ? (
              <span className="mt-1 block px-1 py-2.5 text-sm text-muted">1: the books are kept in {v.currency}.</span>
            ) : (
              <>
                <input inputMode="decimal" value={f.fxRate} onChange={(e) => set({ fxRate: e.target.value.replace(/[^\d.]/g, "") })} placeholder="0.0114" className={`${field} font-mono tabular-nums`} />
                <span className="mt-1 block text-xs text-muted">
                  What 1 {f.currency} was worth in {v.currency} on the day: the bank&rsquo;s rate.
                </span>
              </>
            )}
          </label>
          <label className="text-sm">
            <span className="font-medium">Paid from</span>
            <select value={paidFrom} onChange={(e) => set({ paidFrom: e.target.value })} className={field}>
              {accounts.length !== 1 && <option value="">Choose the account</option>}
              {accounts.map((m) => (
                <option key={m.ledgerAccountId} value={m.ledgerAccountId}>
                  {m.name} ({m.currency})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium">Date paid</span>
            <input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} className={field} />
          </label>
        </div>

        <details className="mt-4 border-t border-line pt-2">
          <summary className={`flex min-h-11 cursor-pointer items-center text-sm font-semibold text-forest ${focus}`}>What this writes</summary>
          {!preview ? (
            <p className="mt-2 text-sm text-muted">Fill in the budget line, the amount and the account to see the lines.</p>
          ) : "error" in preview ? (
            <p className="mt-2 text-sm text-clay">{preview.error}</p>
          ) : (
            <>
              <p className="mt-2 max-w-2xl text-sm text-muted">The cost goes on the budget line&rsquo;s account; the same amount leaves the account it was paid from.</p>
              <JournalLines lines={preview.lines} currency={v.currency} rule={v.balancingRule} />
            </>
          )}
        </details>

        <p className="mt-3 text-sm text-muted">
          {overLimit ? (
            <span className="text-warn">
              This is over {money(v.selfPostLimit, v.currency)}: it is saved as a draft and someone else in Finance posts it.
            </span>
          ) : (
            <>Up to {money(v.selfPostLimit, v.currency)} you post it yourself. Above that, someone else in Finance posts it.</>
          )}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-sm text-clay">
            {error}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy || missing.length > 0} className={primaryBtn} onClick={() => void save()}>
            {overLimit ? "Save for a second person" : "Record the payment"}
          </button>
          {missing.length > 0 && <span className="text-xs text-muted">Still needed: {missing.join(", ")}.</span>}
        </div>
      </Sheet>
    </section>
  );
}

function Drafts({ v, code, user, onChanged, onError }: { v: PaymentsView; code: string; user: string; onChanged: (m: string) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (!v.drafts.length) return null;
  const act = async (id: string, action: "post" | "delete") => {
    setBusy(id);
    onError("");
    try {
      await ledgerCall(`/api/projects/${code}/ledger/drafts/${id}`, user, { method: "POST", body: JSON.stringify({ action }) });
      onChanged(action === "post" ? "Posted to the books." : "Draft deleted.");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section>
      <SectionHead aside={<span className="font-mono text-xs">{v.drafts.length}</span>}>{v.may.post ? "Drafts to post" : "Your drafts waiting for Finance"}</SectionHead>
      <p className="mt-1 max-w-2xl text-sm text-muted">Over {money(v.selfPostLimit, v.currency)}, a second person checks the receipt and the line before a payment goes into the books.</p>
      <LedgerTable cols={TABLE_COLS} head={HEAD} label={v.may.post ? "Drafts to post" : "Your drafts waiting for Finance"}>
        {v.drafts.map((d, k) => (
          // Drafts come newest first: the last one has waited longest.
          <Item key={d.id} first={v.drafts.length > 1 && k === v.drafts.length - 1}>
            <Row r={d} n={k + 1} open={open === d.id} onToggle={() => setOpen(open === d.id ? null : d.id)} />
            <div className="flex flex-wrap items-center gap-2 px-3 pb-3 ps-[3.75rem]">
              {d.canPost ? (
                <button type="button" disabled={busy === d.id} className={primaryBtn} onClick={() => void act(d.id, "post")}>
                  Post
                </button>
              ) : (
                <span className="text-sm text-muted">{v.may.post ? "You recorded it, so someone else posts it." : `Waiting for ${d.whoCanPost.join(" or ") || "Finance"}.`}</span>
              )}
              {d.canDelete && (
                <button type="button" disabled={busy === d.id} className={dangerBtn} onClick={() => void act(d.id, "delete")}>
                  Delete
                </button>
              )}
            </div>
            {open === d.id && (
              <div className="px-3 pb-3 sm:ps-[3.75rem]">
                <EntryDetail code={code} id={d.id} user={user} />
              </div>
            )}
          </Item>
        ))}
      </LedgerTable>
      {v.drafts.length > 1 && <p className="mt-2 text-xs text-muted">The shaded draft is the one that has waited longest.</p>}
    </section>
  );
}

function Entries({ v, code, user, opened, onChanged }: { v: PaymentsView; code: string; user: string; opened: string | null; onChanged: (m: string) => void }) {
  const [open, setOpen] = useState<string | null>(opened);
  useEffect(() => setOpen(opened), [opened]);
  // An entry opened from Budget vs actual may be older than the latest ones: it is shown on its own first.
  const extra = opened && !v.recent.some((r) => r.id === opened) && !v.drafts.some((d) => d.id === opened);
  return (
    <section>
      <SectionHead>In the books</SectionHead>
      <p className="mt-1 max-w-2xl text-sm text-muted">The latest payments and corrections posted for this project. Open one to see its receipt and what it wrote.</p>
      {extra && (
        <div className="mt-3 border-s-[6px] border-ochre bg-ochre-soft px-3 py-2">
          <p className="text-sm font-semibold">The entry you opened</p>
          <EntryDetail code={code} id={opened} user={user} onChanged={onChanged} />
        </div>
      )}
      {!v.recent.length ? (
        <Empty>Nothing posted yet.</Empty>
      ) : (
        <>
          <LedgerTable cols={TABLE_COLS} head={HEAD} label="In the books">
            {v.recent.map((r, k) => (
              <Item key={r.id} first={r.id === opened}>
                <Row r={r} n={k + 1} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
                {open === r.id && (
                  <div className="px-3 pb-3 sm:ps-[3.75rem]">
                    <EntryDetail code={code} id={r.id} user={user} onChanged={onChanged} />
                  </div>
                )}
              </Item>
            ))}
          </LedgerTable>
          {v.recent.some((r) => r.id === opened) && <p className="mt-2 text-xs text-muted">The shaded row is the entry you opened.</p>}
        </>
      )}
    </section>
  );
}

/** The column head of both tables: number, date, who was paid and what for, the amount, then room for the open mark. */
const TABLE_COLS = "2.25rem 6.5rem minmax(0,1fr) 10rem 1rem";
const HEAD = ["#", "Date", "Paid to and what for", { label: "Amount", end: true }, ""];

/**
 * One payment in a table, with what opens under it inside the same rule. The row itself is a
 * button that says whether it is open, so it is composed here rather than with LedgerRow.
 */
function Item({ first, children }: { first?: boolean; children: React.ReactNode }) {
  return (
    <div role="row" className={`border-b ${first ? "border-ink bg-ochre-soft" : "border-line"}`}>
      {children}
    </div>
  );
}

/** One ruled, numbered row: number, date, who was paid and what for, the amount. On a phone the date goes under the payee. */
function Row({ r, n, open, onToggle }: { r: EntryRow; n: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={`group grid min-h-12 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-3 py-2.5 text-start font-ledger hover:bg-ochre-soft sm:grid-cols-[2.25rem_6.5rem_minmax(0,1fr)_10rem_1rem] ${focus}`}
    >
      <span aria-hidden className="col-start-1 row-start-1 pt-0.5 font-mono text-xs text-muted">
        {String(n).padStart(2, "0")}
      </span>
      <Fig tone="warn" className="col-start-2 row-start-2 text-start sm:row-start-1">
        {r.date}
      </Fig>
      <span className="col-start-2 row-start-1 min-w-0 sm:col-start-3">
        <span className="font-semibold">{r.payee ?? r.what}</span>
        {r.payee && <span className="block text-sm text-muted">{r.what}</span>}
        {r.from && <span className="block text-xs text-muted">{r.from.kind === "bill" ? `From bill ${r.from.id}` : `From purchase ${r.from.id.split("#")[0]}, payment ${r.from.id.split("#")[1] ?? "1"}`}</span>}
        {r.kind === "reversal" && <span className="block text-xs text-warn">Reversal</span>}
        {r.reversedBy && <span className="block text-xs text-warn">Reversed</span>}
      </span>
      <span className="col-start-3 row-start-1 text-end sm:col-start-4">
        <Fig className="block">{money(r.amount, r.amountCurrency)}</Fig>
        {r.status === "posted" && !r.reversedBy && r.kind !== "reversal" && (
          <span className="block text-xs text-forest">
            <span aria-hidden>✓ </span>Posted
          </span>
        )}
      </span>
      <span aria-hidden className="hidden text-forest opacity-40 group-hover:opacity-100 sm:col-start-5 sm:row-start-1 sm:inline-block">
        {open ? "▾" : "▸"}
      </span>
    </button>
  );
}
