import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { DEFAULT_CHART, DONOR_REVENUE_CODE, expenseCodeForKind } from "@/lib/ledger/chart";
import { donorReceipt, fromCents, LedgerRuleError, payment, periodOf, reversal, toCents, totals, type DonorReceiptInput, type EntryDraft, type PaymentInput } from "@/lib/ledger/rules";
import { orgProfile } from "@/server/org-settings-store";

/**
 * The grant ledger: writes journal entries and reads the books back. Every write runs in one
 * transaction with one audit_log row per entry (actions ledger_*). The rules are checked here first
 * so a person gets a plain answer; the database checks them again (drizzle/0027_ledger.sql) so no
 * route, script or direct SQL can get round them.
 *
 * Amounts leave here as decimal strings ("1234.50"), never floating point numbers.
 */

export type JournalEntry = typeof s.journalEntries.$inferSelect;
export type JournalLine = typeof s.journalLines.$inferSelect;
export type LedgerAccount = typeof s.ledgerAccounts.$inferSelect;
export type EntryWithLines = { entry: JournalEntry; lines: JournalLine[] };
export type PostResult = EntryWithLines & { replayed: boolean };

export type LedgerErrorCode = "invalid" | "locked" | "needs_second_person" | "not_found" | "not_draft" | "not_posted" | "already_reversed" | "refused";

/** A refusal in plain words. `code` lets a screen choose what to offer next (e.g. save as a draft). */
export class LedgerError extends Error {
  constructor(
    public code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

/* ---------------- Organization settings for the ledger ---------------- */

/** organization_state key holding { functionalCurrency, selfPostLimit } for the database's checks. */
export const LEDGER_STATE_KEY = "ledger";
/** DEFAULT, to confirm with the accountant: organizations keep their books in US dollars unless set otherwise. */
export const DEFAULT_FUNCTIONAL_CURRENCY = "USD";
/** The organization rule (lib/policy) for posting one's own payments. */
export const SELF_POST_RULE = "ledgerSelfPostMaxUsd";

export type LedgerSettings = { functionalCurrency: string; selfPostLimit: string };
type LedgerDoc = { functionalCurrency?: string; selfPostLimit?: string; rule?: string; syncedAt?: string };

async function ledgerDoc(exec: Exec, orgId: string): Promise<LedgerDoc | null> {
  const [row] = await exec
    .select({ data: s.organizationState.data })
    .from(s.organizationState)
    .where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, LEDGER_STATE_KEY)))
    .limit(1);
  return (row?.data as LedgerDoc | undefined) ?? null;
}

/**
 * The organization's functional currency and its limit for posting one's own payments. The limit is
 * the organization's rule in Settings (lib/policy ledgerSelfPostMaxUsd); not set means 0, so every
 * payment needs a second person.
 */
export async function ledgerSettings(orgId: string): Promise<LedgerSettings> {
  const [profile, doc] = await Promise.all([orgProfile(orgId), ledgerDoc(db, orgId)]);
  const v = profile.values[SELF_POST_RULE]?.value;
  const n = typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  return { functionalCurrency: doc?.functionalCurrency ?? DEFAULT_FUNCTIONAL_CURRENCY, selfPostLimit: fromCents(BigInt(Math.round(n * 100))) };
}

/** Keeps the document the database reads in step with the organization's rule. */
async function syncLedgerDoc(tx: Tx, orgId: string, settings: LedgerSettings) {
  const doc = await ledgerDoc(tx, orgId);
  if (doc?.functionalCurrency === settings.functionalCurrency && doc?.selfPostLimit === settings.selfPostLimit) return;
  const data: LedgerDoc = { ...doc, functionalCurrency: settings.functionalCurrency, selfPostLimit: settings.selfPostLimit, rule: SELF_POST_RULE, syncedAt: new Date().toISOString() };
  await tx
    .insert(s.organizationState)
    .values({ organizationId: orgId, key: LEDGER_STATE_KEY, data })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data, updatedAt: new Date() } });
}

/* ---------------- Chart of accounts ---------------- */

