import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq, sql } from "drizzle-orm";
import { db, ready, schema as s } from "@/server/__tests__/test-db";
import { toCents } from "@/lib/ledger/rules";
import {
  accountBalance,
  accountByCode,
  bankBookBalance,
  budgetLineEntries,
  budgetVsActual,
  entriesBySource,
  expenseAccountFor,
  isLocked,
  LedgerError,
  lockPeriod,
  post,
  postDonorReceipt,
  postDraft,
  postPayment,
  reverse,
  seedChart,
  trialBalance,
} from "@/server/ledger";

/** Every message down an error's cause chain: drizzle wraps the database's own words. */
async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const out: string[] = [];
    for (let cur: unknown = e, i = 0; cur && i < 5; cur = (cur as { cause?: unknown }).cause, i++) out.push(String((cur as { message?: string }).message ?? cur));
    return out.join(" | ");
  }
  throw new Error("expected a refusal, but it went through");
}

let org: string;
let project: string;
let donor: string;
let lineProgram: string;
let lineOps: string;
let bank: string;
let afnBank: string;
let bankAccount: string;
let program: string;
let ops: string;
let n = 0;
const key = () => `test-${++n}`;
const who = (extra: Partial<{ recordedBy: string; postedBy: string; asDraft: boolean; idempotencyKey: string }> = {}) => ({ organizationId: org, recordedBy: "amina", idempotencyKey: key(), ...extra });

beforeAll(async () => {
  await ready;
  [{ id: org }] = await db.insert(s.organizations).values({ name: "Ledger Test Org" }).returning();
  [{ id: project }] = await db.insert(s.projects).values({ organizationId: org, code: "LED-1", name: "Ledger test", country: "AF", kind: "sandbox" }).returning();
  [{ id: donor }] = await db.insert(s.donors).values({ organizationId: org, projectId: project, name: "Sandbox Donor" }).returning();
  [{ id: lineProgram }, { id: lineOps }] = await db
    .insert(s.budgetLines)
    .values([
      { projectId: project, code: "PRG-1", description: "Seed and fertilizer", amount: "10000.00", currency: "USD", kind: "program", sort: 1 },
      { projectId: project, code: "OPS-1", description: "Office rent", amount: "2400.00", currency: "USD", kind: "operations", sort: 2 },
    ])
    .returning();
  const first = await seedChart(org);
  expect(first.created).toBeGreaterThanOrEqual(22);
  bank = (await accountByCode(org, "1010"))!.id;
  afnBank = (await accountByCode(org, "1020"))!.id;
  program = (await expenseAccountFor(org, "program"))!.id;
  ops = (await expenseAccountFor(org, "operations"))!.id;
  [{ id: bankAccount }] = await db.insert(s.bankAccounts).values({ organizationId: org, ledgerAccountId: bank, name: "Main bank", currency: "USD" }).returning();
  await db.insert(s.bankAccounts).values({ organizationId: org, ledgerAccountId: afnBank, name: "Field bank", currency: "AFN" });
}, 120_000);

const pay = (amount: string, date = "2027-01-10", extra: Parameters<typeof who>[0] = {}) =>
  postPayment(who(extra), { date, memo: "Seed for the January planting", paidFrom: bank, currency: "USD", fxRate: "1", expenses: [{ accountId: program, amount, donorId: donor, projectId: project, budgetLineId: lineProgram }] });

describe("the chart of accounts", () => {
  it("seeds about 25 accounts once, and running it again adds nothing", async () => {
    expect((await seedChart(org)).created).toBe(0);
    expect((await accountByCode(org, "6000"))?.budgetKind).toBe("personnel");
  });
});

