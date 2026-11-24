import { createHash } from "node:crypto";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { realToday } from "@/lib/clock";
import { fromCents, periodOf, toCents } from "@/lib/ledger/rules";
import { closingBalanceOf, parseAmount, parseCsv, readStatement, withOccurrence, type StatementMapping } from "@/lib/ledger/statement-csv";
import { logAudit } from "@/server/audit";
import { LedgerError, lockPeriod, periodEnd } from "@/server/ledger";

/**
 * Bank reconciliation, the step of Month close where Finance shows that the bank's statement and the
 * ledger agree. For one bank account and one month:
 *
 *   1. import the bank's statement (CSV); a line already imported is never imported again (import_key);
 *   2. match each statement line to the ledger line it is (suggested by amount and date, confirmed by
 *      a person, or chosen by hand); unmatch until the month is reconciled;
 *   3. compare the statement's closing balance with the book balance at the end of the month;
 *   4. complete at a zero difference (the database refuses any other), then lock the month.
 *
 * Bank accounts belong to the organization, not to a project, so everything here takes the
 * organization's id; the routes reach it through the project the person opened. A completed
 * reconciliation never changes (database trigger); its statement lines and matches are frozen here.
 *
 * Amounts are decimal strings in the bank account's own currency, positive for money in.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

export type BankAccount = { id: string; name: string; currency: string; ledgerAccountId: string; active: boolean };

/** Finance (procurement role finance or project role finance-import) and administrators reconcile. The same rule the page uses to show the buttons. */
export function financeLens(u: AppUser): boolean {
  return u.kind === "employee" && (!!u.admin || u.procurement.includes("finance") || u.project.includes("finance-import"));
}

/** The server's check: the rule above, or the Finance role held in the organization's HR rules. */
export async function mayReconcile(u: AppUser): Promise<boolean> {
  if (u.kind !== "employee") return false;
  if (financeLens(u)) return true;
  const { holdsRole } = await import("@/server/hr-store");
  return holdsRole(u.id, "finance");
}

/** Everyone else employed on the project may read the result: the balances and whether it is done, not the lines. */
export const mayReadReconciliation = (u: AppUser) => u.kind === "employee";

/** How many days apart a statement line and a ledger line may be for a suggested match. */
export const MATCH_DAYS = 4;

/* ---------------- Bank accounts ---------------- */

export async function bankAccountsOf(orgId: string): Promise<BankAccount[]> {
  return db
    .select({ id: s.bankAccounts.id, name: s.bankAccounts.name, currency: s.bankAccounts.currency, ledgerAccountId: s.bankAccounts.ledgerAccountId, active: s.bankAccounts.active })
    .from(s.bankAccounts)
    .innerJoin(s.ledgerAccounts, eq(s.ledgerAccounts.id, s.bankAccounts.ledgerAccountId))
    .where(eq(s.bankAccounts.organizationId, orgId))
    // The main bank account (1010) first and cash on hand (1000) last: the page opens on the account
    // that has a statement to reconcile.
    .orderBy(sql`case ${s.ledgerAccounts.code} when '1010' then 0 when '1000' then 2 else 1 end`, asc(s.bankAccounts.createdAt), asc(s.bankAccounts.name));
}

async function bankOf(exec: Exec, orgId: string, bankAccountId: string): Promise<BankAccount> {
  if (!UUID.test(bankAccountId)) throw new LedgerError("not_found", "That bank account was not found.");
  const [b] = await exec
    .select({ id: s.bankAccounts.id, name: s.bankAccounts.name, currency: s.bankAccounts.currency, ledgerAccountId: s.bankAccounts.ledgerAccountId, active: s.bankAccounts.active })
    .from(s.bankAccounts)
    .where(and(eq(s.bankAccounts.id, bankAccountId), eq(s.bankAccounts.organizationId, orgId)))
    .limit(1);
  if (!b) throw new LedgerError("not_found", "That bank account was not found.");
  return b;
}