/** Gives an organization the default chart (lib/ledger/chart). Safe to run again: existing codes are kept as they are. */
export async function seedChart(orgId: string): Promise<{ created: number }> {
  const settings = await ledgerSettings(orgId);
  return db.transaction(async (tx) => {
    const created = await tx
      .insert(s.ledgerAccounts)
      .values(DEFAULT_CHART.map((a) => ({ organizationId: orgId, code: a.code, name: a.name, type: a.type, restricted: a.restricted, budgetKind: a.budgetKind ?? null })))
      .onConflictDoNothing()
      .returning({ id: s.ledgerAccounts.id });
    await syncLedgerDoc(tx, orgId, settings);
    return { created: created.length };
  });
}

export async function accounts(orgId: string): Promise<LedgerAccount[]> {
  return db.select().from(s.ledgerAccounts).where(eq(s.ledgerAccounts.organizationId, orgId)).orderBy(asc(s.ledgerAccounts.code));
}

export async function accountByCode(orgId: string, code: string): Promise<LedgerAccount | null> {
  const [a] = await db
    .select()
    .from(s.ledgerAccounts)
    .where(and(eq(s.ledgerAccounts.organizationId, orgId), eq(s.ledgerAccounts.code, code)))
    .limit(1);
  return a ?? null;
}

/** The expense account a budget line's spending goes to: the account marked for its kind, else the default chart's code. */
export async function expenseAccountFor(orgId: string, budgetKind: string): Promise<LedgerAccount | null> {
  const [marked] = await db
    .select()
    .from(s.ledgerAccounts)
    .where(and(eq(s.ledgerAccounts.organizationId, orgId), eq(s.ledgerAccounts.budgetKind, budgetKind)))
    .limit(1);
  return marked ?? accountByCode(orgId, expenseCodeForKind(budgetKind));
}

/* ---------------- Periods ---------------- */

export async function isLocked(orgId: string, period: string): Promise<boolean> {
  const p = periodOf(period);
  const [row] = await db
    .select({ id: s.fiscalPeriods.id })
    .from(s.fiscalPeriods)
    .where(and(eq(s.fiscalPeriods.organizationId, orgId), eq(s.fiscalPeriods.period, p), isNotNull(s.fiscalPeriods.lockedAt)))
    .limit(1);
  return !!row;
}

/**
 * Locks a month: nothing more posts into it, and it stays locked. Running it again on a locked month
 * changes nothing. `draftsLeft` counts drafts dated in the month, which can no longer be posted there.
 */
export async function lockPeriod(orgId: string, period: string, by: string): Promise<{ period: string; lockedAt: Date; lockedBy: string; already: boolean; draftsLeft: number }> {
  const p = periodOf(period);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(s.fiscalPeriods)
      .where(and(eq(s.fiscalPeriods.organizationId, orgId), eq(s.fiscalPeriods.period, p)))
      .for("update")
      .limit(1);
    if (existing?.lockedAt) return { period: p, lockedAt: existing.lockedAt, lockedBy: existing.lockedBy ?? "", already: true, draftsLeft: 0 };
    const now = new Date();
    const [row] = existing
      ? await tx.update(s.fiscalPeriods).set({ lockedAt: now, lockedBy: by }).where(eq(s.fiscalPeriods.id, existing.id)).returning()
      : await tx.insert(s.fiscalPeriods).values({ organizationId: orgId, period: p, lockedAt: now, lockedBy: by }).returning();
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(s.journalEntries)
      .where(and(eq(s.journalEntries.organizationId, orgId), eq(s.journalEntries.period, p), eq(s.journalEntries.status, "draft")));
    await tx.insert(s.auditLog).values({ projectId: null, entity: "fiscal_period", entityId: row.id, action: "ledger_period_locked", detail: { by, period: p, organizationId: orgId, draftsLeft: n } });
    return { period: p, lockedAt: row.lockedAt!, lockedBy: by, already: false, draftsLeft: n };
  });
}

