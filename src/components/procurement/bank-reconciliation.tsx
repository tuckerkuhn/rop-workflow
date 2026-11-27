"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Why } from "@/components/app/why";
import { SelfConfirmSheet, useSolo } from "@/components/app/self-confirm";
import { useT } from "@/components/app/i18n";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import { DoubleRule, Empty, Fig, LedgerRow, LedgerTable, SectionHead } from "@/components/workspace/ledger";
import type { AppUser } from "@/lib/demo";
import { guessMapping, mappingProblem, parseCsv, readStatement, type StatementMapping } from "@/lib/ledger/statement-csv";
import type { BookLine, ImportResult, ReconciliationView, StatementRow } from "@/server/reconciliation";

/**
 * Bank reconciliation, the step of Month close after the vouchers: for one bank account and one
 * month, import the bank's statement, match its lines to the ledger, complete at a zero difference
 * and lock the month. Finance and administrators act; everyone else on the project reads the figures.
 */

/** Where a missing payment is recorded (the Record a payment page), with what the statement says. */
export const RECORD_PAYMENT_PATH = "/work/payments";

type Answer = {
  bankAccounts: { id: string; name: string; currency: string }[];
  month: string;
  canReconcile: boolean;
  /** Entries on this account this month that the viewer recorded or posted: with any, someone else completes it. */
  ownEntries?: number;
  view: ReconciliationView | null;
  names: Record<string, string>;
  lock?: { draftsLeft: number; already: boolean };
  matched?: number;
};

const field = "mt-1 block min-h-11 w-full border border-line-strong bg-paper px-3 py-2 text-base";
const focus = "focus-visible:outline focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-forest";
const linkBtn = `inline-flex min-h-11 items-center font-semibold text-forest underline decoration-ochre decoration-2 underline-offset-4 hover:bg-ochre-soft ${focus}`;
/** A head inside the reconciliation: the gold tick, one level under the section's own. */
const subHead = "border-s-[6px] border-ochre ps-2.5 font-ledger text-lg font-bold leading-tight text-ink";
/** The three figures: number, what it is, the amount. */
const SUM_COLS = "minmax(0,1fr) minmax(7rem,auto)";
/** A statement or ledger line: number, what it is, the amount. */
const LINE_COLS = "minmax(0,1fr) minmax(6.5rem,auto)";

/** "1234.5" as "1,234.50"; negatives keep their sign. */
const fig = (v: string | null | undefined) => (v === null || v === undefined ? "" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

async function call<T>(url: string, user: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", "x-demo-user": user },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => {
    throw new Error("The request did not reach the server. Check the connection and try again.");
  });
  const out = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(out.error ?? "That did not work. Try again in a minute.");
  return out;
}