/* ---------------- Periods ---------------- */

/** "2026-12" or "2026-12-01" (or any day in it) as the first of the month. */
export function monthPeriod(month: string): string {
  const m = month.trim();
  return periodOf(/^\d{4}-\d{2}$/.test(m) ? `${m}-01` : m);
}

const monthName = (period: string) => new Date(`${period}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** A month is reconciled and locked only after it has ended (the server's own date). */
export const monthEnded = (period: string, today = realToday()) => periodEnd(period) < today;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dayDiff = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

/* ---------------- Book side ---------------- */

/** The bank account's posted balance in its own currency up to the end of `asOf`: the same figure as ledger bankBookBalance. */
async function bookBalance(exec: Exec, bank: BankAccount, asOf: string): Promise<string> {
  const [r] = rowsOf<{ amount: string | null }>(
    await exec.execute(sql`
      SELECT (coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0))::text AS amount
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.status = 'posted' AND l.account_id = ${bank.ledgerAccountId} AND l.currency = ${bank.currency} AND e.entry_date <= ${asOf}::date`),
  );
  return cents(r?.amount);
}

export type BookLine = {
  lineId: string;
  entryId: string;
  date: string;
  memo: string;
  /** Signed like the statement: positive money in (a debit to the bank), negative money out. */
  amount: string;
  projectCode: string | null;
  /** The entry was reversed by another entry, or reverses one, inside the same window: the two cancel out. */
  cancelled: boolean;
};

async function bookLines(exec: Exec, bank: BankAccount, from: string, to: string, extraIds: string[] = []): Promise<BookLine[]> {
  const ids = extraIds.length ? sql` OR l.id IN (${sql.join(extraIds.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``;
  const raw = rowsOf<{ line_id: string; entry_id: string; date: string; memo: string; line_memo: string | null; amount: string; project_code: string | null; reverses_id: string | null; reversed_on: string | null; original_on: string | null }>(
    await exec.execute(sql`
      SELECT l.id AS line_id, e.id AS entry_id, e.entry_date::text AS date, e.memo, l.memo AS line_memo, (l.debit - l.credit)::text AS amount,
             p.code AS project_code, e.reverses_id,
             (SELECT r.entry_date::text FROM journal_entries r WHERE r.reverses_id = e.id AND r.status = 'posted' LIMIT 1) AS reversed_on,
             (SELECT o.entry_date::text FROM journal_entries o WHERE o.id = e.reverses_id) AS original_on
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id LEFT JOIN projects p ON p.id = e.project_id
      WHERE e.status = 'posted' AND l.account_id = ${bank.ledgerAccountId} AND l.currency = ${bank.currency}
        AND ((e.entry_date BETWEEN ${from}::date AND ${to}::date)${ids})
      ORDER BY e.entry_date, e.created_at, l.line_no`),
  );
  const inWindow = (d: string | null) => !!d && d >= from && d <= to;
  return raw.map((r) => ({
    lineId: r.line_id,
    entryId: r.entry_id,
    date: r.date,
    memo: r.line_memo || r.memo,
    amount: cents(r.amount),
    projectCode: r.project_code,
    cancelled: inWindow(r.reversed_on) || inWindow(r.original_on),
  }));
}

/* ---------------- Suggestions ---------------- */

export type MatchSuggestion = { statementLineId: string; lineId: string; days: number };

/**
 * Pairs each unmatched statement line with an unmatched ledger line of the same amount and sign
 * dated at most `maxDays` apart. The closest dates pair first; each line is used once.
 */
export function suggestMatches(statement: { id: string; date: string; amount: string }[], book: { lineId: string; date: string; amount: string }[], maxDays = MATCH_DAYS): MatchSuggestion[] {
  const pairs: MatchSuggestion[] = [];
  for (const st of statement) {
    const c = toCents(st.amount);
    for (const b of book) {
      if (toCents(b.amount) !== c) continue;
      const days = dayDiff(st.date, b.date);
      if (days <= maxDays) pairs.push({ statementLineId: st.id, lineId: b.lineId, days });
    }
  }
  pairs.sort((a, b) => a.days - b.days);
  const usedS = new Set<string>();
  const usedB = new Set<string>();
  const out: MatchSuggestion[] = [];
  for (const p of pairs) {
    if (usedS.has(p.statementLineId) || usedB.has(p.lineId)) continue;
    usedS.add(p.statementLineId);
    usedB.add(p.lineId);
    out.push(p);
  }
  return out;
}

/* ---------------- The view ---------------- */

export type StatementRow = {
  id: string;
  date: string;
  description: string;
  amount: string;
  importedBy: string;
  matchedLineId: string | null;
  match: BookLine | null;
  suggestion: { lineId: string; days: number } | null;
  /** Ledger lines of the same amount and sign not yet matched, for matching by hand. */
  candidates: string[];
};

export type ReconciliationView = {
  bankAccount: { id: string; name: string; currency: string };
  period: string;
  asOf: string;
  monthEnded: boolean;
  locked: { at: string; by: string } | null;
  completed: { at: string; by: string } | null;
  /** The statement's closing balance, as entered or read from the file; null until there is one. */
  statementBalance: string | null;
  bookBalance: string;
  /** Statement minus book; null until the statement balance is known. */
  difference: string | null;
  /** Last month's reconciled closing balance. `addsUp`: it plus this month's statement lines gives this month's. */
  opening: string | null;
  statementTotal: string;
  addsUp: boolean | null;
  /** False for a reader who is not Finance: only the figures above, no lines. */
  detail: boolean;
  statementLines: StatementRow[];
  /** Ledger lines in the month that are on no statement line yet (cancelled pairs left out). */
  bookLines: BookLine[];
  /** Ledger lines near the month that can still be matched (for matching by hand). */
  openBookLines: BookLine[];
  counts: { statement: number; matched: number; unmatchedStatement: number; unmatchedBook: number; suggested: number };
  draftsInMonth: number;
  /** The organization's other active bank accounts not yet reconciled for this month. */
  otherAccountsOpen: { id: string; name: string }[];
};

export async function reconciliationView(orgId: string, bankAccountId: string, month: string, opts: { detail?: boolean } = {}): Promise<ReconciliationView> {
  const period = monthPeriod(month);
  const asOf = periodEnd(period);
  const bank = await bankOf(db, orgId, bankAccountId);
  const prev = monthPeriod(addDays(period, -1));
  const [recon, prevRecon, lock, statement, book, drafts, others] = await Promise.all([
    reconRow(db, bank.id, period),
    reconRow(db, bank.id, prev),
    db
      .select()
      .from(s.fiscalPeriods)
      .where(and(eq(s.fiscalPeriods.organizationId, orgId), eq(s.fiscalPeriods.period, period), isNotNull(s.fiscalPeriods.lockedAt)))
      .limit(1),
    db
      .select()
      .from(s.bankStatementLines)
      .where(and(eq(s.bankStatementLines.bankAccountId, bank.id), gte(s.bankStatementLines.date, period), lte(s.bankStatementLines.date, asOf)))
      .orderBy(asc(s.bankStatementLines.date), asc(s.bankStatementLines.importedAt), asc(s.bankStatementLines.importKey)),
    bookBalance(db, bank, asOf),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.journalEntries)
      .where(and(eq(s.journalEntries.organizationId, orgId), eq(s.journalEntries.period, period), eq(s.journalEntries.status, "draft"))),
    db
      .select({ id: s.bankAccounts.id, name: s.bankAccounts.name, done: s.reconciliations.completedAt })
      .from(s.bankAccounts)
      .leftJoin(s.reconciliations, and(eq(s.reconciliations.bankAccountId, s.bankAccounts.id), eq(s.reconciliations.period, period)))
      .where(and(eq(s.bankAccounts.organizationId, orgId), eq(s.bankAccounts.active, true))),
  ]);
  const statementBalance = recon ? cents(recon.statementBalance) : null;
  const difference = statementBalance === null ? null : fromCents(toCents(statementBalance) - toCents(book));
  const total = statement.reduce((a, l) => a + toCents(cents(l.amount)), BigInt(0));
  const opening = prevRecon?.completedAt ? cents(prevRecon.statementBalance) : null;
  const addsUp = opening !== null && statementBalance !== null ? toCents(opening) + total === toCents(statementBalance) : null;

  const detail = opts.detail !== false;
  let statementLines: StatementRow[] = [];
  let unmatchedBook: BookLine[] = [];
  let openBook: BookLine[] = [];
  let suggested = 0;
  if (detail) {
    const from = addDays(period, -MATCH_DAYS);
    const to = addDays(asOf, MATCH_DAYS);
    const matchedIds = statement.map((l) => l.matchedLineId).filter((x): x is string => !!x);
    const lines = await bookLines(db, bank, from, to, matchedIds);
    // Ledger lines already matched to any statement line (this month's or another's).
    const taken = new Set(
      lines.length
        ? (
            await db
              .select({ id: s.bankStatementLines.matchedLineId })
              .from(s.bankStatementLines)
              .where(inArray(s.bankStatementLines.matchedLineId, lines.map((l) => l.lineId)))
          ).map((r) => r.id)
        : [],
    );
    const byId = new Map(lines.map((l) => [l.lineId, l]));
    openBook = lines.filter((l) => !taken.has(l.lineId) && !l.cancelled);
    unmatchedBook = openBook.filter((l) => l.date >= period && l.date <= asOf);
    const open = statement.filter((l) => !l.matchedLineId).map((l) => ({ id: l.id, date: l.date, amount: cents(l.amount) }));
    const suggestions = recon?.completedAt ? [] : suggestMatches(open, openBook);
    suggested = suggestions.length;
    const sug = new Map(suggestions.map((x) => [x.statementLineId, x]));
    statementLines = statement.map((l) => {
      const amount = cents(l.amount);
      const g = sug.get(l.id);
      return {
        id: l.id,
        date: l.date,
        description: l.description,
        amount,
        importedBy: l.importedBy,
        matchedLineId: l.matchedLineId,
        match: l.matchedLineId ? (byId.get(l.matchedLineId) ?? null) : null,
        suggestion: g ? { lineId: g.lineId, days: g.days } : null,
        candidates: l.matchedLineId ? [] : openBook.filter((b) => b.amount === amount).map((b) => b.lineId),
      };
    });
  }
  const matched = statement.filter((l) => l.matchedLineId).length;
  return {
    bankAccount: { id: bank.id, name: bank.name, currency: bank.currency },
    period,
    asOf,
    monthEnded: monthEnded(period),
    locked: lock[0]?.lockedAt ? { at: lock[0].lockedAt.toISOString(), by: lock[0].lockedBy ?? "" } : null,
    completed: recon?.completedAt ? { at: recon.completedAt.toISOString(), by: recon.completedBy ?? "" } : null,
    statementBalance,
    bookBalance: recon?.completedAt ? cents(recon.bookBalance) : book,
    difference: recon?.completedAt ? cents(recon.difference) : difference,
    opening,
    statementTotal: fromCents(total),
    addsUp,
    detail,
    statementLines,
    bookLines: unmatchedBook,
    openBookLines: openBook,
    counts: { statement: statement.length, matched, unmatchedStatement: statement.length - matched, unmatchedBook: unmatchedBook.length, suggested },
    draftsInMonth: drafts[0]?.n ?? 0,
    otherAccountsOpen: others.filter((o) => o.id !== bank.id && !o.done).map((o) => ({ id: o.id, name: o.name })),
  };
}

async function reconRow(exec: Exec, bankAccountId: string, period: string) {
  const [r] = await exec
    .select()
    .from(s.reconciliations)
    .where(and(eq(s.reconciliations.bankAccountId, bankAccountId), eq(s.reconciliations.period, period)))
    .limit(1);
  return r ?? null;
}

async function refuseIfCompleted(exec: Exec, bank: BankAccount, period: string, what: string) {
  const r = await reconRow(exec, bank.id, period);
  if (r?.completedAt) throw new LedgerError("refused", `${monthName(period)} is reconciled for ${bank.name}, so ${what}.`);
}

/* ---------------- Import ---------------- */

export type ImportResult = { added: number; already: number; outside: number; skipped: { row: number; reason: string }[]; closingBalance: string | null };

/** sha256 of a line's identity: date, description, amount and its running occurrence in the file. */
export const importKeyOf = (identity: string) => createHash("sha256").update(identity).digest("hex");

const MAX_CSV = 2_000_000;
const MAX_LINES = 5000;

/**
 * Imports the lines of a statement dated in the month, for one bank account. Lines already imported
 * (same import key) are left as they are, so importing the same file again adds nothing. Lines dated
 * in another month are left out and counted. When the file has a balance column, the balance after
 * the month's last line becomes the statement's closing balance.
 */
export async function importStatement(input: { organizationId: string; bankAccountId: string; month: string; csv: string; mapping: StatementMapping; by: string; projectId: string }): Promise<ImportResult> {
  const period = monthPeriod(input.month);
  const asOf = periodEnd(period);
  if (!input.csv?.trim()) throw new LedgerError("invalid", "The file is empty.");
  if (input.csv.length > MAX_CSV) throw new LedgerError("invalid", "The file is too large. Export one month at a time.");
  let parsed;
  try {
    parsed = readStatement(parseCsv(input.csv), input.mapping);
  } catch (e) {
    throw new LedgerError("invalid", e instanceof Error ? e.message : String(e));
  }
  if (parsed.lines.length > MAX_LINES) throw new LedgerError("invalid", `The file has more than ${MAX_LINES} lines. Export one month at a time.`);
  const keyed = withOccurrence(parsed.lines);
  const inMonth = keyed.filter(({ line }) => line.date >= period && line.date <= asOf);
  if (!inMonth.length) throw new LedgerError("invalid", `No line in the file is dated in ${monthName(period)}. Check the month and the date format.`);
  const closingBalance = closingBalanceOf(inMonth.map((k) => k.line));
  return db.transaction(async (tx) => {
    const bank = await bankOf(tx, input.organizationId, input.bankAccountId);
    await refuseIfCompleted(tx, bank, period, "its statement can no longer change");
    const added = await tx
      .insert(s.bankStatementLines)
      .values(inMonth.map(({ line, identity }) => ({ bankAccountId: bank.id, date: line.date, description: line.description.slice(0, 500), amount: line.amount, importedBy: input.by, importKey: importKeyOf(identity) })))
      .onConflictDoNothing()
      .returning({ id: s.bankStatementLines.id });
    if (closingBalance !== null) await saveStatementBalance(tx, bank, period, closingBalance);
    const result = { added: added.length, already: inMonth.length - added.length, outside: keyed.length - inMonth.length, skipped: parsed.skipped, closingBalance };
    await logAudit(tx, input.projectId, {
      entity: "bank_account",
      entityId: bank.id,
      action: "ledger_statement_imported",
      by: input.by,
      detail: { bankAccount: bank.name, period, added: result.added, already: result.already, outside: result.outside, closingBalance },
    });
    return result;
  });
}

/* ---------------- Statement balance ---------------- */

async function saveStatementBalance(tx: Tx, bank: BankAccount, period: string, balance: string) {
  const book = await bookBalance(tx, bank, periodEnd(period));
  const difference = fromCents(toCents(balance) - toCents(book));
  await tx
    .insert(s.reconciliations)
    .values({ bankAccountId: bank.id, period, statementBalance: balance, bookBalance: book, difference })
    .onConflictDoUpdate({
      target: [s.reconciliations.bankAccountId, s.reconciliations.period],
      set: { statementBalance: balance, bookBalance: book, difference },
      setWhere: isNull(s.reconciliations.completedAt),
    });
}

/** Sets the statement's closing balance for the month, as the person reads it on the statement. */
export async function setStatementBalance(input: { organizationId: string; bankAccountId: string; month: string; balance: string; by: string }): Promise<void> {
  const period = monthPeriod(input.month);
  const balance = parseAmount(input.balance);
  if (balance === null) throw new LedgerError("invalid", `"${input.balance}" is not an amount.`);
  await db.transaction(async (tx) => {
    const bank = await bankOf(tx, input.organizationId, input.bankAccountId);
    await refuseIfCompleted(tx, bank, period, "its closing balance can no longer change");
    await saveStatementBalance(tx, bank, period, balance);
  });
}

/* ---------------- Matching ---------------- */

async function statementLineOf(tx: Tx, orgId: string, statementLineId: string) {
  if (!UUID.test(statementLineId)) throw new LedgerError("not_found", "That statement line was not found.");
  const [l] = await tx.select().from(s.bankStatementLines).where(eq(s.bankStatementLines.id, statementLineId)).for("update").limit(1);
  if (!l) throw new LedgerError("not_found", "That statement line was not found.");
  const bank = await bankOf(tx, orgId, l.bankAccountId);
  return { line: l, bank, period: periodOf(l.date) };
}

/** Matches a statement line to the ledger line it is: same bank account, same amount and sign, posted. */
export async function matchLine(input: { organizationId: string; statementLineId: string; journalLineId: string; by: string; projectId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const { line, bank, period } = await statementLineOf(tx, input.organizationId, input.statementLineId);
    await refuseIfCompleted(tx, bank, period, "its matches can no longer change");
    if (line.matchedLineId) throw new LedgerError("refused", "That statement line is already matched. Unmatch it first.");
    if (!UUID.test(input.journalLineId)) throw new LedgerError("not_found", "That ledger line was not found.");
    const [j] = rowsOf<{ account_id: string; currency: string; amount: string; status: string; organization_id: string; date: string; memo: string }>(
      await tx.execute(sql`
        SELECT l.account_id, l.currency, (l.debit - l.credit)::text AS amount, e.status, e.organization_id, e.entry_date::text AS date, e.memo
        FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.id = ${input.journalLineId}::uuid`),
    );
    if (!j || j.organization_id !== input.organizationId) throw new LedgerError("not_found", "That ledger line was not found.");
    if (j.status !== "posted") throw new LedgerError("refused", "Only a posted entry can be matched to the bank statement.");
    if (j.account_id !== bank.ledgerAccountId || j.currency !== bank.currency) throw new LedgerError("refused", `That ledger line is not on ${bank.name}.`);
    if (cents(j.amount) !== cents(line.amount)) throw new LedgerError("refused", `The amounts differ (${cents(line.amount)} on the statement, ${cents(j.amount)} in the ledger). A match needs the same amount.`);
    const [other] = await tx.select({ id: s.bankStatementLines.id }).from(s.bankStatementLines).where(eq(s.bankStatementLines.matchedLineId, input.journalLineId)).limit(1);
    if (other) throw new LedgerError("refused", "That ledger line is already matched to another statement line.");
    await tx.update(s.bankStatementLines).set({ matchedLineId: input.journalLineId }).where(eq(s.bankStatementLines.id, line.id));
    await logAudit(tx, input.projectId, {
      entity: "bank_statement_line",
      entityId: line.id,
      action: "ledger_line_matched",
      by: input.by,
      detail: { bankAccount: bank.name, date: line.date, amount: cents(line.amount), ledgerDate: j.date, journalLineId: input.journalLineId },
    });
  });
}