/** The last day of a period's month, for "as of the end of the month" reads. */
export function periodEnd(period: string): string {
  const p = periodOf(period);
  const d = new Date(`${p}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/* ---------------- Posting ---------------- */

export type PostInput = {
  organizationId: string;
  draft: EntryDraft;
  /** What the entry is the record of: "expenditure", "payment", "donor_receipt", "reversal"... */
  sourceType: string;
  sourceId?: string | null;
  /** Person id of who recorded it. */
  recordedBy: string;
  /** Person id of who posts it; the recorder when not given. */
  postedBy?: string | null;
  /** Save as a draft for someone else to post (postDraft). */
  asDraft?: boolean;
  /** The same key always gives back the first entry written with it, so a retried request never posts twice. */
  idempotencyKey: string;
  /**
   * Writes the source document in the entry's own transaction (e.g. the expenditure row), so the
   * document and its entry are saved together or not at all. Not run when the key is replayed.
   */
  also?: (tx: Tx) => Promise<void>;
};

const SELF_POST_KINDS = new Set(["payment", "reversal"]);

function over(amount: string, limit: string) {
  return toCents(amount) > toCents(limit);
}

const money = (v: string, currency: string) => `${currency} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function selfPostRefusal(limit: string, currency: string) {
  return new LedgerError(
    "needs_second_person",
    `This payment is over ${money(limit, currency)}, so someone other than the person who recorded it posts it. Save it as a draft for them to post.`,
  );
}

/** The database's own words for a refusal, as a LedgerError. */
function fromDb(e: unknown): LedgerError {
  if (e instanceof LedgerError) return e;
  let cur: unknown = e;
  let msg = e instanceof Error ? e.message : String(e);
  for (let i = 0; i < 4 && cur; i++) {
    const m = (cur as { message?: string }).message;
    if (m && !m.startsWith("Failed query")) msg = m;
    cur = (cur as { cause?: unknown }).cause;
  }
  const code: LedgerErrorCode = /locked/i.test(msg) ? "locked" : /someone other than/i.test(msg) ? "needs_second_person" : "refused";
  return new LedgerError(code, msg);
}

function isIdempotencyClash(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; i < 4 && cur; i++, cur = (cur as { cause?: unknown }).cause) {
    const c = cur as { code?: string; constraint?: string; message?: string };
    if (c.code === "23505" && (c.constraint === "journal_entries_idempotency_key" || /journal_entries_idempotency_key/.test(c.message ?? ""))) return true;
  }
  return false;
}

async function byKey(key: string): Promise<EntryWithLines | null> {
  const [e] = await db.select().from(s.journalEntries).where(eq(s.journalEntries.idempotencyKey, key)).limit(1);
  return e ? { entry: e, lines: await linesOf(e.id) } : null;
}

async function linesOf(entryId: string, exec: Exec = db): Promise<JournalLine[]> {
  return exec.select().from(s.journalLines).where(eq(s.journalLines.entryId, entryId)).orderBy(asc(s.journalLines.lineNo));
}

/**
 * Writes an entry and its lines in one transaction, posted (or as a draft), with one audit row.
 * Replaying an idempotency key returns the first entry written with it and writes nothing.
 */
export async function post(input: PostInput): Promise<PostResult> {
  const key = input.idempotencyKey?.trim();
  if (!key || key.length > 200) throw new LedgerError("invalid", "Each entry needs an idempotency key (at most 200 characters).");
  const first = await byKey(key);
  if (first) {
    if (first.entry.organizationId !== input.organizationId) throw new LedgerError("invalid", "That idempotency key was already used by another organization.");
    return { ...first, replayed: true };
  }

  const { draft } = input;
  if (!input.recordedBy?.trim()) throw new LedgerError("invalid", "Say who recorded the entry.");
  if (!draft.memo) throw new LedgerError("invalid", "Say what the entry is for.");
  if (draft.lines.length < 2) throw new LedgerError("invalid", "An entry needs at least two lines.");
  const t = totals(draft.lines);
  if (!t.balanced) throw new LedgerError("invalid", `The entry does not balance: debits ${t.functionalDebit} and credits ${t.functionalCredit}.`);

  const used = [...new Set(draft.lines.map((l) => l.accountId))];
  const found = await db.select().from(s.ledgerAccounts).where(inArray(s.ledgerAccounts.id, used));
  for (const id of used) {
    const a = found.find((x) => x.id === id);
    if (!a || a.organizationId !== input.organizationId) throw new LedgerError("invalid", "One of the accounts is not in this organization's chart.");
    if (!a.active) throw new LedgerError("invalid", `Account ${a.code} ${a.name} is closed.`);
  }
  if (draft.reversesId) {
    const [o] = await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, draft.reversesId)).limit(1);
    if (!o || o.organizationId !== input.organizationId) throw new LedgerError("not_found", "The entry to reverse was not found.");
    if (o.status !== "posted") throw new LedgerError("not_posted", "Only a posted entry is reversed. A draft can simply be deleted.");
  }

  const settings = await ledgerSettings(input.organizationId);
  const posting = !input.asDraft;
  const poster = input.postedBy?.trim() || input.recordedBy;
  if (posting) {
    if (await isLocked(input.organizationId, draft.period))
      throw new LedgerError("locked", `The month of ${monthName(draft.period)} is locked: nothing more can be posted into it. Date the entry in an open month.`);
    if (SELF_POST_KINDS.has(draft.kind) && poster === input.recordedBy && over(t.functionalDebit, settings.selfPostLimit)) throw selfPostRefusal(settings.selfPostLimit, settings.functionalCurrency);
  }

  try {
    return await db.transaction(async (tx) => {
      await syncLedgerDoc(tx, input.organizationId, settings);
      if (input.also) await input.also(tx);
      const [entry] = await tx
        .insert(s.journalEntries)
        .values({
          organizationId: input.organizationId,
          projectId: draft.projectId,
          entryDate: draft.entryDate,
          period: draft.period,
          memo: draft.memo,
          kind: draft.kind,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          status: "draft",
          recordedBy: input.recordedBy,
          reversesId: draft.reversesId,
          idempotencyKey: key,
        })
        .returning();
      await tx.insert(s.journalLines).values(draft.lines.map((l, i) => ({ entryId: entry.id, lineNo: i + 1, ...l })));
      let final = entry;
      if (posting) [final] = await tx.update(s.journalEntries).set({ status: "posted", postedBy: poster }).where(eq(s.journalEntries.id, entry.id)).returning();
      await tx.insert(s.auditLog).values({
        projectId: draft.projectId,
        entity: "journal_entry",
        entityId: entry.id,
        action: !posting ? "ledger_drafted" : draft.kind === "reversal" ? "ledger_reversed" : "ledger_posted",
        detail: {
          by: input.recordedBy,
          ...(posting ? { postedBy: poster } : {}),
          kind: draft.kind,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          period: draft.period,
          amount: t.functionalDebit,
          currency: settings.functionalCurrency,
          ...(draft.reversesId ? { reverses: draft.reversesId } : {}),
        },
      });
      return { entry: final, lines: await linesOf(entry.id, tx), replayed: false };
    });
  } catch (e) {
    // Two requests with the same key at once: the second finds the first's entry.
    if (isIdempotencyClash(e)) {
      const again = await byKey(key);
      if (again) return { ...again, replayed: true };
    }
    throw fromDb(e);
  }
}

