import { ledgerSpent } from "@/server/ledger-spent";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { BALANCING_RULE, fromCents, toCents, totals } from "@/lib/ledger/rules";
import { onProject, people } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { HttpError } from "@/server/guard";
import { hrBook, loadHr } from "@/server/hr-store";
import { accounts, budgetLineEntries, budgetVsActual, expenseAccountFor, ledgerSettings, LedgerError, type EntryWithLines, type JournalEntry } from "@/server/ledger";
import { ensureChart, moneyAccounts } from "@/server/ledger-setup";
import { sourceOf } from "@/server/books-posting";
import type { OpenPurchase } from "@/lib/ledger/payment-guard";
import { DONE, lineOf, valueOf, type Procurement } from "@/lib/procurement";
import { loadProcurements } from "@/server/procurement-store";

/**
 * What the ledger screens read and who may do what on them: Record a payment (/work/payments)
 * and Budget vs actual from the books (a section of /progress/budget). The writes are in
 * server/ledger; this file shapes its answers for people and checks the roles.
 */

/* ---------------- Who may do what ---------------- */

export type LedgerMay = { record: boolean; post: boolean; setup: boolean };

/**
 * Recording a payment mirrors recording a bill (api/projects/[code]/bills): Finance and the people
 * named for bill entry. Posting a draft someone else recorded is for Finance: the finance role
 * type, procurement role finance, or the project role finance-import. Setting up the bank and
 * cash accounts: Finance or an administrator.
 */
export async function ledgerMay(u: AppUser): Promise<LedgerMay> {
  if (u.kind !== "employee") return { record: false, post: false, setup: false };
  const holders = (await loadHr()).state.rules?.holders;
  const has = (t: "finance" | "bills") => !!holders?.[t]?.includes(u.id);
  const finance = has("finance") || u.procurement.includes("finance") || u.project.includes("finance-import");
  return { record: finance || has("bills"), post: finance, setup: finance || !!u.admin };
}

/** The people who may post a draft on this project, other than `except` (who recorded it). Names only. */
export async function whoCanPost(code: string, except: string): Promise<string[]> {
  const holders = (await loadHr()).state.rules?.holders;
  const all = await people();
  return all
    .filter((p) => p.kind === "employee" && p.id !== except && onProject(p, code))
    .filter((p) => !!holders?.finance?.includes(p.id) || p.procurement.includes("finance") || p.project.includes("finance-import"))
    .map((p) => p.name);
}

/** A refusal from the ledger as an answer for the screen, with a status that fits it. */
export function asHttp(e: unknown): unknown {
  if (!(e instanceof LedgerError)) return e;
  const status = e.code === "invalid" ? 400 : e.code === "not_found" ? 404 : 409;
  return new HttpError(status, e.message);
}

/** The project and the organization whose books it uses. */
export async function ledgerProject(code: string) {
  const p = await projectByCode(code);
  return { id: p.id, code, name: p.name, organizationId: p.organizationId };
}

/**
 * Seeds the organization's chart the first time its books are opened. Where the ledger tables are
 * not in the database yet (the migration not applied), says so plainly instead of failing.
 */
async function openBooks(orgId: string): Promise<void> {
  try {
    await ensureChart(orgId);
  } catch (e) {
    for (let cur: unknown = e, i = 0; cur && i < 5; cur = (cur as { cause?: unknown }).cause, i++)
      if (/relation "?(ledger_accounts|journal_entries|journal_lines|bank_accounts)"? does not exist/i.test(String((cur as { message?: string }).message ?? "")))
        throw new HttpError(503, "The books are not switched on for this database yet. An administrator applies the ledger update first.");
    throw e;
  }
}

/* ---------------- Entries, in plain words ---------------- */

export type EntryLineView = {
  no: number;
  account: string;
  code: string;
  debit: string;
  credit: string;
  currency: string;
  fxRate: string;
  functionalDebit: string;
  functionalCredit: string;
  budgetLine: string | null;
  donor: string | null;
  memo: string | null;
};