export function BankReconciliation({ code, user }: { code: string; user: AppUser }) {
  const { date } = useT();
  const [bank, setBank] = useState("");
  const [month, setMonth] = useState("");
  const [data, setData] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState("");
  // Solo mode: a small team's one finance person completes their own month, confirming it each time.
  const solo = useSolo(code, user.id);
  const [confirming, setConfirming] = useState(false);

  const base = `/api/projects/${encodeURIComponent(code)}/reconciliation`;
  const load = useCallback(
    async (b: string, m: string) => {
      try {
        const q = new URLSearchParams();
        if (b) q.set("bank", b);
        if (m) q.set("month", m);
        const a = await call<Answer>(`${base}?${q}`, user.id);
        setData(a);
        setMonth(a.month);
        setBank(a.view?.bankAccount.id ?? "");
        setBalance(a.view?.statementBalance ?? "");
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [base, user.id],
  );
  // Opened from a link that names the account and month (for example back from Record a payment).
  const search = useSearchParams();
  const askedBank = search.get("bank") ?? "";
  const askedMonth = /^\d{4}-\d{2}$/.test(search.get("month") ?? "") ? search.get("month")! : "";
  useEffect(() => {
    void load(askedBank, askedMonth);
  }, [load, askedBank, askedMonth]);

  const act = async (body: Record<string, unknown>, done?: (a: Answer) => string) => {
    if (!data?.view) return;
    setBusy(true);
    setError("");
    // Some steps take several seconds against the database: say so at once.
    setNotice("Working on it…");
    try {
      const a = await call<Answer>(base, user.id, { bankAccountId: data.view.bankAccount.id, month, ...body });
      setNotice("");
      setData(a);
      setBalance(a.view?.statementBalance ?? "");
      if (done) setNotice(done(a));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const v = data?.view ?? null;
  const name = (id: string | undefined) => (id ? (data?.names[id] ?? id) : "");
  const monthLabel = month ? date(`${month}-01`, { month: "long", year: "numeric" }) : "";
  const cur = v?.bankAccount.currency ?? "";
  const zero = v?.difference === "0.00";
  const may = !!data?.canReconcile;
  const open = may && !!v && !v.completed;
  const own = data?.ownEntries ?? 0;

  return (
    <section id="bank" aria-labelledby="bank-title" className="mt-8 scroll-mt-24 font-ledger">
      <SectionHead id="bank-title" className="mt-0">
        Bank reconciliation
      </SectionHead>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        For each bank account and month: import the bank&apos;s statement, match its lines to the ledger, complete the reconciliation at a zero difference, then lock the month.
      </p>
      <Why>Auditors reconcile every bank account every month. A difference nobody explained is the most common finding for a first grant.</Why>

      {error && (
        <p role="alert" className="mt-4 border-s-[6px] border-clay bg-clay-soft px-4 py-3 text-sm text-clay">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 border-s-[6px] border-forest bg-mist px-4 py-3 text-sm">
          {notice}
        </p>
      )}

      {data && !data.bankAccounts.length && (
        <Empty className="mt-4">
          No bank account is set up yet.{" "}
          {may ? (
            <>
              Set up the bank and cash accounts on{" "}
              <Link href={RECORD_PAYMENT_PATH} className={linkBtn}>
                Record a payment
              </Link>
              , then come back here.
            </>
          ) : (
            "Finance sets it up."
          )}
        </Empty>
      )}

      {data && data.bankAccounts.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:max-w-xl">
          <label className="text-sm font-semibold">
            Bank account
            <select className={field} value={bank} onChange={(e) => void load(e.target.value, month)}>
              {data.bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.currency})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Month
            <input type="month" className={field} value={month} onChange={(e) => e.target.value && void load(bank, e.target.value)} />
          </label>
        </div>
      )}

      {v && (
        <>
          {/* The figures: statement, book, difference. The difference is the row to look at first. */}
          <DoubleRule className="mt-5" />
          <LedgerTable cols={`2.25rem ${SUM_COLS}`} head={["#", monthLabel, { label: cur, end: true }]} label={`${v.bankAccount.name}, ${monthLabel}`} className="mt-0">
            <LedgerRow n={1} cols={SUM_COLS} className="gap-y-2 py-3">
              <span>
                <span className="text-lg font-semibold">Statement closing balance</span>
                <span className="block text-sm text-muted">From the bank&apos;s statement on {date(v.asOf)}: read from the file&apos;s balance column, or typed from the statement.</span>
                {open && (
                  <form
                    className="mt-2 flex max-w-sm items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act({ action: "balance", balance }, () => "Closing balance saved.");
                    }}
                  >
                    <label className="flex-1 text-sm">
                      <span className="sr-only">Statement closing balance in {cur}</span>
                      <input inputMode="decimal" className={`${field} font-mono`} value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0.00" />
                    </label>
                    <button type="submit" disabled={busy || !balance.trim()} className={quietBtn}>
                      Save
                    </button>
                  </form>
                )}
              </span>
              <Fig className="text-lg">{v.statementBalance === null ? <span className="text-muted">not yet</span> : fig(v.statementBalance)}</Fig>
            </LedgerRow>
            <LedgerRow n={2} cols={SUM_COLS} className="py-3">
              <span>
                <span className="text-lg font-semibold">Book balance</span>
                <span className="block text-sm text-muted">What the ledger says was in {v.bankAccount.name} at the end of {date(v.asOf)}, from posted entries.</span>
              </span>
              <Fig className="text-lg">{fig(v.bookBalance)}</Fig>
            </LedgerRow>
            <LedgerRow n={3} cols={SUM_COLS} first className="py-4">
              <span>
                <span className="text-xl font-bold">Difference</span>
                <span className="block text-sm">
                  {v.difference === null
                    ? "Enter the statement's closing balance to see it."
                    : zero
                      ? v.completed
                        ? "Zero. The month is reconciled."
                        : "Zero. The statement and the ledger agree."
                      : "Statement less book. Match the lines below, record what is missing from the ledger, or check the closing balance."}
                </span>
              </span>
              <Fig strong tone={v.difference !== null && !zero ? "clay" : "forest"} className="text-2xl">
                {v.difference === null ? "" : fig(v.difference)}
              </Fig>
            </LedgerRow>
          </LedgerTable>
          <p className="mt-2 text-xs text-muted">The difference is shaded: it is the figure to bring to zero.</p>
          {v.opening !== null && v.addsUp === false && (
            <p className="mt-2 text-sm text-clay">
              Last month closed at {fig(v.opening)} and this month&apos;s statement lines add up to {fig(v.statementTotal)}, so the statement should close at {fig((Number(v.opening) + Number(v.statementTotal)).toFixed(2))}. Check the closing balance or lines missing from the file.
            </p>
          )}
          <p className="mt-2 font-mono text-xs text-muted">
            {v.counts.statement} statement {v.counts.statement === 1 ? "line" : "lines"}, {v.counts.matched} matched
            {v.detail ? `, ${v.counts.unmatchedBook} in the ledger and not on the statement` : ""}
          </p>

          {/* Completing and locking. */}
          <div className="mt-4 space-y-3">
            {v.completed ? (
              <p className="text-base">
                <span className="font-bold text-forest">Reconciled</span> by {name(v.completed.by)} on {date(v.completed.at.slice(0, 10))}.
              </p>
            ) : may && own > 0 && !solo ? (
              <p className="max-w-2xl text-sm">
                You recorded or posted {own} {own === 1 ? "entry" : "entries"} on {v.bankAccount.name} in {monthLabel}, so someone else in Finance completes its reconciliation. The person who enters payments does not reconcile the account they were paid from. You can still import the statement and match its lines for them.
              </p>
            ) : may ? (
              <div>
                <button
                  type="button"
                  className={primaryBtn}
                  disabled={busy || !zero || !v.monthEnded}
                  onClick={() => (own > 0 ? setConfirming(true) : void act({ action: "complete" }, () => `${v.bankAccount.name} is reconciled for ${monthLabel}.`))}
                >
                  Complete the reconciliation
                </button>
                <p className="mt-1 text-xs text-muted">{!v.monthEnded ? `${monthLabel} has not ended yet.` : zero ? "The difference is zero." : "Completes only at a zero difference."}</p>
                {confirming && (
                  <SelfConfirmSheet
                    what={`You recorded or posted ${own} ${own === 1 ? "entry" : "entries"} on ${v.bankAccount.name} in ${monthLabel}, and you are completing its reconciliation yourself.`}
                    onCancel={() => setConfirming(false)}
                    onConfirm={async (self) => {
                      setConfirming(false);
                      await act({ action: "complete", self }, () => `${v.bankAccount.name} is reconciled for ${monthLabel}.`);
                    }}
                  />
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">Not reconciled yet. Finance does it.</p>
            )}

            {v.locked ? (
              <p className="text-base">
                <span className="font-bold">{monthLabel} is locked</span> by {name(v.locked.by)} on {date(v.locked.at.slice(0, 10))}. Nothing more can be posted into it.
              </p>
            ) : (
              v.completed &&
              may && (
                <div className="max-w-2xl border-s-[6px] border-warn bg-ochre-soft px-4 py-3">
                  <p className="font-bold">Lock {monthLabel}</p>
                  <p className="mt-1 text-sm">
                    Once locked, nothing can be posted into {monthLabel} again by anyone. It cannot be unlocked: a payment found later is dated in an open month.
                  </p>
                  {v.draftsInMonth > 0 && (
                    <p className="mt-1 text-sm text-clay">
                      {v.draftsInMonth} {v.draftsInMonth === 1 ? "draft is" : "drafts are"} still open in {monthLabel}. After the lock {v.draftsInMonth === 1 ? "it" : "they"} can no longer be posted in that month.
                    </p>
                  )}
                  {v.otherAccountsOpen.length > 0 && (
                    <p className="mt-1 text-sm text-clay">
                      Not yet reconciled for {monthLabel}: {v.otherAccountsOpen.map((o) => o.name).join(", ")}.
                    </p>
                  )}
                  <button
                    type="button"
                    className={`${primaryBtn} mt-3`}
                    disabled={busy}
                    onClick={() =>
                      void act({ action: "lock" }, (a) =>
                        a.lock?.draftsLeft ? `${monthLabel} is locked. ${a.lock.draftsLeft} ${a.lock.draftsLeft === 1 ? "draft was" : "drafts were"} left in it.` : `${monthLabel} is locked.`,
                      )
                    }
                  >
                    Lock {monthLabel}
                  </button>
                </div>
              )
            )}
          </div>

          {may && v.detail && (
            <>
              {!v.completed && (
                <StatementImport
                  code={code}
                  user={user}
                  bankAccountId={v.bankAccount.id}
                  month={month}
                  monthLabel={monthLabel}
                  startOpen={v.counts.statement === 0}
                  onDone={(r) => {
                    setNotice(importNotice(r, monthLabel));
                    void load(v.bankAccount.id, month);
                  }}
                />
              )}
              <StatementLines v={v} busy={busy} act={act} date={date} />
              <BookLines lines={v.bookLines} date={date} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function importNotice(r: ImportResult, monthLabel: string): string {
  const parts = [`${r.added} ${r.added === 1 ? "line" : "lines"} added.`];
  if (r.already) parts.push(`${r.already} ${r.already === 1 ? "was" : "were"} already here.`);
  if (r.outside) parts.push(`${r.outside} dated outside ${monthLabel} ${r.outside === 1 ? "was" : "were"} left out.`);
  if (r.skipped.length) parts.push(`${r.skipped.length} ${r.skipped.length === 1 ? "row was" : "rows were"} not a transaction.`);
  if (r.closingBalance !== null) parts.push(`Closing balance from the file: ${fig(r.closingBalance)}.`);
  return parts.join(" ");
}

/* ---------------- Import with a preview ---------------- */

/** The import preview: row in the file, date, description, amount, balance. */
const PREVIEW_COLS = "3.5rem 7rem minmax(0,1fr) 7rem 7rem";

function StatementImport({ code, user, bankAccountId, month, monthLabel, startOpen, onDone }: { code: string; user: AppUser; bankAccountId: string; month: string; monthLabel: string; startOpen: boolean; onDone: (r: ImportResult) => void }) {
  const { date } = useT();
  const [text, setText] = useState("");
  const [file, setFile] = useState("");
  const [mapping, setMapping] = useState<StatementMapping | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => (text ? parseCsv(text) : []), [text]);
  const head = mapping ? (rows[mapping.headerRow] ?? []) : [];
  const columns = Math.max(0, ...rows.map((r) => r.length));
  const problem = mapping ? mappingProblem(mapping, columns) : null;
  const parsed = useMemo(() => {
    if (!mapping || problem) return null;
    try {
      return readStatement(rows, mapping);
    } catch {
      return null;
    }
  }, [rows, mapping, problem]);
  const inMonth = parsed?.lines.filter((l) => l.date.slice(0, 7) === month) ?? [];

  const pick = (key: "date" | "description" | "amount" | "moneyIn" | "moneyOut" | "balance", label: string, optional: boolean) => (
    <label className="text-sm font-semibold">
      {label}
      <select
        className={field}
        value={mapping?.[key] ?? -1}
        onChange={(e) => {
          const n = Number(e.target.value);
          setMapping((m) => (m ? { ...m, [key]: n < 0 ? null : n } : m));
        }}
      >
        {optional && <option value={-1}>None</option>}
        {head.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <details className="mt-8 border-t-2 border-ink pt-3" open={startOpen}>
      <summary className={`flex min-h-11 cursor-pointer items-center text-lg font-bold ${focus}`}>Import the bank statement</summary>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        A CSV file exported from the bank. Lines dated in {monthLabel} are added; a line already imported is never added twice, so the same file can be imported again safely.
      </p>
      <label className="mt-3 block max-w-md text-sm font-semibold">
        Statement file (CSV)
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          className={`${field} file:me-3 file:border-0 file:bg-sunken file:px-3 file:py-1`}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setError("");
            if (!f) return;
            if (f.size > 2_000_000) {
              setError("The file is too large. Export one month at a time.");
              return;
            }
            const t = await f.text();
            setFile(f.name);
            setText(t);
            setMapping(guessMapping(parseCsv(t)));
          }}
        />
      </label>

      {mapping && (
        <div className="mt-4">
          <p className="text-sm">
            <span className="font-semibold">{file}</span>: check which column is which. The first guess comes from the column names.
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-semibold">
              Column names on row
              <select className={field} value={mapping.headerRow} onChange={(e) => setMapping({ ...mapping, headerRow: Number(e.target.value) })}>
                {rows.slice(0, 20).map((r, i) => (
                  <option key={i} value={i}>
                    {i + 1}: {r.slice(0, 3).join(", ").slice(0, 40)}
                  </option>
                ))}
              </select>
            </label>
            {pick("date", "Date", false)}
            <label className="text-sm font-semibold">
              Dates written as
              <select className={field} value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as StatementMapping["dateFormat"] })}>
                <option value="ymd">2026-12-31 (year first)</option>
                <option value="dmy">31/12/2026 (day first)</option>
              </select>
            </label>
            {pick("description", "Description", false)}
            {pick("amount", "Amount (one column, minus for money out)", true)}
            {pick("balance", "Balance after each line", true)}
            {pick("moneyIn", "Or: money in", true)}
            {pick("moneyOut", "And: money out", true)}
          </div>
          {problem && <p className="mt-3 text-sm text-clay">{problem}</p>}
          {parsed && (
            <>
              <div className="mt-4 overflow-x-auto">
                <LedgerTable cols={PREVIEW_COLS} head={["Row", "Date", "Description", { label: "Amount", end: true }, { label: "Balance", end: true }]} label="What the file says" className="mt-0 min-w-[32rem]">
                  {parsed.lines.slice(0, 8).map((l) => (
                    <LedgerRow key={l.row} cols={PREVIEW_COLS} className={`text-sm ${l.date.slice(0, 7) === month ? "" : "text-muted line-through"}`}>
                      <span className="font-mono text-xs">{l.row}</span>
                      <span className="whitespace-nowrap font-mono text-xs">{date(l.date)}</span>
                      <span>{l.description}</span>
                      <Fig>{fig(l.amount)}</Fig>
                      <Fig>{fig(l.balance)}</Fig>
                    </LedgerRow>
                  ))}
                </LedgerTable>
              </div>
              <p className="mt-2 text-xs text-muted">
                {parsed.lines.length} {parsed.lines.length === 1 ? "line" : "lines"} read{parsed.lines.length > 8 ? ", the first 8 shown" : ""}. {inMonth.length} dated in {monthLabel}.
                {parsed.skipped.length > 0 && ` ${parsed.skipped.length} ${parsed.skipped.length === 1 ? "row is" : "rows are"} not a transaction (row ${parsed.skipped.slice(0, 5).map((x) => x.row).join(", ")}${parsed.skipped.length > 5 ? "..." : ""}).`}
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-clay">
              {error}
            </p>
          )}
          <button
            type="button"
            className={`${primaryBtn} mt-3`}
            disabled={busy || !parsed || !inMonth.length}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const r = await call<ImportResult>(`/api/projects/${encodeURIComponent(code)}/reconciliation/import`, user.id, { bankAccountId, month, csv: text, mapping });
                setText("");
                setMapping(null);
                setFile("");
                onDone(r);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Import {inMonth.length} {inMonth.length === 1 ? "line" : "lines"} for {monthLabel}
          </button>
        </div>
      )}
    </details>
  );
}

/* ---------------- The lines ---------------- */

type Act = (body: Record<string, unknown>, done?: (a: Answer) => string) => Promise<void>;
type DateFn = (iso: string, opts?: Intl.DateTimeFormatOptions) => string;

function bookWords(b: BookLine, date: DateFn) {
  return `${date(b.date)}: ${b.memo}${b.projectCode ? ` (${b.projectCode})` : ""}`;
}

function recordHref(l: StatementRow, bankAccountId: string) {
  const q = new URLSearchParams({ date: l.date, amount: l.amount.replace(/^-/, ""), what: l.description, from: bankAccountId });
  return `${RECORD_PAYMENT_PATH}?${q}`;
}

function StatementLines({ v, busy, act, date }: { v: ReconciliationView; busy: boolean; act: Act; date: DateFn }) {
  const [hand, setHand] = useState<Record<string, string>>({});
  const book = new Map(v.openBookLines.map((b) => [b.lineId, b]));
  const frozen = !!v.completed;
  // Look first at the first line with no match at all: it needs matching by hand or recording.
  const first = frozen ? undefined : v.statementLines.find((l) => !l.matchedLineId && !(l.suggestion && book.get(l.suggestion.lineId)))?.id;
  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className={`min-w-0 flex-1 ${subHead}`}>Statement lines</h3>
        {!frozen && v.counts.suggested > 0 && (
          <button type="button" className={quietBtn} disabled={busy} onClick={() => void act({ action: "match_suggested" }, (a) => `${a.matched ?? 0} ${a.matched === 1 ? "match" : "matches"} confirmed.`)}>
            Confirm all {v.counts.suggested} suggested {v.counts.suggested === 1 ? "match" : "matches"}
          </button>
        )}
      </div>
      {v.statementLines.length === 0 ? (
        <Empty>No statement lines for this month yet. Import the bank&apos;s statement above.</Empty>
      ) : (
        <>
          <LedgerTable cols={`2.25rem ${LINE_COLS}`} head={["#", "Statement line", { label: "Amount", end: true }]} label="Statement lines">
            {v.statementLines.map((l, i) => {
              const s = l.suggestion ? book.get(l.suggestion.lineId) : null;
              const choices = l.candidates.map((id) => book.get(id)).filter((b): b is BookLine => !!b);
              return (
                <LedgerRow key={l.id} n={i + 1} cols={LINE_COLS} first={l.id === first} className={l.matchedLineId || l.id === first ? "" : "bg-surface"}>
                  <span className="min-w-0">
                    <span className="block font-semibold">{l.description}</span>
                    <span className="block font-mono text-xs text-muted">{date(l.date)}</span>
                  </span>
                  <Fig tone={l.amount.startsWith("-") ? undefined : "forest"}>{fig(l.amount)}</Fig>
                  <span className="col-start-2 col-end-4 text-sm">
                    {l.matchedLineId ? (
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>
                          <span className="font-semibold text-forest">Matched</span> to {l.match ? bookWords(l.match, date) : "a ledger line"}
                        </span>
                        {!frozen && (
                          <button type="button" className={linkBtn} disabled={busy} onClick={() => void act({ action: "unmatch", statementLineId: l.id })}>
                            Unmatch
                          </button>
                        )}
                      </span>
                    ) : s ? (
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>
                          <span className="font-semibold text-warn">Suggested:</span> {bookWords(s, date)}
                          {l.suggestion!.days > 0 && <span className="text-muted"> ({l.suggestion!.days} {l.suggestion!.days === 1 ? "day" : "days"} apart)</span>}
                        </span>
                        <button type="button" className={linkBtn} disabled={busy} onClick={() => void act({ action: "match", statementLineId: l.id, journalLineId: s.lineId })}>
                          Confirm
                        </button>
                      </span>
                    ) : frozen ? (
                      <span className="text-muted">Not matched.</span>
                    ) : (
                      <span className="flex flex-wrap items-end gap-x-3 gap-y-2">
                        <span className="text-clay">{choices.length ? "No match suggested." : "Not in the ledger."}</span>
                        {choices.length > 0 && (
                          <span className="flex items-end gap-2">
                            <label>
                              <span className="sr-only">Match by hand</span>
                              <select className="min-h-11 border border-line-strong bg-paper px-2 text-sm" value={hand[l.id] ?? ""} onChange={(e) => setHand({ ...hand, [l.id]: e.target.value })}>
                                <option value="">Match by hand...</option>
                                {choices.map((b) => (
                                  <option key={b.lineId} value={b.lineId}>
                                    {bookWords(b, date)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button type="button" className={linkBtn} disabled={busy || !hand[l.id]} onClick={() => void act({ action: "match", statementLineId: l.id, journalLineId: hand[l.id] })}>
                              Match
                            </button>
                          </span>
                        )}
                        {l.amount.startsWith("-") ? (
                          <Link href={recordHref(l, v.bankAccount.id)} className={linkBtn}>
                            Record this payment
                          </Link>
                        ) : (
                          <span className="text-muted">Record the money received, then match it here.</span>
                        )}
                      </span>
                    )}
                  </span>
                </LedgerRow>
              );
            })}
          </LedgerTable>
          {first && <p className="mt-2 text-xs text-muted">The shaded line is the first one with no match yet: match it by hand or record it.</p>}
        </>
      )}
    </div>
  );
}

function BookLines({ lines, date }: { lines: BookLine[]; date: DateFn }) {
  return (
    <div className="mt-8">
      <h3 className={subHead}>In the ledger, not on the statement</h3>
      <p className="mt-1 max-w-2xl text-sm text-muted">Posted entries on this account dated in the month with no statement line yet: a cheque not yet cashed, a deposit still on its way, or an entry posted to the wrong account.</p>
      {lines.length === 0 ? (
        <Empty>None.</Empty>
      ) : (
        <LedgerTable cols={`2.25rem ${LINE_COLS}`} head={["#", "Ledger line", { label: "Amount", end: true }]} label="In the ledger, not on the statement">
          {lines.map((b, i) => (
            <LedgerRow key={b.lineId} n={i + 1} cols={LINE_COLS}>
              <span className="min-w-0">
                <span className="block font-semibold">{b.memo}</span>
                <span className="block font-mono text-xs text-muted">
                  {date(b.date)}
                  {b.projectCode ? `, ${b.projectCode}` : ""}
                </span>
              </span>
              <Fig>{fig(b.amount)}</Fig>
            </LedgerRow>
          ))}
        </LedgerTable>
      )}
    </div>
  );
}