describe("recording a payment", { timeout: 60_000 }, () => {
  it("writes a balanced posted entry with the budget line and donor on the expense line, and one audit row", async () => {
    const r = await pay("250.00");
    expect(r.replayed).toBe(false);
    expect(r.entry.status).toBe("posted");
    expect(r.entry.postedBy).toBe("amina");
    expect(r.entry.postedAt).toBeInstanceOf(Date);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ accountId: program, debit: "250.00", functionalDebit: "250.00", budgetLineId: lineProgram, donorId: donor, projectId: project });
    expect(r.lines[1]).toMatchObject({ accountId: bank, credit: "250.00", functionalCredit: "250.00" });
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, r.entry.id));
    expect(audit.map((a) => a.action)).toEqual(["ledger_posted"]);
    expect(audit[0].detail).toMatchObject({ by: "amina", amount: "250.00", currency: "USD" });
  });

  it("finds the entries written for a source document", async () => {
    const exp = "6f1d2c3b-0000-4000-8000-000000000001";
    const r = await postPayment({ ...who(), sourceType: "expenditure", sourceId: exp }, { date: "2027-02-02", memo: "Office rent", paidFrom: bank, currency: "USD", fxRate: "1", expenses: [{ accountId: ops, amount: "10.00", projectId: project }] });
    const found = await entriesBySource("expenditure", exp);
    expect(found.map((e) => e.entry.id)).toEqual([r.entry.id]);
    expect(found[0].lines).toHaveLength(2);
  });

  it("an idempotency key replayed returns the first entry and writes nothing more", async () => {
    const k = key();
    const a = await pay("40.00", "2027-01-11", { idempotencyKey: k });
    const b = await pay("99.00", "2027-01-12", { idempotencyKey: k });
    expect(b.replayed).toBe(true);
    expect(b.entry.id).toBe(a.entry.id);
    expect(b.lines[0].debit).toBe("40.00");
    const rows = await db.select().from(s.journalEntries).where(eq(s.journalEntries.idempotencyKey, k));
    expect(rows).toHaveLength(1);
  });

  it("budget vs actual by donor and budget line comes from the ledger, with the entries behind it", async () => {
    const bva = await budgetVsActual(project);
    const prg = bva.rows.find((r) => r.budgetLineId === lineProgram)!;
    expect(prg).toMatchObject({ donorId: donor, donorName: "Sandbox Donor", budget: "10000.00", actual: "290.00", entries: 2 });
    expect(bva.rows.find((r) => r.budgetLineId === lineOps)).toMatchObject({ actual: "0.00", entries: 0 });
    // The office rent above was put on no budget line and no donor: it shows on its own row, not hidden.
    expect(bva.rows.find((r) => r.budgetLineId === null)).toMatchObject({ description: "Not on a budget line", actual: "10.00", donorId: null });
    expect(bva.byDonor).toEqual([
      { donorId: donor, donorName: "Sandbox Donor", actual: "290.00" },
      { donorId: null, donorName: null, actual: "10.00" },
    ]);
    expect(bva.total).toBe("300.00");
    const drill = await budgetLineEntries({ budgetLineId: lineProgram, donorId: donor });
    expect(drill).toHaveLength(2);
    expect(drill.every((e) => e.lines.some((l) => l.budgetLineId === lineProgram))).toBe(true);
  });

  it("a payment in another currency balances after rounding to the cent", async () => {
    const r = await postPayment(who(), {
      date: "2027-01-15",
      memo: "Field supplies",
      paidFrom: afnBank,
      currency: "AFN",
      fxRate: "0.01428571",
      expenses: [
        { accountId: program, amount: "3333.33", budgetLineId: lineProgram, projectId: project },
        { accountId: program, amount: "3333.33", budgetLineId: lineProgram, projectId: project },
        { accountId: ops, amount: "3333.34", budgetLineId: lineOps, projectId: project },
      ],
    });
    const dr = r.lines.reduce((a, l) => a + toCents(l.functionalDebit), BigInt(0));
    const cr = r.lines.reduce((a, l) => a + toCents(l.functionalCredit), BigInt(0));
    expect(dr).toBe(cr);
    expect(cr).toBe(BigInt(14286));
    expect(r.lines.every((l) => l.fxRate === "0.01428571")).toBe(true);
    expect((await trialBalance(org)).balanced).toBe(true);
  });

  it("refuses a payment in a currency the bank does not hold", async () => {
    const msg = await failure(postPayment(who(), { date: "2027-01-15", memo: "x", paidFrom: bank, currency: "AFN", fxRate: "0.0142", expenses: [{ accountId: program, amount: "10" }] }));
    expect(msg).toMatch(/holds USD/);
  });
});