/** Takes a match off, until the month is reconciled. */
export async function unmatchLine(input: { organizationId: string; statementLineId: string; by: string; projectId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const { line, bank, period } = await statementLineOf(tx, input.organizationId, input.statementLineId);
    await refuseIfCompleted(tx, bank, period, "its matches can no longer change");
    if (!line.matchedLineId) return;
    await tx.update(s.bankStatementLines).set({ matchedLineId: null }).where(eq(s.bankStatementLines.id, line.id));
    await logAudit(tx, input.projectId, {
      entity: "bank_statement_line",
      entityId: line.id,
      action: "ledger_line_unmatched",
      by: input.by,
      detail: { bankAccount: bank.name, date: line.date, amount: cents(line.amount), journalLineId: line.matchedLineId },
    });
  });
}

/** Confirms every suggested match at once. Returns how many were made. */
export async function matchSuggested(input: { organizationId: string; bankAccountId: string; month: string; by: string; projectId: string }): Promise<number> {
  const view = await reconciliationView(input.organizationId, input.bankAccountId, input.month);
  let n = 0;
  for (const l of view.statementLines) {
    if (!l.suggestion || l.matchedLineId) continue;
    await matchLine({ organizationId: input.organizationId, statementLineId: l.id, journalLineId: l.suggestion.lineId, by: input.by, projectId: input.projectId });
    n++;
  }
  return n;
}

