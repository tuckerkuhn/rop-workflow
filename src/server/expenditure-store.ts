import { markBooksKept } from "@/server/ledger-spent";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { DONOR_FUNDING_KEY, fundingFor, roleOf, type DonorFundingBook } from "@/lib/donor-funding";
import { convertCents, fromCents, periodOf, toCents } from "@/lib/ledger/rules";
import { accountByCode, entry as entryById, expenseAccountFor, isLocked, ledgerSettings, LedgerError, postDraft, postPayment, reverse, seedChart, type PostResult } from "@/server/ledger";
import { ledgerRate } from "@/lib/fx";

/**
 * Spending in the `expenditures` table goes through the grant ledger: each expenditure is the source
 * document of one posted payment (sourceType "expenditure", idempotency key `expenditure:<id>`), its
 * expense account the one for the budget line's kind.
 *
 * The expenditure row, its entry and the `budget_lines.spent` it adds to are written in ONE
 * transaction (server/ledger `also`): when the ledger refuses (a locked month, a payment over the
 * limit posted by the person who recorded it, an unknown account), the expenditure is not saved
 * either, with the ledger's own words. Nothing is queued silently.
 *
 * Finance's workbook import writes `budget_lines.spent` directly. A filed bill and a paid purchase
 * reach this table when Finance posts them (server/books-posting): each is the `source` of its
 * expenditure, so the same bill or purchase never posts twice. Whatever writes an expenditure calls
 * `recordExpenditure`; existing rows are posted with `npm run ledger:post-expenditures`.
 *
 * A wrong posted expenditure is put right with `reverseExpenditure`: a reversing entry, a row here
 * that takes the amount off again and the same taken off `budget_lines.spent`. Nothing is deleted.
 */

export const EXPENDITURE_SOURCE = "expenditure";
export const expenditureKey = (id: string) => `expenditure:${id}`;

/**
 * The id of the expenditure a source document makes, always the same for the same key. The
 * entry's idempotency key is made from it (`expenditure:<id>`), so posting the same bill or
 * purchase again gives back the first entry and writes nothing.
 */