describe("donor money received", { timeout: 60_000 }, () => {
  it("debits the bank and credits restricted donor grants, marked with the donor", async () => {
    const r = await postDonorReceipt(who(), { date: "2027-01-03", memo: "First tranche", depositedTo: bank, donorId: donor, projectId: project, currency: "USD", fxRate: "1", amount: "50000" });
    const rev = await accountByCode(org, "4000");
    expect(rev?.restricted).toBe(true);
    expect(r.lines[1]).toMatchObject({ accountId: rev!.id, credit: "50000.00", donorId: donor });
    // Receipts are not payments: one person records and posts them at any amount (question 6 for the accountant).
    expect(r.entry.postedBy).toBe("amina");
  });
});

describe("a posted entry never changes", { timeout: 60_000 }, () => {
  it("refuses a direct SQL update of a posted line or entry, a delete and a truncate", async () => {
    const r = await pay("12.00", "2027-01-20");
    const line = r.lines[0].id;
    expect(await failure(db.execute(sql`UPDATE journal_lines SET debit = 13, functional_debit = 13 WHERE id = ${line}`))).toMatch(/posted entry cannot be changed/);
    expect(await failure(db.execute(sql`UPDATE journal_entries SET memo = 'changed' WHERE id = ${r.entry.id}`))).toMatch(/posted entry cannot be changed/);
    expect(await failure(db.execute(sql`UPDATE journal_entries SET status = 'draft', posted_by = NULL, posted_at = NULL WHERE id = ${r.entry.id}`))).toMatch(/posted entry cannot be changed/);
    expect(await failure(db.execute(sql`DELETE FROM journal_lines WHERE id = ${line}`))).toMatch(/posted entry cannot be changed/);
    expect(await failure(db.execute(sql`DELETE FROM journal_entries WHERE id = ${r.entry.id}`))).toMatch(/cannot be deleted/);
    expect(await failure(db.execute(sql`TRUNCATE journal_lines CASCADE`))).toMatch(/cannot be cleared/);
    const [still] = await db.select().from(s.journalLines).where(eq(s.journalLines.id, line));
    expect(still.debit).toBe("12.00");
  });

  it("a draft is posted or deleted, never edited", async () => {
    const d = await pay("5.00", "2027-01-21", { asDraft: true });
    expect(d.entry.status).toBe("draft");
    expect(await failure(db.execute(sql`UPDATE journal_entries SET memo = 'changed' WHERE id = ${d.entry.id}`))).toMatch(/never edited/);
    expect(await failure(db.execute(sql`UPDATE journal_entries SET status = 'posted', posted_by = 'amina', memo = 'sneaky' WHERE id = ${d.entry.id}`))).toMatch(/nothing but its status/);
    await db.execute(sql`DELETE FROM journal_entries WHERE id = ${d.entry.id}`);
    expect(await db.select().from(s.journalLines).where(eq(s.journalLines.entryId, d.entry.id))).toHaveLength(0);
  });
});