export type EntryRow = {
  id: string;
  date: string;
  kind: string;
  sourceType: string;
  status: "draft" | "posted";
  /** Who was paid, for a payment recorded on this screen. */
  payee: string | null;
  /** What it was for. */
  what: string;
  memo: string;
  /** In the currency it was paid in. */
  amount: string;
  amountCurrency: string;
  /** In the organization's own currency. */
  functional: string;
  recordedBy: string;
  postedBy: string | null;
  receipt: { hash: string; name: string } | null;
  /** The bill or purchase the entry was posted from, and the page that holds it. */
  from: { kind: "bill" | "purchase"; id: string; project: string; href: string } | null;
  reversesId: string | null;
  reversedBy: string | null;
  canPost: boolean;
  canDelete: boolean;
  canReverse: boolean;
};

/** Who was paid and what for, from how the payment screen writes them: memo "payee: what", the expense line's memo "what". */
function payeeAndWhat(e: EntryWithLines): { payee: string | null; what: string } {
  const lineMemo = e.lines.find((l) => toCents(l.debit) > BigInt(0) && l.memo)?.memo ?? null;
  if (["payment", "bill", "purchase"].includes(e.entry.sourceType) && lineMemo && e.entry.memo.endsWith(`: ${lineMemo}`)) return { payee: e.entry.memo.slice(0, -(lineMemo.length + 2)), what: lineMemo };
  return { payee: null, what: e.entry.memo };
}

/** The amount in the currency it was paid in: the debits of the first line's currency. */
function paidAmount(e: EntryWithLines): { amount: string; currency: string } {
  const currency = e.lines[0]?.currency ?? "";
  const sum = e.lines.filter((l) => l.currency === currency).reduce((a, l) => a + toCents(l.debit), BigInt(0));
  return { amount: fromCents(sum), currency };
}

type Ctx = { me: string; may: LedgerMay; limit: string; names: Map<string, string>; receipts: Map<string, string>; reversedBy: Map<string, string> };

function rowOf(e: EntryWithLines, ctx: Ctx): EntryRow {
  const { payee, what } = payeeAndWhat(e);
  const paid = paidAmount(e);
  const functional = totals(e.lines).functionalDebit;
  const over = toCents(functional) > toCents(ctx.limit);
  const draft = e.entry.status === "draft";
  const reversedBy = ctx.reversedBy.get(e.entry.id) ?? null;
  const hash = e.entry.sourceType === "payment" && e.entry.sourceId && /^[0-9a-f]{64}$/.test(e.entry.sourceId) ? e.entry.sourceId : null;
  return {
    id: e.entry.id,
    date: e.entry.entryDate,
    kind: e.entry.kind,
    sourceType: e.entry.sourceType,
    status: draft ? "draft" : "posted",
    payee,
    what,
    memo: e.entry.memo,
    amount: paid.amount,
    amountCurrency: paid.currency,
    functional,
    recordedBy: ctx.names.get(e.entry.recordedBy) ?? e.entry.recordedBy,
    postedBy: e.entry.postedBy ? (ctx.names.get(e.entry.postedBy) ?? e.entry.postedBy) : null,
    receipt: hash ? { hash, name: ctx.receipts.get(hash) ?? "Receipt" } : null,
    from: sourceOf(e.entry.sourceType, e.entry.sourceId),
    reversesId: e.entry.reversesId,
    reversedBy,
    canPost: draft && ctx.may.post && (e.entry.recordedBy !== ctx.me || !over),
    canDelete: draft && (ctx.may.post || e.entry.recordedBy === ctx.me),
    canReverse: !draft && ctx.may.record && e.entry.kind !== "reversal" && !reversedBy,
  };
}

async function context(entries: EntryWithLines[], me: string, may: LedgerMay, orgId: string): Promise<Ctx> {
  const ids = entries.map((e) => e.entry.id);
  const hashes = [...new Set(entries.map((e) => e.entry.sourceId).filter((h): h is string => !!h && /^[0-9a-f]{64}$/.test(h)))];
  const [all, files, reversals, settings] = await Promise.all([
    people(),
    hashes.length ? db.select({ hash: s.hrFiles.hash, name: s.hrFiles.name }).from(s.hrFiles).where(and(eq(s.hrFiles.book, hrBook()), inArray(s.hrFiles.hash, hashes))) : Promise.resolve([]),
    ids.length ? db.select({ id: s.journalEntries.id, reverses: s.journalEntries.reversesId }).from(s.journalEntries).where(inArray(s.journalEntries.reversesId, ids)) : Promise.resolve([]),
    ledgerSettings(orgId),
  ]);
  return {
    me,
    may,
    limit: settings.selfPostLimit,
    names: new Map(all.map((p) => [p.id, p.name])),
    receipts: new Map(files.map((f) => [f.hash, f.name])),
    reversedBy: new Map(reversals.filter((r) => r.reverses).map((r) => [r.reverses!, r.id])),
  };
}

