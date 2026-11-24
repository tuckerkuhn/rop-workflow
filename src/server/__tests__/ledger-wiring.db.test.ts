import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq, sql } from "drizzle-orm";
import { userById } from "@/lib/demo";
import { accountBalance, accountByCode, budgetVsActual, entriesBySource, lockPeriod, seedChart, trialBalance } from "@/server/ledger";
import { seedDatabase, resetDemo } from "@/server/demo-seed";
import { DEMO_LEDGER_BY, DEMO_LEDGER_POSTED_BY, demoBooksSpending, isDemoOrganization, resetDemoLedger, seedDemoLedger } from "@/server/demo-ledger";
import { demoSpending } from "@/lib/demo-design";
import { realToday } from "@/lib/clock";
import { expenditureKey, postExistingExpenditures, recordExpenditure } from "@/server/expenditure-store";
import { printRun } from "@/db/ledger-post-cli";
import { ledgerSpent } from "@/server/ledger-spent";
import { latestLedgerCheck, runLedgerCheck } from "@/server/ledger-check";
import { loadBudget } from "@/server/plan-store";
import { loadBudgetView } from "@/server/budget-view-store";
import { loadReview } from "@/server/monthly-review-store";
import { qprData } from "@/server/qpr-store";
import { loadHome } from "@/server/home-store";
import { projectByCode } from "@/server/field-store";
import { db, ready, schema as s } from "@/server/__tests__/test-db";
import { GET as ledgerCheckRoute } from "@/app/api/cron/ledger-check/route";

/**
 * The ledger wired into the existing data: expenditures post through it, every reader of spent reads
 * it (falling back to budget_lines.spent for a project not migrated), the demo has real books and can
 * still be reset, and the nightly check keeps its result.
 */

const code = "A-2027";
const nadia = userById("nadia")!;
let demoId = "";
let demoOrg = "";

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

const plain = <T,>(v: T) => JSON.parse(JSON.stringify(v)) as T;
const rows = <T,>(r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: T[] }).rows ?? [])) as T[];

beforeAll(async () => {
  // The morning of the demo: three months of sample spending and an ended quarter.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-01-10T12:00:00Z"), shouldAdvanceTime: true });
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  const p = await projectByCode(code);
  demoId = p.id;
  demoOrg = p.organizationId;
}, 300_000);

afterAll(() => {
  vi.useRealTimers();
});

const spendingNow = () => demoBooksSpending(demoSpending("2026-10-01", realToday()));