describe("the database's own checks", { timeout: 60_000 }, () => {
  const insertEntry = (tx: Pick<typeof db, "execute">, opts: { status?: "draft" | "posted"; date?: string } = {}) =>
    tx.execute(sql`
      INSERT INTO journal_entries (organization_id, entry_date, period, memo, kind, source_type, status, recorded_by, posted_by, idempotency_key)
      VALUES (${org}, ${opts.date ?? "2027-02-05"}, date_trunc('month', ${opts.date ?? "2027-02-05"}::date)::date, 'raw', 'payment', 'test',
              ${opts.status ?? "draft"}, 'amina', ${opts.status === "posted" ? "omar" : null}, ${key()})
      RETURNING id`);
  const postIt = (tx: Pick<typeof db, "execute">, id: string, by = "omar") => tx.execute(sql`UPDATE journal_entries SET status = 'posted', posted_by = ${by} WHERE id = ${id}`);
  const idOf = (r: unknown) => ((r as { rows: { id: string }[] }).rows ?? (r as { id: string }[]))[0].id;
  const insertLine = (tx: Pick<typeof db, "execute">, entry: string, no: number, account: string, debit: string, credit: string) =>
    tx.execute(sql`
      INSERT INTO journal_lines (entry_id, line_no, account_id, debit, credit, currency, fx_rate, functional_debit, functional_credit)
      VALUES (${entry}, ${no}, ${account}, ${debit}, ${credit}, 'USD', 1, ${debit}, ${credit})`);

  it("refuses an entry written straight as posted: lines go in while it is a draft", async () => {
    expect(await failure(insertEntry(db, { status: "posted" }))).toMatch(/written as a draft/);
  });

  it("refuses an unbalanced posted entry when the transaction commits, written in raw SQL", async () => {
    const msg = await failure(
      db.transaction(async (tx) => {
        const id = idOf(await insertEntry(tx));
        await insertLine(tx, id, 1, program, "100.00", "0");
        await insertLine(tx, id, 2, bank, "0", "90.00");
        await postIt(tx, id);
      }),
    );
    expect(msg).toMatch(/does not balance/);
    // Through the app too: the rules refuse it before the database is asked.
    const draft = { kind: "payment" as const, entryDate: "2027-02-05", period: "2027-02-01", memo: "x", projectId: null, reversesId: null, lines: [
      { accountId: program, debit: "100.00", credit: "0.00", currency: "USD", fxRate: "1", functionalDebit: "100.00", functionalCredit: "0.00", donorId: null, projectId: null, budgetLineId: null, memo: null },
      { accountId: bank, debit: "0.00", credit: "90.00", currency: "USD", fxRate: "1", functionalDebit: "0.00", functionalCredit: "90.00", donorId: null, projectId: null, budgetLineId: null, memo: null },
    ] };
    expect(await failure(post({ organizationId: org, draft, sourceType: "test", recordedBy: "amina", idempotencyKey: key() }))).toMatch(/does not balance/);
  });

  it("refuses an unbalanced draft when it is posted", async () => {
    const id = idOf(await insertEntry(db));
    await insertLine(db, id, 1, program, "100.00", "0");
    await insertLine(db, id, 2, bank, "0", "99.99");
    expect(await failure(postIt(db, id))).toMatch(/does not balance/);
    expect(await failure(postDraft(id, "omar"))).toMatch(/does not balance/);
  });

  it("accepts a balanced entry and its lines written in one transaction, then no more lines", async () => {
    let id = "";
    await db.transaction(async (tx) => {
      id = idOf(await insertEntry(tx));
      await insertLine(tx, id, 1, program, "100.00", "0");
      await insertLine(tx, id, 2, bank, "0", "100.00");
      await postIt(tx, id);
    });
    const [e] = await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, id));
    expect(e.status).toBe("posted");
    expect(await failure(insertLine(db, id, 3, program, "1.00", "0"))).toMatch(/posted entry cannot be changed/);
    // Not even a balanced pair of extra lines in one transaction.
    expect(
      await failure(
        db.transaction(async (tx) => {
          await insertLine(tx, id, 3, program, "1.00", "0");
          await insertLine(tx, id, 4, bank, "0", "1.00");
        }),
      ),
    ).toMatch(/posted entry cannot be changed/);
  });

  it("refuses a line with both a debit and a credit, or a negative amount", async () => {
    const id = idOf(await insertEntry(db));
    expect(await failure(insertLine(db, id, 1, program, "10.00", "10.00"))).toMatch(/journal_lines_one_side/);
    expect(await failure(insertLine(db, id, 1, program, "-10.00", "0"))).toMatch(/journal_lines_not_negative/);
    expect(await failure(insertLine(db, id, 1, program, "0", "0"))).toMatch(/journal_lines_one_side/);
  });

  it("refuses posting your own payment over the limit, even in raw SQL", async () => {
    const msg = await failure(
      db.transaction(async (tx) => {
        const id = idOf(await insertEntry(tx));
        await insertLine(tx, id, 1, program, "600.00", "0");
        await insertLine(tx, id, 2, bank, "0", "600.00");
        await postIt(tx, id, "amina");
      }),
    );
    expect(msg).toMatch(/someone other than the person who recorded it/);
  });
});

