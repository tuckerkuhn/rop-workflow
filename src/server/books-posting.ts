import { and, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { recordedRate, standing, type FilledEntry, type Posting, type PostingState } from "@/lib/books-posting";
import type { AppUser } from "@/lib/demo";
import { people } from "@/server/auth";
import { recordExpenditure } from "@/server/expenditure-store";
import { projectByCode } from "@/server/field-store";
import { HttpError } from "@/server/guard";
import { ledgerSettings, LedgerError, postPayment } from "@/server/ledger";
import { ensureChart, moneyAccounts, type MoneyAccount } from "@/server/ledger-setup";
import { asHttp, ledgerMay, ledgerProject, whoCanPost } from "@/server/ledger-view";
import { loadProjectState, saveProjectState } from "@/server/project-state";

/**
 * A filed bill or a paid purchase goes to the books when Finance posts it (decision AI, 25 Nov
 * 2026). It posts through `recordExpenditure`, so the ledger's own rules stand: no posting into a
 * locked month, and over the organization's limit the person who recorded the bill or the
 * payment does not post it. One key per bill or purchase payment, so nothing posts twice.
 *
 * A wrong entry is reversed in the books (server/expenditure-store `reverseExpenditure`). The
 * reversal is read from the ledger here, never kept a second time on the bill or the purchase.
 */

export const BILL_SOURCE = "bill";
export const PURCHASE_SOURCE = "purchase";

/** Where a posted entry came from, for the books' own screens: the bill or purchase and the page that holds it. */
export function sourceOf(sourceType: string, sourceId: string | null): { kind: "bill" | "purchase"; id: string; project: string; href: string } | null {
  if (!sourceId || (sourceType !== BILL_SOURCE && sourceType !== PURCHASE_SOURCE)) return null;
  const at = sourceId.indexOf(":");
  if (at < 1) return null;
  const project = sourceId.slice(0, at);
  const id = sourceId.slice(at + 1);
  if (sourceType === BILL_SOURCE) return { kind: "bill", id, project, href: `/work/bills?project=${encodeURIComponent(project)}&open=${encodeURIComponent(id)}` };
  // A purchase payment is "<purchase id>#<payment number>".
  const purchase = id.split("#")[0];
  return { kind: "purchase", id, project, href: `/work?source=procurement&open=${encodeURIComponent(purchase)}&project=${encodeURIComponent(project)}` };
}

/** Who posts a bill or a purchase to the books: Finance, as for a draft someone else recorded. */
export const mayPostToBooks = async (u: AppUser) => (await ledgerMay(u)).post;

/** Each posting with what the books say of it today: reversed, a reversal waiting, or standing. */
export async function postingStates(postings: Posting[] | undefined): Promise<PostingState[]> {
  if (!postings?.length) return [];
  const rows = await db
    .select({ id: s.journalEntries.id, reverses: s.journalEntries.reversesId, status: s.journalEntries.status, by: s.journalEntries.recordedBy, date: s.journalEntries.entryDate, memo: s.journalEntries.memo })
    .from(s.journalEntries)
    .where(
      inArray(
        s.journalEntries.reversesId,
        postings.map((p) => p.entryId),
      ),
    );
  const names = rows.length ? new Map((await people()).map((p) => [p.id, p.name])) : new Map<string, string>();
  return postings.map((p) => {
    const r = rows.find((x) => x.reverses === p.entryId);
    return { ...p, reversal: r ? { entryId: r.id, posted: r.status === "posted", by: names.get(r.by) ?? r.by, date: r.date, reason: r.memo.replace(/^Reversed: /, "") } : null };
  });
}

/** The bank and cash accounts a project's organization pays from. Empty until Finance has set them up. */
export async function payingAccounts(projectCode: string): Promise<MoneyAccount[]> {
  const project = await projectByCode(projectCode);
  await ensureChart(project.organizationId);
  return moneyAccounts(project.organizationId);
}

/**
 * A bill or a purchase payment and the books, as its screen shows it: the entry filled in from
 * it, the entry that stands, those reversed, and whether this person can post it now.
 */
export async function booksView(q: { code: string; entry: FilledEntry; postings: Posting[] | undefined; problem: string | null; recordedBy: string | null; me: string; post: boolean }) {
  const postings = await postingStates(q.postings);
  const now = standing(postings);
  // The ledger's rule: over the organization's limit the person who recorded it does not post it.
  // Said before the press, with who can.
  let second: { limit: string; who: string[] } | null = null;
  if (q.post && !q.problem && !now && q.recordedBy === q.me) {
    const limit = await ledgerProject(q.entry.project)
      .then((p) => ledgerSettings(p.organizationId))
      .catch(() => null);
    if (limit && q.entry.usd > Number(limit.selfPostLimit)) second = { limit: `${limit.functionalCurrency} ${Number(limit.selfPostLimit).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, who: await whoCanPost(q.code, q.me).catch(() => []) };
  }
  return {
    entry: q.entry,
    standing: now,
    reversed: postings.filter((p) => p.reversal?.posted),
    /** It goes to the books: paid (a bill: filed) and charged to a project's budget line. */
    goes: !q.problem,
    /** This person recorded it and it is over the limit: who posts it instead. */
    second,
    /** Finance can post it now. */
    canPost: q.post && !q.problem && !now && !second,
    /** Why this person cannot post it, when Finance could. */
    whyNot: q.problem ?? (now ? null : !q.post ? "Finance posts it to the books." : null),
  };
}
export type BooksView = Awaited<ReturnType<typeof booksView>>;

/* ---------------- Purchases ---------------- */

/**
 * Where a purchase payment's postings are kept: one project_state document, by "<purchase>#<payment
 * number>". Not on the purchase itself, which the screen saves whole: a posting is written only here,
 * by the server, when the books took the entry.
 */
export const PURCHASE_BOOKS_KEY = "purchase-books";
export type PurchaseBooks = { postings: Record<string, Posting[]> };
export const paymentKey = (purchase: string, n: number) => `${purchase}#${n}`;

export async function loadPurchaseBooks(code: string): Promise<PurchaseBooks> {
  return loadProjectState<PurchaseBooks>((await projectByCode(code)).id, PURCHASE_BOOKS_KEY, { postings: {} });
}

/** Adds one posting to a payment's record, once. */
export async function keepPurchasePosting(code: string, key: string, posting: Posting): Promise<boolean> {
  const project = await projectByCode(code);
  const book = await loadProjectState<PurchaseBooks>(project.id, PURCHASE_BOOKS_KEY, { postings: {} });
  if ((book.postings[key] ?? []).some((p) => p.entryId === posting.entryId)) return false;
  await saveProjectState(project.id, PURCHASE_BOOKS_KEY, { postings: { ...book.postings, [key]: [...(book.postings[key] ?? []), posting] } });
  return true;
}

const plain = (x: PostingState): Posting => ({ n: x.n, entryId: x.entryId, expenditureId: x.expenditureId, date: x.date, paidFrom: x.paidFrom, paidFromName: x.paidFromName, budgetLine: x.budgetLine, amount: x.amount, currency: x.currency, by: x.by, name: x.name, at: x.at });

export type ToPost = {
  /** The project whose budget line it is charged to. */
  project: string;
  budgetLine: string;
  /** Who was paid and what for. */
  payee: string;
  what: string;
  /** As on the bill or the invoice. */
  amount: number;
  currency: string;
  /** The same in dollars at the rate recorded on it. */
  usd: number;
  date: string;
  /** Chart code of the bank or cash account. */
  paidFrom: string;
  /** Who recorded the bill or the payment, and who posts it now. */
  recordedBy: string;
  postedBy: AppUser;
  source: { type: string; id: string; key: string };
  /** Earlier postings of the same bill or payment, with their state. */
  earlier: PostingState[];
  /**
   * A general and admin bill: charged to no project. `project` is then only the page it was
   * posted from (its organization and bank accounts); `budgetLine` is ignored.
   */
  general?: boolean;
};

/** The organization-wide account a general and admin bill is charged to (decision AN). */
export const GENERAL_ADMIN_CODE = "7000";
export const GENERAL_ADMIN_NAME = "General and admin (account 7000, Office and operations)";

async function postGeneral(p: ToPost, n: number, today: string, organizationId: string): Promise<{ posting: Posting; replayed: boolean }> {
  const paying = await payingAccounts(p.project);
  const account = paying.find((m) => m.code === p.paidFrom);
  if (!account) throw new HttpError(400, "Choose the bank or cash account the money was paid from.");
  await ensureChart(organizationId);
  const [expense] = await db
    .select()
    .from(s.ledgerAccounts)
    .where(and(eq(s.ledgerAccounts.organizationId, organizationId), eq(s.ledgerAccounts.code, GENERAL_ADMIN_CODE)))
    .limit(1);
  if (!expense) throw new HttpError(400, `The books have no account ${GENERAL_ADMIN_CODE} for general and admin costs. Add it to the chart of accounts first.`);
  const { functionalCurrency } = await ledgerSettings(organizationId);
  const own = account.currency === p.currency;
  const inFunctional = !own && account.currency === functionalCurrency && functionalCurrency === "USD";
  const amount = inFunctional ? p.usd.toFixed(2) : p.amount.toFixed(2);
  const currency = inFunctional ? functionalCurrency : p.currency;
  const what = inFunctional ? `${p.what} (${p.currency} ${Math.round(p.amount).toLocaleString("en-US")} at the rate recorded)` : p.what;
  try {
    const e = await postPayment(
      { organizationId, recordedBy: p.recordedBy, postedBy: p.postedBy.id, idempotencyKey: `${p.source.key}:${n}`, sourceType: p.source.type, sourceId: p.source.id },
      { date: p.date, memo: `${p.payee}: ${what}`, paidFrom: account.ledgerAccountId, currency, fxRate: currency === functionalCurrency ? "1" : recordedRate(p.amount, p.usd), projectId: null, expenses: [{ accountId: expense.id, amount, projectId: null, budgetLineId: null, memo: what }] },
    );
    const credit = e.lines.find((l) => Number(l.credit) > 0);
    const from = paying.find((m) => m.ledgerAccountId === credit?.accountId) ?? account;
    const debit = e.lines.find((l) => Number(l.debit) > 0);
    const posting: Posting = { n, entryId: e.entry.id, expenditureId: "", date: e.entry.entryDate, paidFrom: from.code, paidFromName: from.name, budgetLine: "", amount: debit ? Number(debit.debit).toFixed(2) : amount, currency: debit?.currency ?? currency, by: e.entry.postedBy ?? p.postedBy.id, name: e.entry.postedBy && e.entry.postedBy !== p.postedBy.id ? ((await people()).find((x) => x.id === e.entry.postedBy)?.name ?? e.entry.postedBy) : p.postedBy.name, at: today };
    return { posting, replayed: e.replayed };
  } catch (e) {
    if (e instanceof LedgerError && e.code === "needs_second_person")
      throw new HttpError(409, `${e.message.split(", so ")[0]}, so someone in Finance other than the person who recorded it posts it to the books.`);
    throw asHttp(e);
  }
}

/**
 * Posts one bill or one purchase payment to the books and gives back the record to keep on it.
 * Pressing twice, or two people pressing at once, gives the same entry: the key is made from
 * the bill or payment and the number of the posting.
 */
export async function postToBooks(p: ToPost): Promise<{ posting: Posting; replayed: boolean }> {
  const still = standing(p.earlier);
  if (still?.reversal) throw new HttpError(409, "A reversal of the entry waits for a second person to post it. It is posted or deleted under Record a payment first.");
  // Already in the books and not reversed: the same record again, nothing written.
  if (still) return { posting: plain(still), replayed: true };
  const n = p.earlier.length + 1;
  const today = new Date().toISOString().slice(0, 10);
  if (p.date > today) throw new HttpError(400, "The date paid cannot be after today.");
  const project = await projectByCode(p.project);
  // A general and admin bill (decision AN): no project budget line; it goes to the organization's
  // general and admin expense account, with no project on the entry.
  if (p.general) return postGeneral(p, n, today, project.organizationId);
  const [line] = await db
    .select()
    .from(s.budgetLines)
    .where(and(eq(s.budgetLines.projectId, project.id), eq(s.budgetLines.code, p.budgetLine)))
    .limit(1);
  if (!line) throw new HttpError(400, `Line ${p.budgetLine} is not in that project's budget, so there is nothing to charge it to.`);
  const paying = await payingAccounts(p.project);
  const account = paying.find((m) => m.code === p.paidFrom);
  if (!account) throw new HttpError(400, "Choose the bank or cash account the money was paid from.");
  const { functionalCurrency } = await ledgerSettings(project.organizationId);
  // Paid from an account in the document's own currency: posted in that currency at the rate
  // recorded on it. Paid from an account in the organization's own currency: posted as the
  // figure that rate gives. Any other pair the ledger refuses, in its own words.
  const own = account.currency === p.currency;
  const inFunctional = !own && account.currency === functionalCurrency && functionalCurrency === "USD";
  const amount = inFunctional ? p.usd.toFixed(2) : p.amount.toFixed(2);
  const currency = inFunctional ? functionalCurrency : p.currency;
  const what = inFunctional ? `${p.what} (${p.currency} ${Math.round(p.amount).toLocaleString("en-US")} at the rate recorded)` : p.what;
  try {
    const r = await recordExpenditure({
      budgetLineId: line.id,
      description: what,
      memo: `${p.payee}: ${what}`,
      amount,
      currency,
      fxRate: currency === functionalCurrency ? undefined : recordedRate(p.amount, p.usd),
      spentOn: p.date,
      recordedBy: p.recordedBy,
      postedBy: p.postedBy.id,
      paidFromCode: account.code,
      source: { ...p.source, key: `${p.source.key}:${n}` },
    });
    // The entry itself says what was written, also when this press found an entry already there
    // (the first press wrote it and its record on the bill or purchase was lost).
    const e = r.entry;
    const credit = e.lines.find((l) => Number(l.credit) > 0);
    const from = paying.find((m) => m.ledgerAccountId === credit?.accountId) ?? account;
    const debit = e.lines.find((l) => Number(l.debit) > 0);
    const posting: Posting = { n, entryId: e.entry.id, expenditureId: r.expenditureId, date: e.entry.entryDate, paidFrom: from.code, paidFromName: from.name, budgetLine: line.code, amount: debit ? Number(debit.debit).toFixed(2) : amount, currency: debit?.currency ?? currency, by: e.entry.postedBy ?? p.postedBy.id, name: e.entry.postedBy && e.entry.postedBy !== p.postedBy.id ? ((await people()).find((x) => x.id === e.entry.postedBy)?.name ?? e.entry.postedBy) : p.postedBy.name, at: today };
    return { posting, replayed: e.replayed };
  } catch (e) {
    if (e instanceof LedgerError && e.code === "needs_second_person")
      throw new HttpError(409, `${e.message.split(", so ")[0]}, so someone in Finance other than the person who recorded it posts it to the books.`);
    throw asHttp(e);
  }
}