/* ---------------- Completing and locking ---------------- */

/**
 * Completes the month's reconciliation for the bank account, only at a zero difference (the
 * database refuses any other). The book balance is read again in the same transaction. One audit
 * row, action ledger_reconciled.
 */
export async function completeReconciliation(input: { organizationId: string; bankAccountId: string; month: string; by: string; projectId: string }): Promise<{ id: string; completedAt: string }> {
  const period = monthPeriod(input.month);
  const asOf = periodEnd(period);
  if (!monthEnded(period)) throw new LedgerError("refused", `${monthName(period)} has not ended yet. A month is reconciled once the bank's statement for it is complete.`);
  return db.transaction(async (tx) => {
    const bank = await bankOf(tx, input.organizationId, input.bankAccountId);
    const [r] = await tx
      .select()
      .from(s.reconciliations)
      .where(and(eq(s.reconciliations.bankAccountId, bank.id), eq(s.reconciliations.period, period)))
      .for("update")
      .limit(1);
    if (!r) throw new LedgerError("invalid", "Enter the statement's closing balance first.");
    if (r.completedAt) return { id: r.id, completedAt: r.completedAt.toISOString() };
    const book = await bookBalance(tx, bank, asOf);
    const statement = cents(r.statementBalance);
    const difference = fromCents(toCents(statement) - toCents(book));
    if (toCents(difference) !== BigInt(0))
      throw new LedgerError("refused", `The difference is ${difference} ${bank.currency}. A reconciliation is completed only at zero: match the lines, record what is missing, or check the closing balance.`);
    const now = new Date();
    const [done] = await tx
      .update(s.reconciliations)
      .set({ bookBalance: book, difference, completedBy: input.by, completedAt: now })
      .where(eq(s.reconciliations.id, r.id))
      .returning();
    const [{ n, m }] = await tx
      .select({ n: sql<number>`count(*)::int`, m: sql<number>`count(${s.bankStatementLines.matchedLineId})::int` })
      .from(s.bankStatementLines)
      .where(and(eq(s.bankStatementLines.bankAccountId, bank.id), gte(s.bankStatementLines.date, period), lte(s.bankStatementLines.date, asOf)));
    await logAudit(tx, input.projectId, {
      entity: "reconciliation",
      entityId: done.id,
      action: "ledger_reconciled",
      by: input.by,
      detail: { bankAccount: bank.name, currency: bank.currency, period, statementBalance: statement, bookBalance: book, statementLines: n, matched: m },
    });
    return { id: done.id, completedAt: now.toISOString() };
  });
}