/** Posts a draft. The person posting is `by`; over the limit, it must be someone other than the recorder. */
export async function postDraft(entryId: string, by: string): Promise<PostResult> {
  const [e] = await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, entryId)).limit(1);
  if (!e) throw new LedgerError("not_found", "That entry was not found.");
  if (e.status !== "draft") throw new LedgerError("not_draft", "That entry is already posted.");
  const lines = await linesOf(e.id);
  const t = totals(lines);
  if (!t.balanced) throw new LedgerError("invalid", `The entry does not balance: debits ${t.functionalDebit} and credits ${t.functionalCredit}.`);
  const settings = await ledgerSettings(e.organizationId);
  if (await isLocked(e.organizationId, e.period)) throw new LedgerError("locked", `The month of ${monthName(e.period)} is locked: nothing more can be posted into it.`);
  if (SELF_POST_KINDS.has(e.kind) && by === e.recordedBy && over(t.functionalDebit, settings.selfPostLimit)) throw selfPostRefusal(settings.selfPostLimit, settings.functionalCurrency);
  try {
    return await db.transaction(async (tx) => {
      await syncLedgerDoc(tx, e.organizationId, settings);
      const [posted] = await tx
        .update(s.journalEntries)
        .set({ status: "posted", postedBy: by })
        .where(and(eq(s.journalEntries.id, e.id), eq(s.journalEntries.status, "draft")))
        .returning();
      if (!posted) throw new LedgerError("not_draft", "That entry is already posted.");
      await tx.insert(s.auditLog).values({
        projectId: e.projectId,
        entity: "journal_entry",
        entityId: e.id,
        action: e.kind === "reversal" ? "ledger_reversed" : "ledger_posted",
        detail: { by, recordedBy: e.recordedBy, kind: e.kind, sourceType: e.sourceType, sourceId: e.sourceId, period: e.period, amount: t.functionalDebit, currency: settings.functionalCurrency },
      });
      return { entry: posted, lines, replayed: false };
    });
  } catch (err) {
    throw fromDb(err);
  }
}