export function expenditureIdFor(key: string): string {
  const h = createHash("sha256").update(`expenditure-source:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** What an expenditure is the record of, when it is not typed in: a bill or a purchase. */
export type ExpenditureSource = {
  /** "bill" | "purchase": kept on the entry as its source type. */
  type: string;
  /** Kept on the entry as its source id: where the bill or purchase is found ("A-2027:BL-002"). */
  id: string;
  /** One key per posting of that document ("bill:<project>:BL-002:1"). */
  key: string;
};

/**
 * DEFAULT, to confirm with the accountant: the old rows do not say which bank or cash account paid,
 * so they are posted as paid from account 1010 (the main bank account). See "Questions for the
 * accountant" in docs/deep-dive/09-finance.md.
 */
export const DEFAULT_PAID_FROM_CODE = "1010";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

/** The donor whose grant pays for a budget line, when exactly one does (the donor funding settings); else null. */
export async function donorForLine(projectId: string, code: string, exec: Exec = db): Promise<string | null> {
  const donors = await exec.select({ id: s.donors.id }).from(s.donors).where(eq(s.donors.projectId, projectId));
  if (!donors.length) return null;
  const [row] = await exec
    .select({ data: s.projectState.data })
    .from(s.projectState)
    .where(and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, DONOR_FUNDING_KEY)))
    .limit(1);
  const book = (row?.data as DonorFundingBook | undefined) ?? {};
  const paying = donors.filter((d) => {
    const f = fundingFor(book, d.id, donors.length);
    return f && roleOf(f, code) === "funded";
  });
  return paying.length === 1 ? paying[0].id : null;
}

export type ExpenditureInput = {
  budgetLineId: string;
  description: string;
  amount: string | number;
  /** Default USD, as the table's default. */
  currency?: string;
  /** One unit of `currency` in the functional currency. Needed when the currency is not the functional one. */
  fxRate?: string | number;
  /** YYYY-MM-DD */
  spentOn: string;
  evidenceId?: string | null;
  /** Person id of who recorded it. */
  recordedBy: string;
  /** Person id of who posts it; the recorder when not given (over the organization's limit that is refused). */
  postedBy?: string | null;
  /** The bank or cash account it was paid from, by chart code. Default 1010 (DEFAULT_PAID_FROM_CODE). */
  paidFromCode?: string;
  /** The donor it is charged to. Default: the one donor whose grant pays for the line, if exactly one does. */
  donorId?: string | null;
  /** The bill or purchase it comes from. Posting the same source key again writes nothing new. */
  source?: ExpenditureSource;
  /** The entry's memo when it should say more than the description (who was paid). */
  memo?: string;
};

async function lineAndOrg(budgetLineId: string) {
  const [row] = await db
    .select({ line: s.budgetLines, org: s.projects.organizationId, code: s.projects.code })
    .from(s.budgetLines)
    .innerJoin(s.projects, eq(s.projects.id, s.budgetLines.projectId))
    .where(eq(s.budgetLines.id, budgetLineId))
    .limit(1);
  if (!row) throw new LedgerError("not_found", "That budget line was not found.");
  return row;
}

/** The organization's chart, made the first time it is needed (server/ledger seedChart is safe to run again). */
async function accountsFor(orgId: string, kind: string, paidFromCode: string) {
  let paidFrom = await accountByCode(orgId, paidFromCode);
  if (!paidFrom) {
    await seedChart(orgId);
    paidFrom = await accountByCode(orgId, paidFromCode);
  }
  const expense = await expenseAccountFor(orgId, kind);
  if (!paidFrom || paidFrom.type !== "asset") throw new LedgerError("invalid", `Account ${paidFromCode} is not a bank or cash account in this organization's chart.`);
  if (!expense) throw new LedgerError("invalid", "The organization's chart has no expense account for this kind of budget line.");
  return { paidFrom, expense };
}

/**
 * What the expenditure adds to `budget_lines.spent` (kept written until every page reads the ledger),
 * in the budget line's currency: the amount when the currencies match, the functional amount when
 * the budget is in the functional currency, else nothing (the ledger has it; the old column cannot).
 */
function addToSpent(amount: string, currency: string, rate: string, lineCurrency: string, functional: string): string | null {
  if (currency === lineCurrency) return fromCents(toCents(amount));
  if (lineCurrency === functional) return fromCents(convertCents(toCents(amount), rate));
  return null;
}

/**
 * Records an expenditure and posts it to the ledger, both or neither. Throws LedgerError when the
 * ledger refuses (code "locked", "needs_second_person", "invalid"...).
 */
export async function recordExpenditure(input: ExpenditureInput): Promise<{ expenditureId: string; entry: PostResult }> {
  const { line, org } = await lineAndOrg(input.budgetLineId);
  const description = input.description?.trim();
  if (!description) throw new LedgerError("invalid", "Say what the money was spent on.");
  periodOf(input.spentOn);
  const amount = fromCents(toCents(input.amount));
  if (toCents(amount) <= BigInt(0)) throw new LedgerError("invalid", "The amount must be more than zero.");
  const currency = (input.currency ?? "USD").trim().toUpperCase();
  const settings = await ledgerSettings(org);
  // MF-11: a payment in afghanis or quetzales takes the month's rate unless one is given.
  const monthRate = currency !== settings.functionalCurrency && input.fxRate === undefined && settings.functionalCurrency === "USD" ? ledgerRate(currency, input.spentOn) : null;
  if (currency !== settings.functionalCurrency && input.fxRate === undefined && !monthRate) throw new LedgerError("invalid", `Give the rate from ${currency} to ${settings.functionalCurrency} on the day: finance has entered no ${currency} rate for the month.`);
  const rate = currency === settings.functionalCurrency ? "1" : String(input.fxRate ?? monthRate);
  const { paidFrom, expense } = await accountsFor(org, line.kind, input.paidFromCode ?? DEFAULT_PAID_FROM_CODE);
  const donorId = input.donorId === undefined ? await donorForLine(line.projectId, line.code) : input.donorId;
  const id = input.source ? expenditureIdFor(input.source.key) : randomUUID();
  let added: string | null = null;
  try {
    added = addToSpent(amount, currency, rate, line.currency, settings.functionalCurrency);
  } catch {
    added = null;
  }
  const entry = await postPayment(
    {
      organizationId: org,
      recordedBy: input.recordedBy,
      postedBy: input.postedBy ?? null,
      idempotencyKey: expenditureKey(id),
      sourceType: input.source?.type ?? EXPENDITURE_SOURCE,
      sourceId: input.source?.id ?? id,
      also: async (tx) => {
        await tx.insert(s.expenditures).values({ id, budgetLineId: line.id, description, amount, currency, spentOn: input.spentOn, evidenceId: input.evidenceId ?? null });
        if (added !== null)
          await tx
            .update(s.budgetLines)
            .set({ spent: sql`coalesce(${s.budgetLines.spent}, 0) + ${added}::numeric`, updatedAt: new Date() })
            .where(eq(s.budgetLines.id, line.id));
      },
    },
    { date: input.spentOn, memo: input.memo?.trim() || description, paidFrom: paidFrom.id, currency, fxRate: rate, projectId: line.projectId, expenses: [{ accountId: expense.id, amount, donorId, projectId: line.projectId, budgetLineId: line.id, ...(input.memo?.trim() ? { memo: description } : {}) }] },
  );
  return { expenditureId: id, entry };
}

/* ---------------- Putting a wrong expenditure right ---------------- */

const idOfKey = (key: string) => (key.startsWith("expenditure:") ? key.slice("expenditure:".length) : null);

/** The expenditure a posted entry is the record of, or null when the entry was not made from one. */
export async function expenditureOfEntry(entryId: string, exec: Exec = db) {
  const [e] = await exec.select({ key: s.journalEntries.idempotencyKey, kind: s.journalEntries.kind }).from(s.journalEntries).where(eq(s.journalEntries.id, entryId)).limit(1);
  const id = e && e.kind === "payment" ? idOfKey(e.key) : null;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await exec.select().from(s.expenditures).where(eq(s.expenditures.id, id)).limit(1);
  return row ?? null;
}

/**
 * What a posted reversal of an expenditure's entry also writes, in the reversal's own transaction:
 * a row in `expenditures` that takes the amount off again (so the table still adds up to what was
 * spent) and the same taken off `budget_lines.spent`. The row's id is made from the first one's, so
 * it is written once.
 */
function undoing(original: typeof s.expenditures.$inferSelect, entryLine: { fxRate: string } | undefined, functional: string, memo: string, on: string) {
  const backId = expenditureIdFor(`reversed:${original.id}`);
  return {
    backId,
    also: async (tx: Tx) => {
      const [line] = await tx.select().from(s.budgetLines).where(eq(s.budgetLines.id, original.budgetLineId)).limit(1);
      const amount = fromCents(toCents(Number(original.amount).toFixed(2)));
      await tx.insert(s.expenditures).values({ id: backId, budgetLineId: original.budgetLineId, description: memo, amount: `-${amount}`, currency: original.currency, spentOn: on, evidenceId: null }).onConflictDoNothing();
      let off: string | null = null;
      try {
        off = line ? addToSpent(amount, original.currency, entryLine?.fxRate ?? "1", line.currency, functional) : null;
      } catch {
        off = null;
      }
      if (off !== null)
        await tx
          .update(s.budgetLines)
          .set({ spent: sql`coalesce(${s.budgetLines.spent}, 0) - ${off}::numeric`, updatedAt: new Date() })
          .where(eq(s.budgetLines.id, original.budgetLineId));
    },
  };
}

/**
 * Reverses the entry of an expenditure: the reversing entry, and with it what `undoing` writes.
 * Over the organization's limit the person who asks cannot post it (LedgerError
 * "needs_second_person"): call again with `asDraft`, and the second person posts the draft with
 * `postExpenditureDraft`, which writes the rest then. Returns null when the entry is not an
 * expenditure's: the caller reverses it as any other entry.
 */
export async function reverseExpenditure(who: { organizationId: string; entryId: string; by: string; date: string; memo: string; asDraft?: boolean }): Promise<PostResult | null> {
  const original = await expenditureOfEntry(who.entryId);
  if (!original) return null;
  const first = await entryById(who.entryId);
  const settings = await ledgerSettings(who.organizationId);
  const undo = undoing(original, first?.lines.find((l) => l.budgetLineId === original.budgetLineId), settings.functionalCurrency, who.memo, who.date);
  return reverse({ organizationId: who.organizationId, recordedBy: who.by, asDraft: who.asDraft, idempotencyKey: expenditureKey(undo.backId), entryId: who.entryId, date: who.date, memo: who.memo, also: who.asDraft ? undefined : undo.also });
}

/**
 * Posts a draft. When the draft reverses an expenditure's entry, what `undoing` writes goes in the
 * same transaction, so a reversal that waited for a second person leaves the same records as one
 * posted at once.
 */
export async function postExpenditureDraft(entryId: string, by: string): Promise<PostResult> {
  const draft = await entryById(entryId);
  const original = draft?.entry.kind === "reversal" && draft.entry.reversesId ? await expenditureOfEntry(draft.entry.reversesId) : null;
  if (!draft || !original) return postDraft(entryId, by);
  const first = await entryById(draft.entry.reversesId!);
  const settings = await ledgerSettings(draft.entry.organizationId);
  const undo = undoing(original, first?.lines.find((l) => l.budgetLineId === original.budgetLineId), settings.functionalCurrency, draft.entry.memo, draft.entry.entryDate);
  return postDraft(entryId, by, undo.also);
}

/* ---------------- Posting the existing rows (npm run ledger:post-expenditures) ---------------- */

export type PlannedExpenditure = {
  id: string;
  project: string;
  budgetLine: string;
  spentOn: string;
  amount: string;
  currency: string;
  /** "post": would post (dry run) or posted (apply); "posted": already in the ledger; "skip": why in `why`. */
  status: "post" | "posted" | "skip";
  why?: string;
  entryId?: string;
};

export type ProjectTotals = {
  project: string;
  currency: string;
  /** Sum of budget_lines.spent (in the lines' currencies, as stored). */
  budgetLinesSpent: string;
  /** Sum of the project's expenditures, by currency. */
  expenditures: Record<string, string>;
  /** Posted spending in the ledger on the project's budget lines, functional currency. */
  ledgerBefore: string;
  /** After: what the run posted (apply) or would post (dry run) added to ledgerBefore. */
  ledgerAfter: string;
};

export type PostingRun = { apply: boolean; paidFrom: string; rows: PlannedExpenditure[]; projects: ProjectTotals[] };

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}