async function withLines(entries: JournalEntry[]): Promise<EntryWithLines[]> {
  if (!entries.length) return [];
  const lines = await db
    .select()
    .from(s.journalLines)
    .where(
      inArray(
        s.journalLines.entryId,
        entries.map((e) => e.id),
      ),
    );
  return entries.map((e) => ({ entry: e, lines: lines.filter((l) => l.entryId === e.id).sort((a, b) => a.lineNo - b.lineNo) }));
}

/* ---------------- Record a payment ---------------- */

/** A purchase a payment could still be for: any that is not paid and closed out. */
export const openPurchases = (all: readonly Procurement[]): OpenPurchase[] =>
  all.filter((p) => p.step !== DONE && p.step !== "close").map((p) => ({ id: p.id, title: p.title, lineCode: lineOf(p)?.code ?? p.budgetLine, supplier: p.supplier?.name ?? null, usd: valueOf(p) }));

export async function paymentsView(code: string, u: AppUser) {
  const project = await ledgerProject(code);
  const org = project.organizationId;
  await openBooks(org);
  const [may, settings, money, lines, donors, chart] = await Promise.all([
    ledgerMay(u),
    ledgerSettings(org),
    moneyAccounts(org),
    db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, project.id)),
    db.select({ id: s.donors.id, name: s.donors.name }).from(s.donors).where(eq(s.donors.projectId, project.id)),
    accounts(org),
  ]);
  lines.sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
  const expenseFor = new Map<string, string | null>();
  for (const kind of new Set(lines.map((l) => l.kind))) expenseFor.set(kind, (await expenseAccountFor(org, kind))?.id ?? null);

  const recentRows = await db.select().from(s.journalEntries).where(and(eq(s.journalEntries.projectId, project.id), eq(s.journalEntries.status, "posted"))).orderBy(desc(s.journalEntries.entryDate), desc(s.journalEntries.createdAt)).limit(30);
  const draftRows = await db.select().from(s.journalEntries).where(and(eq(s.journalEntries.projectId, project.id), eq(s.journalEntries.status, "draft"))).orderBy(desc(s.journalEntries.createdAt)).limit(50);
  // Finance sees every draft on the project; anyone else only the drafts they recorded.
  const drafts = await withLines(draftRows.filter((d) => may.post || d.recordedBy === u.id));
  const recent = await withLines(recentRows);
  const ctx = await context([...drafts, ...recent], u.id, may, org);
  const draftViews = await Promise.all(drafts.map(async (d) => ({ ...rowOf(d, ctx), whoCanPost: await whoCanPost(code, d.entry.recordedBy) })));

  return {
    me: u.id,
    project: { code, name: project.name },
    currency: settings.functionalCurrency,
    selfPostLimit: settings.selfPostLimit,
    may,
    /** False until the organization has a bank or cash account to pay from. */
    ready: money.length > 0,
    money,
    budgetLines: lines.map((l) => ({ id: l.id, code: l.code, description: l.description, kind: l.kind, currency: l.currency, expenseAccountId: expenseFor.get(l.kind) ?? null })),
    donors,
    /** Account names by id, for the "What this writes" panel. */
    chart: Object.fromEntries(chart.map((a) => [a.id, { code: a.code, name: a.name }])),
    balancingRule: BALANCING_RULE,
    drafts: draftViews,
    recent: recent.map((e) => rowOf(e, ctx)),
    /** Purchases not yet closed, so the form can ask about the ones on the chosen budget line (lib/ledger/payment-guard). */
    openPurchases: openPurchases(await loadProcurements(code)),
  };
}
export type PaymentsView = Awaited<ReturnType<typeof paymentsView>>;