/** Deletes a draft (a posted entry is never deleted: reverse it). */
export async function deleteDraft(entryId: string, by: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [e] = await tx.select().from(s.journalEntries).where(eq(s.journalEntries.id, entryId)).for("update").limit(1);
      if (!e) throw new LedgerError("not_found", "That entry was not found.");
      if (e.status !== "draft") throw new LedgerError("not_draft", "A posted entry is never deleted. Reverse it instead.");
      await tx.delete(s.journalEntries).where(eq(s.journalEntries.id, e.id));
      await tx.insert(s.auditLog).values({ projectId: e.projectId, entity: "journal_entry", entityId: e.id, action: "ledger_draft_deleted", detail: { by, memo: e.memo, sourceType: e.sourceType, sourceId: e.sourceId } });
    });
  } catch (err) {
    throw fromDb(err);
  }
}

/* ---------------- The three actions ---------------- */

type Who = { organizationId: string; recordedBy: string; postedBy?: string | null; asDraft?: boolean; idempotencyKey: string; sourceType?: string; sourceId?: string | null; also?: PostInput["also"] };

function rule<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof LedgerRuleError) throw new LedgerError("invalid", e.message);
    throw e;
  }
}

/**
 * Record a payment: expense lines (with donor, project and budget line) against the bank or cash
 * account it was paid from. A payment from a bank account is in that bank's currency.
 */
export async function postPayment(who: Who, input: Omit<PaymentInput, "functionalCurrency">): Promise<PostResult> {
  const settings = await ledgerSettings(who.organizationId);
  const [from] = await db.select().from(s.ledgerAccounts).where(eq(s.ledgerAccounts.id, input.paidFrom)).limit(1);
  if (!from || from.organizationId !== who.organizationId || from.type !== "asset") throw new LedgerError("invalid", "Choose the bank or cash account the money was paid from.");
  const [bank] = await db.select().from(s.bankAccounts).where(eq(s.bankAccounts.ledgerAccountId, from.id)).limit(1);
  if (bank && bank.currency !== input.currency.trim().toUpperCase()) throw new LedgerError("invalid", `${bank.name} holds ${bank.currency}: record the payment in ${bank.currency}.`);
  const expenseIds = [...new Set(input.expenses.map((x) => x.accountId))];
  const exp = expenseIds.length ? await db.select().from(s.ledgerAccounts).where(inArray(s.ledgerAccounts.id, expenseIds)) : [];
  if (exp.length !== expenseIds.length || exp.some((a) => a.type !== "expense" || a.organizationId !== who.organizationId)) throw new LedgerError("invalid", "Each line of a payment goes to an expense account.");
  const draft = rule(() => payment({ ...input, functionalCurrency: settings.functionalCurrency }));
  return post({ ...who, draft, sourceType: who.sourceType ?? "payment", sourceId: who.sourceId ?? null });
}

