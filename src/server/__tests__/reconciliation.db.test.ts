import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { GET as RECON, POST as ACT } from "@/app/api/projects/[code]/reconciliation/route";
import { POST as IMPORT } from "@/app/api/projects/[code]/reconciliation/import/route";
import { guessMapping, parseCsv, type StatementMapping } from "@/lib/ledger/statement-csv";
import { seedDatabase } from "@/server/demo-seed";
import { projectByCode } from "@/server/field-store";
import { bankBookBalance, expenseAccountFor, LedgerError, postDonorReceipt, postPayment, seedChart } from "@/server/ledger";
import {
  completeReconciliation,
  importStatement,
  matchLine,
  reconciliationsStillMatch,
  reconciliationView,
  setStatementBalance,
  suggestMatches,
  unmatchLine,
  type ImportResult,
  type ReconciliationView,
} from "@/server/reconciliation";
import { ready } from "@/server/__tests__/test-db";

/**
 * Bank reconciliation in Month close: import a statement, match its lines, complete only at a zero
 * difference, lock the month. The months used here (August to October 2026) have ended.
 */
const code = "A-2027";
let org = "";
let projectId = "";
let bank = ""; // bank_accounts id
let bankLedger = ""; // its ledger account
let program = "";
let donor = "";
let n = 0;
const key = () => `recon-test-${++n}`;

const payment = (amount: string, date: string, memo = "Seed for the planting") =>
  postPayment({ organizationId: org, recordedBy: "nadia", postedBy: "yusuf", idempotencyKey: key() }, { date, memo, paidFrom: bankLedger, currency: "USD", fxRate: "1", projectId, expenses: [{ accountId: program, amount, projectId, donorId: donor }] });
const receipt = (amount: string, date: string) =>
  postDonorReceipt({ organizationId: org, recordedBy: "yusuf", idempotencyKey: key() }, { date, memo: "Donor tranche", depositedTo: bankLedger, donorId: donor, projectId, currency: "USD", fxRate: "1", amount });

const csvOf = (lines: [string, string, string][]) => ["Date,Description,Amount", ...lines.map(([d, desc, a]) => `${d},"${desc}",${a}`)].join("\n");
const mapOf = (csv: string): StatementMapping => guessMapping(parseCsv(csv));
const doImport = (month: string, csv: string) => importStatement({ organizationId: org, bankAccountId: bank, month, csv, mapping: mapOf(csv), by: "yusuf", projectId });

type Handler = (req: Request, ctx: never) => Promise<Response>;
type Answer = { view: ReconciliationView | null; canReconcile: boolean; bankAccounts: { id: string }[]; lock?: { draftsLeft: number } } & ImportResult & { error?: string };
async function call(handler: Handler, as: string, path: string, body?: unknown) {
  const init: RequestInit = { method: body === undefined ? "GET" : "POST", headers: { "x-demo-user": as, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  const res = await handler(new Request(`http://test/api/projects/${code}/reconciliation${path}`, init), { params: Promise.resolve({ code }) } as never);
  return { status: res.status, body: (await res.json()) as Answer };
}

async function refused(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const out: string[] = [];
    for (let cur: unknown = e, i = 0; cur && i < 5; cur = (cur as { cause?: unknown }).cause, i++) out.push(String((cur as { message?: string }).message ?? cur));
    return out.join(" | ");
  }
  throw new Error("expected a refusal, but it went through");
}

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  const project = await projectByCode(code);
  org = project.organizationId;
  projectId = project.id;
  await seedChart(org);
  program = (await expenseAccountFor(org, "program"))!.id;
  // A bank of its own, so nothing the demo seeds touches these figures.
  [{ id: bankLedger }] = await db.insert(s.ledgerAccounts).values({ organizationId: org, code: "1090", name: "Test bank for reconciliation", type: "asset" }).returning();
  [{ id: bank }] = await db.insert(s.bankAccounts).values({ organizationId: org, ledgerAccountId: bankLedger, name: "Reconciliation test bank", currency: "USD" }).returning();
  [{ id: donor }] = await db.insert(s.donors).values({ organizationId: org, projectId, name: "Reconciliation Donor (fictional)" }).returning();
}, 120_000);