/** One entry with its lines in plain words, for "What this wrote". Only an entry of this project. */
export async function entryView(code: string, id: string, u: AppUser) {
  const project = await ledgerProject(code);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "That entry was not found.");
  const [e] = await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, id)).limit(1);
  if (!e || e.projectId !== project.id) throw new HttpError(404, "That entry was not found on this project.");
  // A draft is seen by Finance and by the person who recorded it, as on the payment screen.
  const may = await ledgerMay(u);
  if (e.status === "draft" && !may.post && e.recordedBy !== u.id) throw new HttpError(404, "That entry was not found on this project.");
  const [full] = await withLines([e]);
  const ctx = await context([full], u.id, may, project.organizationId);
  const [chart, lines, donors, settings] = await Promise.all([
    accounts(project.organizationId),
    db.select({ id: s.budgetLines.id, code: s.budgetLines.code, description: s.budgetLines.description }).from(s.budgetLines).where(eq(s.budgetLines.projectId, project.id)),
    db.select({ id: s.donors.id, name: s.donors.name }).from(s.donors).where(eq(s.donors.projectId, project.id)),
    ledgerSettings(project.organizationId),
  ]);
  const acc = new Map(chart.map((a) => [a.id, a]));
  const bl = new Map(lines.map((l) => [l.id, `${l.code} ${l.description}`]));
  const dn = new Map(donors.map((d) => [d.id, d.name]));
  return {
    entry: rowOf(full, ctx),
    currency: settings.functionalCurrency,
    balancingRule: BALANCING_RULE,
    lines: full.lines.map(
      (l): EntryLineView => ({
        no: l.lineNo,
        account: acc.get(l.accountId)?.name ?? "",
        code: acc.get(l.accountId)?.code ?? "",
        debit: l.debit,
        credit: l.credit,
        currency: l.currency,
        fxRate: l.fxRate,
        functionalDebit: l.functionalDebit,
        functionalCredit: l.functionalCredit,
        budgetLine: l.budgetLineId ? (bl.get(l.budgetLineId) ?? null) : null,
        donor: l.donorId ? (dn.get(l.donorId) ?? null) : null,
        memo: l.memo,
      }),
    ),
  };
}
export type EntryView = Awaited<ReturnType<typeof entryView>>;

/* ---------------- Budget vs actual ---------------- */

export async function budgetActualView(code: string) {
  const project = await ledgerProject(code);
  await openBooks(project.organizationId);
  // The pages read the books once anything is posted on the project (decision AQ).
  const [b, booksKept] = await Promise.all([budgetVsActual(project.id), ledgerSpent(project.id).then((x) => x !== null)]);
  // Whether the Budget page's own figures come from these books or from the imported workbook.
  return { project: { code, name: project.name }, ...b, booksKept };
}
export type BudgetActualView = Awaited<ReturnType<typeof budgetActualView>>;

/**
 * The posted entries behind one figure: `line` a budget line id or "none" (not on a line), `donor`
 * a donor id, "none" (no donor) or undefined (any). `amount` is what each entry put on that line
 * and donor, in the functional currency.
 */
export async function drillView(code: string, u: AppUser, line: string, donor: string | undefined) {
  const project = await ledgerProject(code);
  const uuid = /^[0-9a-f-]{36}$/i;
  if (line !== "none") {
    if (!uuid.test(line)) throw new HttpError(400, "Choose a budget line.");
    const [bl] = await db.select({ projectId: s.budgetLines.projectId }).from(s.budgetLines).where(eq(s.budgetLines.id, line)).limit(1);
    if (!bl || bl.projectId !== project.id) throw new HttpError(404, "That budget line is not on this project.");
  }
  if (donor !== undefined && donor !== "none" && !uuid.test(donor)) throw new HttpError(400, "Choose a donor.");
  const donorId = donor === undefined ? undefined : donor === "none" ? null : donor;
  const entries = await budgetLineEntries({ budgetLineId: line === "none" ? null : line, projectId: project.id, donorId });
  const chart = new Map((await accounts(project.organizationId)).map((a) => [a.id, a]));
  const ctx = await context(entries, u.id, await ledgerMay(u), project.organizationId);
  return entries.map((e) => {
    const mine = e.lines.filter((l) => chart.get(l.accountId)?.type === "expense" && (line === "none" ? !l.budgetLineId && l.projectId === project.id : l.budgetLineId === line) && (donorId === undefined || (l.donorId ?? null) === donorId));
    const onLine = mine.reduce((a, l) => a + toCents(l.functionalDebit) - toCents(l.functionalCredit), BigInt(0));
    return { ...rowOf(e, ctx), onLine: fromCents(onLine) };
  });
}
export type DrillRow = Awaited<ReturnType<typeof drillView>>[number];