/** Record donor money received, restricted by donor. The revenue account defaults to 4000 Donor grants. */
export async function postDonorReceipt(who: Who, input: Omit<DonorReceiptInput, "functionalCurrency" | "revenueAccountId"> & { revenueAccountId?: string }): Promise<PostResult> {
  const settings = await ledgerSettings(who.organizationId);
  const revenueAccountId = input.revenueAccountId ?? (await accountByCode(who.organizationId, DONOR_REVENUE_CODE))?.id;
  if (!revenueAccountId) throw new LedgerError("invalid", "The organization has no account for donor grants yet. Set up the chart of accounts first.");
  const [to] = await db.select().from(s.ledgerAccounts).where(eq(s.ledgerAccounts.id, input.depositedTo)).limit(1);
  if (!to || to.organizationId !== who.organizationId || to.type !== "asset") throw new LedgerError("invalid", "Choose the bank or cash account the money arrived in.");
  const [bank] = await db.select().from(s.bankAccounts).where(eq(s.bankAccounts.ledgerAccountId, to.id)).limit(1);
  if (bank && bank.currency !== input.currency.trim().toUpperCase()) throw new LedgerError("invalid", `${bank.name} holds ${bank.currency}: record the money in ${bank.currency}.`);
  const draft = rule(() => donorReceipt({ ...input, revenueAccountId, functionalCurrency: settings.functionalCurrency }));
  return post({ ...who, draft, sourceType: who.sourceType ?? "donor_receipt", sourceId: who.sourceId ?? null });
}

/** Reverse a posted entry: the same lines swapped, dated `date`, pointing to the original. An entry is reversed once. */
export async function reverse(who: Omit<Who, "sourceType" | "sourceId"> & { entryId: string; date: string; memo: string }): Promise<PostResult> {
  const original = await entry(who.entryId);
  if (!original || original.entry.organizationId !== who.organizationId) throw new LedgerError("not_found", "The entry to reverse was not found.");
  if (original.entry.status !== "posted") throw new LedgerError("not_posted", "Only a posted entry is reversed. A draft can simply be deleted.");
  const replay = await byKey(who.idempotencyKey.trim());
  if (!replay) {
    const [already] = await db.select({ id: s.journalEntries.id }).from(s.journalEntries).where(eq(s.journalEntries.reversesId, original.entry.id)).limit(1);
    if (already) throw new LedgerError("already_reversed", "That entry has already been reversed.");
  }
  const draft = rule(() => reversal({ id: original.entry.id, projectId: original.entry.projectId, lines: original.lines }, { date: who.date, memo: who.memo }));
  return post({ ...who, draft, sourceType: "reversal", sourceId: original.entry.id });
}

/* ---------------- Reads ---------------- */

export async function entry(id: string): Promise<EntryWithLines | null> {
  const [e] = await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, id)).limit(1);
  return e ? { entry: e, lines: await linesOf(e.id) } : null;
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
    )
    .orderBy(asc(s.journalLines.lineNo));
  return entries.map((e) => ({ entry: e, lines: lines.filter((l) => l.entryId === e.id) }));
}

/** Every entry written for a source document (e.g. sourceType "expenditure" and the expenditure's id), drafts included, oldest first. */
export async function entriesBySource(sourceType: string, sourceId: string): Promise<EntryWithLines[]> {
  const rows = await db
    .select()
    .from(s.journalEntries)
    .where(and(eq(s.journalEntries.sourceType, sourceType), eq(s.journalEntries.sourceId, sourceId)))
    .orderBy(asc(s.journalEntries.createdAt));
  return withLines(rows);
}

export type TrialBalanceRow = { accountId: string; code: string; name: string; type: string; restricted: boolean; debit: string; credit: string; balance: string };

/**
 * Posted totals per account in the functional currency, up to and including `asOf` (YYYY-MM-DD)
 * when given. `balance` is debit minus credit. `balanced`: total debits equal total credits.
 */