/**
 * Locks the month for the organization once this bank account's reconciliation is complete. Nothing
 * can be posted into a locked month afterwards. `draftsLeft` counts drafts dated in it.
 */
export async function lockMonth(input: { organizationId: string; bankAccountId: string; month: string; by: string }) {
  const period = monthPeriod(input.month);
  if (!monthEnded(period)) throw new LedgerError("refused", `${monthName(period)} has not ended yet, so it cannot be locked.`);
  const bank = await bankOf(db, input.organizationId, input.bankAccountId);
  const r = await reconRow(db, bank.id, period);
  if (!r?.completedAt) throw new LedgerError("refused", `Reconcile ${bank.name} for ${monthName(period)} before locking the month.`);
  return lockPeriod(input.organizationId, period, input.by);
}

/* ---------------- Nightly check ---------------- */

export type ReconciliationMismatch = {
  reconciliationId: string;
  bankAccountId: string;
  bankAccount: string;
  currency: string;
  period: string;
  statementBalance: string;
  bookBalanceThen: string;
  bookBalanceNow: string;
  /** Statement minus the book balance now. */
  difference: string;
  locked: boolean;
};

/**
 * The organization's completed reconciliations that no longer agree with the ledger: the book
 * balance at the end of the month, read now, differs from the one recorded when it was completed
 * (an entry posted or reversed later dated into a month that was reconciled but not locked).
 */