async function ledgerTotal(projectId: string): Promise<bigint> {
  const [r] = rowsOf<{ t: string }>(
    await db.execute(sql`
      SELECT coalesce(sum(l.functional_debit) - sum(l.functional_credit), 0)::text AS t
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN ledger_accounts a ON a.id = l.account_id
      JOIN budget_lines bl ON bl.id = l.budget_line_id
      WHERE e.status = 'posted' AND a.type = 'expense' AND bl.project_id = ${projectId}`),
  );
  return toCents(Number(r?.t ?? 0).toFixed(2));
}

/**
 * Posts every expenditure not yet in the ledger, or (apply false) says what it would post. Rows in
 * a currency other than the organization's own are skipped (the old rows carry no rate), and so are
 * rows dated in a locked month. Safe to run again: the idempotency key `expenditure:<id>` posts each
 * row once. `by`: the person posting (recorded by "ledger-post-cli"), required to apply.
 */
export async function postExistingExpenditures(opts: { apply: boolean; by?: string; project?: string; paidFromCode?: string }): Promise<PostingRun> {
  if (opts.apply && !opts.by?.trim()) throw new Error("Say who posts the entries: --by <person id>.");
  const paidFromCode = opts.paidFromCode ?? DEFAULT_PAID_FROM_CODE;
  const projects = await db.select().from(s.projects).where(opts.project ? eq(s.projects.code, opts.project) : undefined).orderBy(asc(s.projects.code));
  if (opts.project && !projects.length) throw new Error(`No project ${opts.project}.`);
  const out: PostingRun = { apply: opts.apply, paidFrom: paidFromCode, rows: [], projects: [] };
  for (const p of projects) {
    const lines = await db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, p.id));
    const exps = lines.length ? await db.select().from(s.expenditures).where(inArray(s.expenditures.budgetLineId, lines.map((l) => l.id))).orderBy(asc(s.expenditures.spentOn), asc(s.expenditures.createdAt)) : [];
    const before = await ledgerTotal(p.id);
    const settings = await ledgerSettings(p.organizationId);
    let added = BigInt(0);
    const keys = exps.length ? (await db.select({ key: s.journalEntries.idempotencyKey, id: s.journalEntries.id }).from(s.journalEntries).where(inArray(s.journalEntries.idempotencyKey, exps.map((e) => expenditureKey(e.id))))) : [];
    for (const e of exps) {
      const line = lines.find((l) => l.id === e.budgetLineId)!;
      const base = { id: e.id, project: p.code ?? p.id, budgetLine: line.code, spentOn: e.spentOn, amount: fromCents(toCents(Number(e.amount).toFixed(2))), currency: e.currency };
      const done = keys.find((k) => k.key === expenditureKey(e.id));
      if (done) {
        out.rows.push({ ...base, status: "posted", why: "already in the ledger", entryId: done.id });
        continue;
      }
      if (e.currency !== settings.functionalCurrency) {
        out.rows.push({ ...base, status: "skip", why: `in ${e.currency}: the row has no rate to ${settings.functionalCurrency} and no ${e.currency} bank account is assumed` });
        continue;
      }
      if (await isLocked(p.organizationId, e.spentOn)) {
        out.rows.push({ ...base, status: "skip", why: `${e.spentOn.slice(0, 7)} is locked: nothing more posts into it` });
        continue;
      }
      if (toCents(base.amount) <= BigInt(0)) {
        out.rows.push({ ...base, status: "skip", why: "amount is not more than zero" });
        continue;
      }
      if (!opts.apply) {
        out.rows.push({ ...base, status: "post" });
        added += toCents(base.amount);
        continue;
      }
      try {
        const { paidFrom, expense } = await accountsFor(p.organizationId, line.kind, paidFromCode);
        const r = await postPayment(
          { organizationId: p.organizationId, recordedBy: "ledger-post-cli", postedBy: opts.by!.trim(), idempotencyKey: expenditureKey(e.id), sourceType: EXPENDITURE_SOURCE, sourceId: e.id },
          { date: e.spentOn, memo: e.description, paidFrom: paidFrom.id, currency: e.currency, fxRate: "1", projectId: p.id, expenses: [{ accountId: expense.id, amount: base.amount, donorId: await donorForLine(p.id, line.code), projectId: p.id, budgetLineId: line.id }] },
        );
        out.rows.push({ ...base, status: r.replayed ? "posted" : "post", entryId: r.entry.id });
      } catch (err) {
        out.rows.push({ ...base, status: "skip", why: err instanceof Error ? err.message : String(err) });
      }
    }
    // Posted for real: from now on this project's pages read its spending from the books (ledger-spent BOOKS_KEY).
    if (opts.apply && out.rows.some((r) => r.project === (p.code ?? p.id) && (r.status === "post" || r.status === "posted"))) await markBooksKept(p.id, "ledger:post-expenditures --apply");
    const after = opts.apply ? await ledgerTotal(p.id) : before + added;
    if (!exps.length && !lines.some((l) => l.spent !== null) && before === BigInt(0)) continue;
    const byCurrency: Record<string, bigint> = {};
    for (const e of exps) byCurrency[e.currency] = (byCurrency[e.currency] ?? BigInt(0)) + toCents(Number(e.amount).toFixed(2));
    out.projects.push({
      project: p.code ?? p.id,
      currency: settings.functionalCurrency,
      budgetLinesSpent: fromCents(lines.reduce((t, l) => t + (l.spent === null ? BigInt(0) : toCents(Number(l.spent).toFixed(2))), BigInt(0))),
      expenditures: Object.fromEntries(Object.entries(byCurrency).map(([c, v]) => [c, fromCents(v)])),
      ledgerBefore: fromCents(before),
      ledgerAfter: fromCents(after),
    });
  }
  return out;
}