export async function trialBalance(orgId: string, asOf?: string): Promise<{ rows: TrialBalanceRow[]; totalDebit: string; totalCredit: string; balanced: boolean; currency: string }> {
  if (asOf) periodOf(asOf);
  const dateCut = asOf ? sql`AND e.entry_date <= ${asOf}::date` : sql``;
  const result = await db.execute(sql`
    SELECT a.id, a.code, a.name, a.type, a.restricted,
           coalesce(sum(x.functional_debit), 0)::text AS debit,
           coalesce(sum(x.functional_credit), 0)::text AS credit,
           (coalesce(sum(x.functional_debit), 0) - coalesce(sum(x.functional_credit), 0))::text AS balance
    FROM ledger_accounts a
    LEFT JOIN (
      SELECT l.account_id, l.functional_debit, l.functional_credit
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.status = 'posted' AND e.organization_id = ${orgId} ${dateCut}
    ) x ON x.account_id = a.id
    WHERE a.organization_id = ${orgId}
    GROUP BY a.id, a.code, a.name, a.type, a.restricted
    ORDER BY a.code`);
  const raw = rowsOf<{ id: string; code: string; name: string; type: string; restricted: boolean; debit: string; credit: string; balance: string }>(result);
  const rows = raw.map((r) => ({ accountId: r.id, code: r.code, name: r.name, type: r.type, restricted: r.restricted, debit: cents(r.debit), credit: cents(r.credit), balance: cents(r.balance) }));
  const d = rows.reduce((a, r) => a + toCents(r.debit), BigInt(0));
  const c = rows.reduce((a, r) => a + toCents(r.credit), BigInt(0));
  const { functionalCurrency } = await ledgerSettings(orgId);
  return { rows, totalDebit: fromCents(d), totalCredit: fromCents(c), balanced: d === c, currency: functionalCurrency };
}

export type BudgetActualRow = {
  /** Null: spending on the project's expense accounts not put on a budget line. */
  budgetLineId: string | null;
  code: string | null;
  description: string;
  kind: string | null;
  budget: string | null;
  budgetCurrency: string | null;
  /** Null: spending not marked with a donor. */
  donorId: string | null;
  donorName: string | null;
  /** Posted expense debits less credits, in the functional currency. */
  actual: string;
  /** Posted entries behind the figure (drill down with budgetLineEntries). */
  entries: number;
};

/**
 * Budget vs actual for a project, from the ledger: one row per budget line and donor with posted
 * spending, and one row with 0 for each budget line with none. A budget line's `budget` is in its
 * own currency; `actual` is in the functional currency (`currency`).
 */
export async function budgetVsActual(projectId: string): Promise<{ rows: BudgetActualRow[]; byDonor: { donorId: string | null; donorName: string | null; actual: string }[]; total: string; currency: string }> {
  const [project] = await db.select({ org: s.projects.organizationId }).from(s.projects).where(eq(s.projects.id, projectId)).limit(1);
  if (!project) throw new LedgerError("not_found", "That project was not found.");
  const lines = await db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, projectId)).orderBy(asc(s.budgetLines.sort), asc(s.budgetLines.code));
  const donors = await db.select({ id: s.donors.id, name: s.donors.name }).from(s.donors).where(eq(s.donors.projectId, projectId));
  const result = await db.execute(sql`
    SELECT l.budget_line_id, l.donor_id,
           (sum(l.functional_debit) - sum(l.functional_credit))::text AS actual,
           count(DISTINCT e.id)::int AS entries
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    JOIN ledger_accounts a ON a.id = l.account_id
    WHERE e.status = 'posted' AND a.type = 'expense'
      AND (l.project_id = ${projectId} OR l.budget_line_id IN (SELECT id FROM budget_lines WHERE project_id = ${projectId}))
    GROUP BY l.budget_line_id, l.donor_id`);
  const sums = rowsOf<{ budget_line_id: string | null; donor_id: string | null; actual: string; entries: number }>(result);
  const donorName = (id: string | null) => (id ? (donors.find((d) => d.id === id)?.name ?? null) : null);
  const rows: BudgetActualRow[] = [];
  for (const bl of lines) {
    const mine = sums.filter((x) => x.budget_line_id === bl.id);
    const base = { budgetLineId: bl.id, code: bl.code, description: bl.description, kind: bl.kind, budget: bl.amount, budgetCurrency: bl.currency };
    if (!mine.length) rows.push({ ...base, donorId: null, donorName: null, actual: "0.00", entries: 0 });
    for (const m of mine) rows.push({ ...base, donorId: m.donor_id, donorName: donorName(m.donor_id), actual: cents(m.actual), entries: Number(m.entries) });
  }
  for (const m of sums.filter((x) => !x.budget_line_id))
    rows.push({ budgetLineId: null, code: null, description: "Not on a budget line", kind: null, budget: null, budgetCurrency: null, donorId: m.donor_id, donorName: donorName(m.donor_id), actual: cents(m.actual), entries: Number(m.entries) });
  const byDonorMap = new Map<string | null, bigint>();
  for (const r of rows) byDonorMap.set(r.donorId, (byDonorMap.get(r.donorId) ?? BigInt(0)) + toCents(r.actual));
  const byDonor = [...byDonorMap].filter(([id, v]) => id || v !== BigInt(0)).map(([id, v]) => ({ donorId: id, donorName: donorName(id), actual: fromCents(v) }));
  const total = fromCents(rows.reduce((a, r) => a + toCents(r.actual), BigInt(0)));
  const { functionalCurrency } = await ledgerSettings(project.org);
  return { rows, byDonor, total, currency: functionalCurrency };
}