export async function reconciliationsStillMatch(orgId: string): Promise<ReconciliationMismatch[]> {
  const rows = rowsOf<{ id: string; bank_account_id: string; name: string; currency: string; period: string; statement_balance: string; book_balance: string; now: string | null; locked: boolean }>(
    await db.execute(sql`
      SELECT r.id, r.bank_account_id, b.name, b.currency, r.period::text AS period, r.statement_balance::text AS statement_balance, r.book_balance::text AS book_balance,
        (SELECT (coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0))::text
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
           WHERE e.status = 'posted' AND l.account_id = b.ledger_account_id AND l.currency = b.currency
             AND e.entry_date <= (r.period + interval '1 month' - interval '1 day')::date) AS now,
        EXISTS (SELECT 1 FROM fiscal_periods f WHERE f.organization_id = b.organization_id AND f.period = r.period AND f.locked_at IS NOT NULL) AS locked
      FROM reconciliations r JOIN bank_accounts b ON b.id = r.bank_account_id
      WHERE b.organization_id = ${orgId} AND r.completed_at IS NOT NULL
      ORDER BY r.period, b.name`),
  );
  return rows
    .map((r) => {
      const now = cents(r.now);
      return {
        reconciliationId: r.id,
        bankAccountId: r.bank_account_id,
        bankAccount: r.name,
        currency: r.currency,
        period: r.period,
        statementBalance: cents(r.statement_balance),
        bookBalanceThen: cents(r.book_balance),
        bookBalanceNow: now,
        difference: fromCents(toCents(cents(r.statement_balance)) - toCents(now)),
        locked: r.locked === true || String(r.locked) === "true",
      };
    })
    .filter((r) => r.bookBalanceNow !== r.bookBalanceThen || toCents(r.difference) !== BigInt(0));
}

/* ---------------- Helpers ---------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A numeric from SQL ("12.5", "-3", "0", null) as "12.50". */
function cents(v: string | number | null | undefined): string {
  const t = String(v ?? "0");
  const neg = t.startsWith("-");
  const [i, f = ""] = (neg ? t.slice(1) : t).split(".");
  return fromCents(toCents(`${neg ? "-" : ""}${i || "0"}.${f.padEnd(2, "0").slice(0, 2)}`));
}

/** Rows from db.execute on either driver (postgres-js returns an array; PGlite returns { rows }). */
function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}