describe("suggested matches", () => {
  it("pairs the same amount and sign within a few days, closest first, each line once", () => {
    const st = [
      { id: "s1", date: "2026-08-05", amount: "-100.00" },
      { id: "s2", date: "2026-08-06", amount: "-100.00" },
      { id: "s3", date: "2026-08-20", amount: "100.00" },
      { id: "s4", date: "2026-08-25", amount: "-60.00" },
    ];
    const book = [
      { lineId: "b1", date: "2026-08-06", amount: "-100.00" },
      { lineId: "b2", date: "2026-08-04", amount: "-100.00" },
      { lineId: "b3", date: "2026-08-20", amount: "-100.00" }, // wrong sign for s3
      { lineId: "b4", date: "2026-08-10", amount: "-60.00" }, // too far from s4
    ];
    const got = suggestMatches(st, book);
    expect(got.map((g) => [g.statementLineId, g.lineId])).toEqual([
      ["s2", "b1"],
      ["s1", "b2"],
    ]);
  });
});

describe("bank reconciliation", { timeout: 60_000 }, () => {
  it("imports a statement; importing the same file again adds nothing", async () => {
    await receipt("5000.00", "2026-08-01");
    await payment("1200.00", "2026-08-03");
    await payment("300.00", "2026-08-10");
    const csv = csvOf([
      ["2026-08-02", "Donor tranche, first", "5000.00"],
      ["2026-08-05", "Cheque 101", "-1200.00"],
      ["2026-08-11", "Transfer, supplier", "-300.00"],
      ["2026-08-11", "Transfer, supplier", "-300.00"],
      ["2026-08-31", "Bank charges", "-15.00"],
      ["2026-09-01", "Next month", "-1.00"],
    ]);
    const first = await doImport("2026-08", csv);
    expect(first).toMatchObject({ added: 5, already: 0, outside: 1 });
    const again = await doImport("2026-08", csv);
    expect(again).toMatchObject({ added: 0, already: 5, outside: 1 });
    const rows = await db.select().from(s.bankStatementLines).where(eq(s.bankStatementLines.bankAccountId, bank));
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.importedBy === "yusuf" && r.importKey?.length === 64)).toBe(true);
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "ledger_statement_imported"));
    expect(audit).toHaveLength(2);
  });

  it("suggests the matches; a person confirms, unmatches and matches by hand", async () => {
    const v = await reconciliationView(org, bank, "2026-08");
    expect(v.counts).toMatchObject({ statement: 5, matched: 0, suggested: 3 });
    const bySuggestion = v.statementLines.filter((l) => l.suggestion);
    // The two identical supplier lines: one is suggested, the other stays open (one ledger line of 300).
    expect(v.statementLines.filter((l) => l.amount === "-300.00" && l.suggestion)).toHaveLength(1);
    for (const l of bySuggestion) await matchLine({ organizationId: org, statementLineId: l.id, journalLineId: l.suggestion!.lineId, by: "yusuf", projectId });
    let after = await reconciliationView(org, bank, "2026-08");
    expect(after.counts).toMatchObject({ matched: 3, unmatchedStatement: 2, unmatchedBook: 0, suggested: 0 });

    // A ledger line matches one statement line only, only for the same amount.
    const open300 = after.statementLines.find((l) => l.amount === "-300.00" && !l.matchedLineId)!;
    const taken = after.statementLines.find((l) => l.amount === "-300.00" && l.matchedLineId)!;
    expect(await refused(matchLine({ organizationId: org, statementLineId: open300.id, journalLineId: taken.matchedLineId!, by: "yusuf", projectId }))).toMatch(/already matched/);
    const fee = after.statementLines.find((l) => l.amount === "-15.00")!;
    expect(await refused(matchLine({ organizationId: org, statementLineId: fee.id, journalLineId: taken.matchedLineId!, by: "yusuf", projectId }))).toMatch(/amounts differ/);

    await unmatchLine({ organizationId: org, statementLineId: taken.id, by: "yusuf", projectId });
    after = await reconciliationView(org, bank, "2026-08");
    expect(after.counts.matched).toBe(2);
    expect(after.statementLines.find((l) => l.id === taken.id)!.candidates).toHaveLength(1);
    await matchLine({ organizationId: org, statementLineId: taken.id, journalLineId: taken.matchedLineId!, by: "yusuf", projectId });
    expect((await reconciliationView(org, bank, "2026-08")).counts.matched).toBe(3);
  });

  it("refuses to complete at a difference other than zero; so does the database", async () => {
    // Statement: 5000 - 1200 - 300 - 300 - 15 = 3185. Book: 5000 - 1200 - 300 = 3500.
    await setStatementBalance({ organizationId: org, bankAccountId: bank, month: "2026-08", balance: "3,185.00", by: "yusuf" });
    const v = await reconciliationView(org, bank, "2026-08");
    expect(v).toMatchObject({ statementBalance: "3185.00", bookBalance: "3500.00", difference: "-315.00" });
    expect(v.bookBalance).toBe((await bankBookBalance(bank, "2026-08-01")).balance);
    const why = await refused(completeReconciliation({ organizationId: org, bankAccountId: bank, month: "2026-08", by: "yusuf", projectId }));
    expect(why).toMatch(/difference is -315.00 USD/);
    // Straight to the database: the CHECK refuses a completion away from zero, or a difference that is not statement minus book.
    expect(await refused(db.execute(sql`UPDATE reconciliations SET completed_at = now(), completed_by = 'yusuf' WHERE bank_account_id = ${bank}`))).toMatch(/reconciliations_complete_at_zero|check/i);
    expect(await refused(db.execute(sql`UPDATE reconciliations SET difference = 0, completed_at = now(), completed_by = 'yusuf' WHERE bank_account_id = ${bank}`))).toMatch(/reconciliations_difference|check/i);
  });

  it("completes at zero once the missing lines are recorded, then locks the month; nothing posts into it afterwards", async () => {
    // The second supplier transfer and the bank charges were missing from the books: Finance records them.
    await payment("300.00", "2026-08-11", "Second supplier transfer");
    await payment("15.00", "2026-08-31", "Bank charges");
    let v = await reconciliationView(org, bank, "2026-08");
    expect(v.difference).toBe("0.00");
    expect(v.counts.suggested).toBe(2);
    for (const l of v.statementLines.filter((x) => x.suggestion)) await matchLine({ organizationId: org, statementLineId: l.id, journalLineId: l.suggestion!.lineId, by: "yusuf", projectId });

    // Yusuf posted the month's payments, so he does not complete its reconciliation (review round 1, ISS-04).
    const view = await call(RECON as Handler, "yusuf", `?bank=${bank}&month=2026-08`);
    expect((view.body as { ownEntries?: number }).ownEntries).toBeGreaterThan(0);
    const own = await call(ACT as Handler, "yusuf", "", { action: "complete", bankAccountId: bank, month: "2026-08" });
    expect(own.status).toBeGreaterThanOrEqual(400);
    expect(own.body.error).toMatch(/You recorded or posted \d+ entries on Reconciliation test bank in August 2026, so someone else in Finance completes/);
    expect((await reconciliationView(org, bank, "2026-08")).completed).toBeNull();
    // Omid, who entered none of them, does.
    const done = await call(ACT as Handler, "omid", "", { action: "complete", bankAccountId: bank, month: "2026-08" });
    expect(done.status).toBe(200);
    expect((done.body as { ownEntries?: number }).ownEntries).toBe(0);
    v = done.body.view!;
    expect(v.completed?.by).toBe("omid");
    expect(v.counts).toMatchObject({ matched: 5, unmatchedStatement: 0, unmatchedBook: 0 });
    const [row] = await db.select().from(s.reconciliations).where(and(eq(s.reconciliations.bankAccountId, bank), eq(s.reconciliations.period, "2026-08-01")));
    expect(row).toMatchObject({ statementBalance: "3185.00", bookBalance: "3185.00", difference: "0.00", completedBy: "omid" });
    const [audit] = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "ledger_reconciled"));
    expect(audit).toMatchObject({ projectId, entityId: row.id });

    // Frozen: no unmatching, no new balance, no import into a reconciled month; the row itself never changes.
    const first = v.statementLines[0];
    expect(await refused(unmatchLine({ organizationId: org, statementLineId: first.id, by: "yusuf", projectId }))).toMatch(/reconciled/);
    expect(await refused(setStatementBalance({ organizationId: org, bankAccountId: bank, month: "2026-08", balance: "1", by: "yusuf" }))).toMatch(/reconciled/);
    expect(await refused(doImport("2026-08", csvOf([["2026-08-15", "Late line", "-1.00"]])))).toMatch(/reconciled/);
    expect(await refused(db.execute(sql`UPDATE reconciliations SET completed_by = 'someone' WHERE id = ${row.id}`))).toMatch(/cannot be changed/);
    expect(await reconciliationsStillMatch(org)).toEqual([]);

    // A draft left in the month is counted when the month is locked.
    await postPayment({ organizationId: org, recordedBy: "nadia", asDraft: true, idempotencyKey: key() }, { date: "2026-08-20", memo: "Left as a draft", paidFrom: bankLedger, currency: "USD", fxRate: "1", projectId, expenses: [{ accountId: program, amount: "10.00", projectId }] });
    const locked = await call(ACT as Handler, "yusuf", "", { action: "lock", bankAccountId: bank, month: "2026-08" });
    expect(locked.status).toBe(200);
    expect(locked.body.lock?.draftsLeft).toBe(1);
    expect(locked.body.view!.locked?.by).toBe("yusuf");

    const late = await refused(payment("50.00", "2026-08-25", "Dated into the locked month"));
    expect(late).toMatch(/locked/);
  });

  it("the nightly check names a reconciled month the ledger no longer agrees with", async () => {
    // September: reconciled at zero but not locked, then an entry is posted later dated into it.
    await payment("40.00", "2026-09-04", "September payment");
    // R2-24: a typed balance equal to the books is not a reconciliation; the statement's lines come first.
    await setStatementBalance({ organizationId: org, bankAccountId: bank, month: "2026-09", balance: "3145.00", by: "yusuf" });
    expect(await refused(completeReconciliation({ organizationId: org, bankAccountId: bank, month: "2026-09", by: "peter", projectId }))).toMatch(/Import .*statement for September 2026 first/);
    const csv = csvOf([["2026-09-05", "Cheque 102", "-40.00"]]);
    await doImport("2026-09", csv);
    // The statement's closing balance: August's 3185 less 40.
    await setStatementBalance({ organizationId: org, bankAccountId: bank, month: "2026-09", balance: "3145.00", by: "yusuf" });
    // In solo mode the one finance person completes their own month, but only by confirming it; the entry is marked.
    const solo = { on: true, blocked: null };
    expect(await refused(completeReconciliation({ organizationId: org, bankAccountId: bank, month: "2026-09", by: "yusuf", projectId, solo }))).toMatch(/Confirm that you prepared this/);
    expect(await refused(completeReconciliation({ organizationId: org, bankAccountId: bank, month: "2026-09", by: "yusuf", projectId, solo: { on: true, blocked: "The donor's rules require a second person." }, self: { confirm: true, note: "" } }))).toMatch(/someone else in Finance completes.*The donor's rules require a second person/);
    const sept = await completeReconciliation({ organizationId: org, bankAccountId: bank, month: "2026-09", by: "yusuf", projectId, solo, self: { confirm: true, note: "One finance person this month." } });
    const [marked] = await db.select({ detail: s.auditLog.detail }).from(s.auditLog).where(and(eq(s.auditLog.entityId, sept.id), eq(s.auditLog.action, "ledger_reconciled")));
    expect(marked.detail).toMatchObject({ selfApproved: true, soloNote: "One finance person this month." });
    expect(await reconciliationsStillMatch(org)).toEqual([]);
    await payment("25.00", "2026-09-28", "Posted after the reconciliation");
    const off = await reconciliationsStillMatch(org);
    expect(off).toHaveLength(1);
    expect(off[0]).toMatchObject({ bankAccountId: bank, period: "2026-09-01", bookBalanceThen: "3145.00", bookBalanceNow: "3120.00", difference: "25.00", locked: false });
  });

  it("a month that has not ended is neither reconciled nor locked", async () => {
    const err = await refused(completeReconciliation({ organizationId: org, bankAccountId: bank, month: "2099-01", by: "yusuf", projectId }));
    expect(err).toMatch(/has not ended/);
  });
});