/**
 * The posted entries behind a budget vs actual figure, newest first. `donorId`: undefined for any
 * donor, null for spending not marked with a donor. `budgetLineId` null with `projectId`: the
 * project's spending not on a budget line.
 */
export async function budgetLineEntries(q: { budgetLineId: string | null; projectId?: string; donorId?: string | null }): Promise<EntryWithLines[]> {
  if (!q.budgetLineId && !q.projectId) throw new LedgerError("invalid", "Name the budget line or the project.");
  const lineCond = q.budgetLineId ? sql`l.budget_line_id = ${q.budgetLineId}` : sql`l.budget_line_id IS NULL AND l.project_id = ${q.projectId!}`;
  const donorCond = q.donorId === undefined ? sql`` : q.donorId === null ? sql`AND l.donor_id IS NULL` : sql`AND l.donor_id = ${q.donorId}`;
  const ids = rowsOf<{ entry_id: string }>(
    await db.execute(sql`
      SELECT DISTINCT l.entry_id FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      JOIN ledger_accounts a ON a.id = l.account_id
      WHERE e.status = 'posted' AND a.type = 'expense' AND ${lineCond} ${donorCond}`),
  ).map((r) => r.entry_id);
  if (!ids.length) return [];
  const entries = await db.select().from(s.journalEntries).where(inArray(s.journalEntries.id, ids)).orderBy(desc(s.journalEntries.entryDate), desc(s.journalEntries.createdAt));
  return withLines(entries);
}

/**
 * A ledger account's posted balance (debit minus credit) up to and including `asOf`: in each line
 * currency, and in the functional currency.
 */
export async function accountBalance(ledgerAccountId: string, asOf: string): Promise<{ byCurrency: Record<string, string>; functional: string }> {
  periodOf(asOf);
  const raw = rowsOf<{ currency: string; amount: string; functional: string }>(
    await db.execute(sql`
      SELECT l.currency, (sum(l.debit) - sum(l.credit))::text AS amount, (sum(l.functional_debit) - sum(l.functional_credit))::text AS functional
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.status = 'posted' AND l.account_id = ${ledgerAccountId} AND e.entry_date <= ${asOf}::date
      GROUP BY l.currency`),
  );
  const byCurrency = Object.fromEntries(raw.map((r) => [r.currency, cents(r.amount)]));
  const functional = fromCents(raw.reduce((a, r) => a + toCents(cents(r.functional)), BigInt(0)));
  return { byCurrency, functional };
}

/** A bank account's book balance in its own currency at the end of a period (for reconciliation). */
export async function bankBookBalance(bankAccountId: string, period: string): Promise<{ currency: string; balance: string; functional: string; asOf: string }> {
  const [bank] = await db.select().from(s.bankAccounts).where(eq(s.bankAccounts.id, bankAccountId)).limit(1);
  if (!bank) throw new LedgerError("not_found", "That bank account was not found.");
  const asOf = periodEnd(period);
  const b = await accountBalance(bank.ledgerAccountId, asOf);
  return { currency: bank.currency, balance: b.byCurrency[bank.currency] ?? "0.00", functional: b.functional, asOf };
}

/* ---------------- Helpers ---------------- */

const monthName = (period: string) => new Date(`${period}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** A numeric from SQL ("12.5", "-3", "0") as "12.50". */
function cents(v: string | number | null | undefined): string {
  const t = String(v ?? "0");
  const [i, f = ""] = t.split(".");
  return fromCents(toCents(`${i}.${f.padEnd(2, "0").slice(0, 2)}`));
}

/** Rows from db.execute on either driver (postgres-js returns an array; PGlite returns { rows }). */
function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}