describe("the demo's books", { timeout: 240_000 }, () => {
  it("has the chart, bank and cash, donor money received and the sample spending as posted payments", async () => {
    expect(await isDemoOrganization(demoOrg)).toBe(true);
    const banks = await db.select().from(s.bankAccounts).where(eq(s.bankAccounts.organizationId, demoOrg));
    expect(banks.map((b) => b.currency)).toEqual(["USD", "USD"]);
    const entries = await db.select().from(s.journalEntries).where(eq(s.journalEntries.projectId, demoId));
    expect(entries.filter((e) => e.kind === "donor_receipt")).toHaveLength(3);
    expect(entries.filter((e) => e.kind === "payment").length).toBeGreaterThanOrEqual(9);
    expect(entries.every((e) => e.status === "posted" && e.recordedBy === DEMO_LEDGER_BY && e.postedBy === DEMO_LEDGER_POSTED_BY)).toBe(true);
    expect((await trialBalance(demoOrg)).balanced).toBe(true);
    const bva = await budgetVsActual(demoId);
    expect(Number(bva.total)).toBeGreaterThan(0);
  });

  it("holds on the main bank account to 31 October 2026 exactly what the sample statement shows, bank charge left out", async () => {
    const bank = (await accountByCode(demoOrg, "1010"))!;
    const october = rows<{ entry_date: string; debit: string; credit: string }>(
      await db.execute(sql`SELECT e.entry_date::text, l.debit::text, l.credit::text FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = ${bank.id} AND e.entry_date <= '2026-10-31' ORDER BY e.entry_date`),
    );
    expect(october.map((r) => [r.entry_date, Number(r.debit) || -Number(r.credit)])).toEqual([
      ["2026-10-01", 25000],
      ["2026-10-03", -4850],
      ["2026-10-08", -2300],
      ["2026-10-15", -1200],
      ["2026-10-18", -640],
    ]);
    expect((await accountBalance(bank.id, "2026-10-31")).byCurrency).toEqual({ USD: "16010.00" });
  });

  it("gives each budget line the same spent from the ledger as budget_lines.spent", async () => {
    const lines = await db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, demoId));
    const ledger = (await ledgerSpent(demoId))!;
    expect(ledger).not.toBeNull();
    for (const l of lines) expect(ledger.byCode[l.code] ?? 0).toBeCloseTo(Number(l.spent ?? 0), 2);
    const bva = await budgetVsActual(demoId);
    for (const l of lines) {
      const actual = bva.rows.filter((r) => r.code === l.code).reduce((t, r) => t + Number(r.actual), 0);
      expect(actual).toBeCloseTo(Number(l.spent ?? 0), 2);
    }
  });

  it("shows the same budget, review, report and Home from the ledger as without it", async () => {
    const read = async () => {
      const quarter = "2026-Q4";
      const [budget, view, review, report, home] = [await loadBudget(code), await loadBudgetView(code), await loadReview(code, "2026-12", nadia), await qprData(code, quarter), await loadHome(code, nadia)];
      return plain({ budget, view, review: { budget: review.budget, lines: review.lines }, spend: report.spend, home: (home as { budget?: unknown }).budget ?? null });
    };
    const withLedger = await read();
    // Take the ledger away (the demo reset's own way), read again from the old figures, then put it back.
    await resetDemoLedger(code, "test");
    expect(await ledgerSpent(demoId)).toBeNull();
    const without = await read();
    await seedDemoLedger(demoId, demoOrg, spendingNow());
    expect(withLedger).toEqual(without);
    expect(await read()).toEqual(withLedger);
  });

  it("can be reset with posted entries, a locked month and the books cleared for the demo only", { timeout: 240_000 }, async () => {
    // On its own feet: the demo's books are there whatever ran before.
    await seedDemoLedger(demoId, demoOrg, spendingNow());
    await lockPeriod(demoOrg, "2026-10-01", "test");
    const before = await db.select().from(s.journalEntries).where(eq(s.journalEntries.projectId, demoId));
    expect(before.length).toBeGreaterThan(0);
    await resetDemo(code);
    const after = await db.select().from(s.journalEntries).where(eq(s.journalEntries.projectId, demoId));
    // The same demo again: new entries, none of the old ones.
    expect(after.length).toBe(before.length);
    expect(after.some((e) => before.some((b) => b.id === e.id))).toBe(false);
    expect(await db.select().from(s.fiscalPeriods).where(eq(s.fiscalPeriods.organizationId, demoOrg))).toHaveLength(0);
    const audits = await db.select().from(s.auditLog).where(and(eq(s.auditLog.action, "ledger_demo_reset"), eq(s.auditLog.projectId, demoId)));
    const audit = audits.find((a) => (a.detail as { by?: string }).by === "demo-reset");
    expect(audit?.detail).toMatchObject({ by: "demo-reset", wholeOrganization: true, periods: 1 });
    expect(Number((audit?.detail as { entries: number }).entries)).toBe(before.length);
    expect((await trialBalance(demoOrg)).balanced).toBe(true);
  });

  it("refuses a raw UPDATE or DELETE of a posted demo line outside the reset function", async () => {
    const [line] = rows<{ id: string; entry_id: string }>(await db.execute(sql`SELECT l.id, l.entry_id FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.project_id = ${demoId} AND e.status = 'posted' LIMIT 1`));
    expect(await failure(db.execute(sql`UPDATE journal_lines SET memo = 'changed' WHERE id = ${line.id}`))).toMatch(/cannot be changed/);
    expect(await failure(db.execute(sql`DELETE FROM journal_lines WHERE id = ${line.id}`))).toMatch(/cannot be changed/);
    expect(await failure(db.execute(sql`DELETE FROM journal_entries WHERE id = ${line.entry_id}`))).toMatch(/cannot be deleted/);
    // A setting left from another transaction counts for nothing.
    await db.execute(sql`SELECT set_config('ledger.demo_reset', ${`${demoId}:1`}, false)`);
    expect(await failure(db.execute(sql`DELETE FROM journal_entries WHERE id = ${line.entry_id}`))).toMatch(/cannot be deleted/);
    await db.execute(sql`SELECT set_config('ledger.demo_reset', '', false)`);
    // Even inside the reset's own exception, an UPDATE of a posted line is refused.
    expect(
      await failure(
        db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('ledger.demo_reset', ${demoId}::text || ':' || txid_current()::text, true)`);
          await tx.execute(sql`UPDATE journal_lines SET memo = 'changed' WHERE id = ${line.id}`);
        }),
      ),
    ).toMatch(/cannot be changed/);
  });

  it("never lets the exception delete another project's entry, or reset another project", async () => {
    const [org] = await db.insert(s.organizations).values({ name: "Real books" }).returning();
    const [real] = await db.insert(s.projects).values({ organizationId: org.id, code: "REAL-1", name: "Real", country: "AF", kind: "real" }).returning();
    const [bl] = await db.insert(s.budgetLines).values({ projectId: real.id, code: "R1", description: "Seed", amount: "1000", currency: "USD", kind: "program" }).returning();
    await seedChart(org.id);
    const { entry } = await recordExpenditure({ budgetLineId: bl.id, description: "Seed for the trial plots", amount: "100.00", spentOn: "2027-01-05", recordedBy: "amina" });
    const id = entry.entry.id;
    // The same bypass the reset uses, set for the demo project in this very transaction.
    expect(
      await failure(
        db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('ledger.demo_reset', ${demoId}::text || ':' || txid_current()::text, true)`);
          await tx.execute(sql`DELETE FROM journal_entries WHERE id = ${id}`);
        }),
      ),
    ).toMatch(/cannot be deleted/);
    // Pointed at the real project itself, the bypass does not apply either: it is not the demo.
    expect(
      await failure(
        db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('ledger.demo_reset', ${real.id}::text || ':' || txid_current()::text, true)`);
          await tx.execute(sql`DELETE FROM journal_entries WHERE id = ${id}`);
        }),
      ),
    ).toMatch(/cannot be deleted/);
    expect(await failure(db.execute(sql`SELECT ledger_reset_demo('REAL-1', 'test')`))).toMatch(/real project/);
    expect(await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, id))).toHaveLength(1);
  });

  it("removes only the demo project's own entries when the organization also holds a real project", async () => {
    const [real] = await db.insert(s.projects).values({ organizationId: demoOrg, code: "SHARED-1", name: "Real in the demo org", country: "AF", kind: "real" }).returning();
    const [bl] = await db.insert(s.budgetLines).values({ projectId: real.id, code: "S1", description: "Rent", amount: "1000", currency: "USD", kind: "operations" }).returning();
    const { entry } = await recordExpenditure({ budgetLineId: bl.id, description: "Office rent", amount: "50.00", spentOn: "2027-01-06", recordedBy: "amina" });
    expect(await isDemoOrganization(demoOrg)).toBe(false);
    const result = await resetDemoLedger(code, "test");
    expect(result).toMatchObject({ whole: false });
    expect(await db.select().from(s.journalEntries).where(eq(s.journalEntries.projectId, demoId))).toHaveLength(0);
    expect(await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, entry.entry.id))).toHaveLength(1);
    expect(await db.select().from(s.bankAccounts).where(eq(s.bankAccounts.organizationId, demoOrg))).toHaveLength(2);
    // And no fictional payments are written into an organization with real books.
    expect(await seedDemoLedger(demoId, demoOrg, spendingNow())).toMatchObject({ payments: 0, skipped: expect.stringMatching(/real projects/) });
  });
});

describe("expenditures through the ledger", { timeout: 240_000 }, () => {
  let org = "";
  let project = "";
  let lineA = "";
  let lineB = "";
  beforeAll(async () => {
    [{ id: org }] = await db.insert(s.organizations).values({ name: "Migration Org" }).returning();
    [{ id: project }] = await db.insert(s.projects).values({ organizationId: org, code: "MIG-1", name: "Migration test", country: "AF", kind: "sandbox", startDate: "2026-07-01", endDate: "2027-12-31" }).returning();
    [{ id: lineA }, { id: lineB }] = await db
      .insert(s.budgetLines)
      .values([
        { projectId: project, code: "A", description: "Seed", amount: "5000", currency: "USD", kind: "program", spent: "1250.50", sort: 1 },
        { projectId: project, code: "B", description: "Salaries", amount: "9000", currency: "USD", kind: "personnel", spent: "3000.00", sort: 2 },
      ])
      .returning();
    // The old rows: the same amounts budget_lines.spent holds, and one in another currency.
    await db.insert(s.expenditures).values([
      { budgetLineId: lineA, description: "Seed, first lot", amount: "1000.50", currency: "USD", spentOn: "2026-08-10" },
      { budgetLineId: lineA, description: "Seed, second lot", amount: "250.00", currency: "USD", spentOn: "2026-09-12" },
      { budgetLineId: lineB, description: "Field staff, August", amount: "3000.00", currency: "USD", spentOn: "2026-08-31" },
      { budgetLineId: lineB, description: "Driver, cash", amount: "7000.00", currency: "AFN", spentOn: "2026-08-31" },
    ]);
  });

  it("reads budget_lines.spent while the project has no posted spending (not migrated)", async () => {
    expect(await ledgerSpent(project)).toBeNull();
    expect((await loadBudget("MIG-1")).lines.map((l) => l.spent)).toEqual([1250.5, 3000]);
  });

  it("dry-runs by default: says what it would post and writes nothing", async () => {
    const before = await loadBudget("MIG-1");
    const run = await postExistingExpenditures({ apply: false, project: "MIG-1" });
    expect(run.rows.filter((r) => r.status === "post")).toHaveLength(3);
    expect(run.rows.filter((r) => r.status === "skip").map((r) => r.currency)).toEqual(["AFN"]);
    expect(run.projects).toEqual([{ project: "MIG-1", currency: "USD", budgetLinesSpent: "4250.50", expenditures: { USD: "4250.50", AFN: "7000.00" }, ledgerBefore: "0.00", ledgerAfter: "4250.50" }]);
    const out: string[] = [];
    printRun(run, (l) => out.push(l));
    expect(out[0]).toMatch(/^DRY RUN/);
    expect(out.join("\n")).toMatch(/MIG-1: budget_lines.spent 4250.50; expenditures USD 4250.50, AFN 7000.00; ledger USD 0.00 -> 4250.50/);
    expect(await db.select().from(s.journalEntries).where(eq(s.journalEntries.projectId, project))).toHaveLength(0);
    expect(await loadBudget("MIG-1")).toEqual(before);
  });

  it("posts on --apply, once, and every page then reads the same spent from the ledger", async () => {
    const before = await loadBudget("MIG-1");
    await expect(postExistingExpenditures({ apply: true, project: "MIG-1" })).rejects.toThrow(/--by/);
    const run = await postExistingExpenditures({ apply: true, by: "daniel", project: "MIG-1" });
    expect(run.rows.filter((r) => r.status === "post")).toHaveLength(3);
    expect(run.projects[0]).toMatchObject({ ledgerBefore: "0.00", ledgerAfter: "4250.50" });
    const again = await postExistingExpenditures({ apply: true, by: "daniel", project: "MIG-1" });
    expect(again.rows.filter((r) => r.status === "posted")).toHaveLength(3);
    expect(again.projects[0]).toMatchObject({ ledgerBefore: "4250.50", ledgerAfter: "4250.50" });
    const ledger = (await ledgerSpent(project))!;
    expect(ledger.byCode).toEqual({ A: 1250.5, B: 3000 });
    expect(await loadBudget("MIG-1")).toEqual(before);
    const [exp] = await db.select().from(s.expenditures).where(eq(s.expenditures.description, "Seed, first lot"));
    const [e] = await entriesBySource("expenditure", exp.id);
    expect(e.entry).toMatchObject({ idempotencyKey: expenditureKey(exp.id), status: "posted", recordedBy: "ledger-post-cli", postedBy: "daniel" });
    // Expense account for the line's kind, paid from 1010 (the marked default).
    const accts = await db.select().from(s.ledgerAccounts).where(eq(s.ledgerAccounts.organizationId, org));
    const codeOf = (id: string) => accts.find((a) => a.id === id)?.code;
    expect(e.lines.map((l) => codeOf(l.accountId))).toEqual(["5000", "1010"]);
  });

  it("writes a new expenditure, its entry and budget_lines.spent together", async () => {
    const { expenditureId, entry } = await recordExpenditure({ budgetLineId: lineA, description: "Seed, third lot", amount: "99.50", spentOn: "2026-10-03", recordedBy: "amina" });
    expect(entry.entry).toMatchObject({ sourceType: "expenditure", sourceId: expenditureId, idempotencyKey: expenditureKey(expenditureId), status: "posted" });
    const [line] = await db.select().from(s.budgetLines).where(eq(s.budgetLines.id, lineA));
    expect(Number(line.spent)).toBeCloseTo(1350, 2);
    expect((await ledgerSpent(project))!.byCode.A).toBeCloseTo(1350, 2);
  });

  it("fails the expenditure the same way when the ledger refuses (locked month, over the limit)", async () => {
    await lockPeriod(org, "2026-08-01", "daniel");
    const count = async () => (await db.select().from(s.expenditures).where(eq(s.expenditures.budgetLineId, lineA))).length;
    const n = await count();
    expect(await failure(recordExpenditure({ budgetLineId: lineA, description: "Late seed", amount: "10.00", spentOn: "2026-08-20", recordedBy: "amina" }))).toMatch(/locked/);
    expect(await failure(recordExpenditure({ budgetLineId: lineA, description: "Big seed order", amount: "4000.00", spentOn: "2026-10-20", recordedBy: "amina" }))).toMatch(/someone other than/);
    expect(await count()).toBe(n);
    const [line] = await db.select().from(s.budgetLines).where(eq(s.budgetLines.id, lineA));
    expect(Number(line.spent)).toBeCloseTo(1350, 2);
    // With a second person posting, it goes through.
    await recordExpenditure({ budgetLineId: lineA, description: "Big seed order", amount: "4000.00", spentOn: "2026-10-20", recordedBy: "amina", postedBy: "daniel" });
    expect(await count()).toBe(n + 1);
  });
});

describe("the nightly check", { timeout: 60_000 }, () => {
  it("checks every organization and keeps the latest result", async () => {
    const run = await runLedgerCheck();
    expect(run.failed).toBe(0);
    expect(run.organizations).toBeGreaterThanOrEqual(3);
    const latest = await latestLedgerCheck(demoOrg);
    expect(latest).toMatchObject({ ok: true, problems: [] });
    expect(Date.parse(latest!.at)).not.toBeNaN();
  });

  it("refuses to run without the cron secret", async () => {
    const old = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    expect((await ledgerCheckRoute(new Request("http://x/api/cron/ledger-check"))).status).toBe(503);
    process.env.CRON_SECRET = "test-secret";
    expect((await ledgerCheckRoute(new Request("http://x/api/cron/ledger-check", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect((await ledgerCheckRoute(new Request("http://x/api/cron/ledger-check", { headers: { authorization: "Bearer test-secret" } }))).status).toBe(200);
    if (old === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = old;
  });
});

describe("a payment on a project whose books are not kept in the app", { timeout: 240_000 }, () => {
  it("shows in the books but leaves the pages on the spending import until the project switches", async () => {
    const [{ id: org }] = await db.insert(s.organizations).values({ name: "Workbook Org" }).returning();
    const [{ id: project }] = await db.insert(s.projects).values({ organizationId: org, code: "WB-1", name: "Workbook project", country: "AF", kind: "sandbox", startDate: "2026-07-01", endDate: "2027-12-31" }).returning();
    const [line] = await db.insert(s.budgetLines).values({ projectId: project, code: "A", description: "Seed", amount: "5000", currency: "USD", kind: "program", spent: "2400.00", sort: 1 }).returning();
    await seedChart(org);
    const bank = (await accountByCode(org, "1010"))!;
    const expense = (await accountByCode(org, "5000"))!;
    const before = await loadBudget("WB-1");
    await import("@/server/ledger").then(({ postPayment }) =>
      postPayment(
        { organizationId: org, recordedBy: "yusuf", postedBy: "omid", idempotencyKey: "wb-1-test" },
        { date: "2026-10-05", memo: "Seed, test payment", paidFrom: bank.id, currency: "USD", fxRate: "1", projectId: project, expenses: [{ accountId: expense.id, amount: "120.00", projectId: project, budgetLineId: line.id }] },
      ),
    );
    // The books have it (Budget vs actual from the books shows it)...
    expect(JSON.stringify((await budgetVsActual(project)).total)).toContain("120.00");
    // ...but the pages still read the workbook's 2,400, not 120.
    expect(await ledgerSpent(project)).toBeNull();
    expect(await loadBudget("WB-1")).toEqual(before);
  });
});