describe("who may reconcile", { timeout: 60_000 }, () => {
  it("Finance and administrators see the lines and act; others on the project read the figures only; donors are refused", async () => {
    const q = () => `?bank=${bank}&month=2026-08`;
    const finance = await call(RECON as Handler, "yusuf", q());
    expect(finance.status).toBe(200);
    expect(finance.body.canReconcile).toBe(true);
    expect(finance.body.view!.statementLines.length).toBe(5);

    const admin = await call(RECON as Handler, "daniel", q());
    expect(admin.body.canReconcile).toBe(true);

    const manager = await call(RECON as Handler, "nadia", q());
    expect(manager.status).toBe(200);
    expect(manager.body.canReconcile).toBe(false);
    expect(manager.body.view).toMatchObject({ detail: false, statementLines: [], bookLines: [], difference: "0.00" });
    expect(manager.body.view!.completed?.by).toBe("omid");

    const act = await call(ACT as Handler, "nadia", "", { action: "balance", bankAccountId: bank, month: "2026-10", balance: "1.00" });
    expect(act.status).toBe(403);
    const imp = await call(IMPORT as Handler, "nadia", "/import", { bankAccountId: bank, month: "2026-10", csv: "Date,Description,Amount\n2026-10-01,x,1", mapping: { headerRow: 0, date: 0, description: 1, amount: 2, dateFormat: "ymd" } });
    expect(imp.status).toBe(403);

    const donorView = await call(RECON as Handler, "elena", q());
    expect([403, 404]).toContain(donorView.status);
  });

  it("Finance imports through the route; a bad mapping is a plain refusal", async () => {
    const ok = await call(IMPORT as Handler, "yusuf", "/import", { bankAccountId: bank, month: "2026-10", csv: "Date,Description,Amount\n2026-10-01,Interest,1.25", mapping: { headerRow: 0, date: 0, description: 1, amount: 2, dateFormat: "ymd" } });
    expect(ok.status).toBe(200);
    expect(ok.body.added).toBe(1);
    const bad = await call(IMPORT as Handler, "yusuf", "/import", { bankAccountId: bank, month: "2026-10", csv: "Date,Description,Amount\n2026-10-01,Interest,1.25", mapping: { headerRow: 0, date: 0, description: 1, dateFormat: "ymd" } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/amount column/);
  });

  it("a bank account of another organization is not found", async () => {
    const [{ id: other }] = await db.insert(s.organizations).values({ name: "Other org (fictional)" }).returning();
    const e = await reconciliationView(other, bank, "2026-08").then(
      () => null,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(LedgerError);
    expect((e as LedgerError).code).toBe("not_found");
  });
});

describe("a cash box has no bank statement (code review of R2-24)", { timeout: 60_000 }, () => {
  it("completes on the counted balance, with no statement lines", async () => {
    const [{ id: cashLedger }] = await db.insert(s.ledgerAccounts).values({ organizationId: org, code: "1095", name: "Test cash box", type: "asset" }).returning();
    const [{ id: cash }] = await db.insert(s.bankAccounts).values({ organizationId: org, ledgerAccountId: cashLedger, name: "Test cash box", currency: "USD" }).returning();
    await postDonorReceipt({ organizationId: org, recordedBy: "yusuf", idempotencyKey: key() }, { date: "2026-10-02", memo: "Cash drawn", depositedTo: cashLedger, donorId: donor, projectId, currency: "USD", fxRate: "1", amount: "100.00" });
    await setStatementBalance({ organizationId: org, bankAccountId: cash, month: "2026-10", balance: "100.00", by: "yusuf" });
    expect(await refused(completeReconciliation({ organizationId: org, bankAccountId: cash, month: "2026-10", by: "peter", projectId }))).toMatch(/Import .*statement/);
    const { ACCOUNTS_KEY } = await import("@/lib/payment-accounts");
    await db.insert(s.organizationState).values({ organizationId: org, key: ACCOUNTS_KEY, data: { accounts: { [cash]: { type: "cash", owner: "ROP", signatories: ["yusuf"] } }, pending: [], history: [] } }).onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data: { accounts: { [cash]: { type: "cash", owner: "ROP", signatories: ["yusuf"] } }, pending: [], history: [] } } });
    const done = await completeReconciliation({ organizationId: org, bankAccountId: cash, month: "2026-10", by: "peter", projectId });
    expect(done.completedAt).toBeTruthy();
  });
});