describe("approval: no self-posting over the limit", { timeout: 60_000 }, () => {
  it("refuses it in the app, keeps it as a draft, and lets a second person post it", async () => {
    const e = await failure(pay("600.00", "2027-01-22"));
    expect(e).toMatch(/over USD 500.00/);
    try {
      await pay("600.00", "2027-01-22");
    } catch (err) {
      expect(err).toBeInstanceOf(LedgerError);
      expect((err as LedgerError).code).toBe("needs_second_person");
    }
    // Up to the limit, the recorder may post it.
    expect((await pay("500.00", "2027-01-22")).entry.status).toBe("posted");
    const d = await pay("600.00", "2027-01-22", { asDraft: true });
    expect(await failure(postDraft(d.entry.id, "amina"))).toMatch(/someone other than/);
    const p = await postDraft(d.entry.id, "omar");
    expect(p.entry).toMatchObject({ status: "posted", postedBy: "omar", recordedBy: "amina" });
    // Someone else posting it as it is recorded is fine too.
    expect((await pay("700.00", "2027-01-22", { postedBy: "omar" })).entry.postedBy).toBe("omar");
  });
});

describe("reversal", { timeout: 60_000 }, () => {
  it("nets the original to zero, points to it, and is allowed once", async () => {
    const before = await trialBalance(org);
    const bvaBefore = await budgetVsActual(project);
    const r = await pay("321.09", "2027-01-25");
    const rv = await reverse({ organizationId: org, recordedBy: "amina", idempotencyKey: key(), entryId: r.entry.id, date: "2027-01-26", memo: "Paid twice by mistake" });
    expect(rv.entry).toMatchObject({ kind: "reversal", reversesId: r.entry.id, status: "posted", sourceType: "reversal", sourceId: r.entry.id });
    const after = await trialBalance(org);
    expect(after.balanced).toBe(true);
    expect(after.rows.map((x) => [x.code, x.balance])).toEqual(before.rows.map((x) => [x.code, x.balance]));
    const bvaAfter = await budgetVsActual(project);
    expect(bvaAfter.total).toBe(bvaBefore.total);
    const audit = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, rv.entry.id), eq(s.auditLog.action, "ledger_reversed")));
    expect(audit).toHaveLength(1);
    const again = await failure(reverse({ organizationId: org, recordedBy: "amina", idempotencyKey: key(), entryId: r.entry.id, date: "2027-01-27", memo: "again" }));
    expect(again).toMatch(/already been reversed/);
  });
});

describe("locking a month", { timeout: 60_000 }, () => {
  it("stops anything posting into it, in the app and in SQL, and it stays locked", async () => {
    const book = await bankBookBalance(bankAccount, "2027-03-01");
    expect(book.currency).toBe("USD");
    expect(book.asOf).toBe("2027-03-31");
    const bal = await accountBalance(bank, "2027-03-31");
    expect(bal.byCurrency.USD).toBe(book.balance);

    const draft = await pay("20.00", "2027-03-10", { asDraft: true });
    const l = await lockPeriod(org, "2027-03-01", "omar");
    expect(l).toMatchObject({ already: false, draftsLeft: 1, period: "2027-03-01" });
    expect(await isLocked(org, "2027-03-01")).toBe(true);
    expect((await lockPeriod(org, "2027-03-01", "omar")).already).toBe(true);

    const e = await failure(pay("20.00", "2027-03-15"));
    expect(e).toMatch(/March 2027 is locked/);
    expect(await failure(postDraft(draft.entry.id, "omar"))).toMatch(/locked/);
    expect(await failure(db.execute(sql`UPDATE journal_entries SET status = 'posted', posted_by = 'omar' WHERE id = ${draft.entry.id}`))).toMatch(/locked/);
    expect(await failure(db.execute(sql`UPDATE fiscal_periods SET locked_at = NULL, locked_by = NULL WHERE organization_id = ${org}`))).toMatch(/stays locked/);
    expect(await failure(db.execute(sql`DELETE FROM fiscal_periods WHERE organization_id = ${org}`))).toMatch(/stays locked/);
    // The month after is open.
    expect((await pay("20.00", "2027-04-01")).entry.status).toBe("posted");
  });
});
