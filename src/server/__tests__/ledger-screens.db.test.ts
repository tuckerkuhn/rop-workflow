import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { GET as PAYMENTS, POST as PAY } from "@/app/api/projects/[code]/ledger/payments/route";
import { POST as DRAFT } from "@/app/api/projects/[code]/ledger/drafts/[id]/route";
import { GET as ENTRY } from "@/app/api/projects/[code]/ledger/entries/[id]/route";
import { POST as REVERSE } from "@/app/api/projects/[code]/ledger/entries/[id]/reverse/route";
import { GET as BVA } from "@/app/api/projects/[code]/ledger/budget-vs-actual/route";
import { POST as SETUP } from "@/app/api/projects/[code]/ledger/setup/route";
import type { SaveOutcome } from "@/lib/ledger/screens";
import { seedDatabase } from "@/server/demo-seed";
import { saveFile } from "@/server/hr-files";
import { projectByCode } from "@/server/field-store";
import type { BudgetActualView, EntryView, PaymentsView } from "@/server/ledger-view";
import { ready } from "@/server/__tests__/test-db";

/** Record a payment and Budget vs actual, through the routes the screens call. */
const code = "A-2027";
type Handler = (req: Request, ctx: never) => Promise<Response>;
const call = async <T,>(handler: Handler, as: string, url: string, params: Record<string, string>, body?: unknown) => {
  const init: RequestInit = { method: body === undefined ? "GET" : "POST", headers: { "x-demo-user": as, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  const res = await handler(new Request(`http://test/api/projects/${code}/ledger/${url}`, init), { params: Promise.resolve({ code, ...params }) } as never);
  return { status: res.status, body: (await res.json()) as T & { error?: string } };
};
const view = (as: string) => call<PaymentsView>(PAYMENTS as Handler, as, "payments", {});
const pay = (as: string, body: unknown) => call<SaveOutcome>(PAY as Handler, as, "payments", {}, body);
const bva = (as = "yusuf") => call<BudgetActualView>(BVA as Handler, as, "budget-vs-actual", {});
const draft = (as: string, id: string, action: "post" | "delete") => call<{ outcome: string }>(DRAFT as Handler, as, `drafts/${id}`, { id }, { action });
const entry = (as: string, id: string) => call<EntryView>(ENTRY as Handler, as, `entries/${id}`, { id });
const rev = (as: string, id: string, body: unknown) => call<SaveOutcome>(REVERSE as Handler, as, `entries/${id}/reverse`, { id }, body);

let lineId = "";
let paidFrom = "";
let receipt: { hash: string; name: string; type: string; size: number };
let n = 0;
const form = (amount: string, extra: Record<string, unknown> = {}) => ({
  idempotencyKey: `form-key-${++n}`,
  payee: "Kabul Seed Company (fictional)",
  what: "Wheat seed for the spring planting",
  budgetLineId: lineId,
  amount,
  currency: "USD",
  fxRate: "1",
  paidFrom,
  date: new Date().toISOString().slice(0, 10),
  receipt,
  ...extra,
});
const actualOn = (v: BudgetActualView, id: string) => v.rows.filter((r) => r.budgetLineId === id).reduce((a, r) => a + Number(r.actual), 0);

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  const project = await projectByCode(code);
  // The demo project's budget lines are loaded in setup; the test gives it one if it has none.
  const line = (await db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, project.id))).find((l) => l.kind === "program");
  lineId = line?.id ?? (await db.insert(s.budgetLines).values({ projectId: project.id, code: "T-1", description: "Seed", amount: "10000.00", currency: "USD", kind: "program" }).returning())[0].id;
  receipt = await saveFile(Buffer.from("%PDF-1.4 a fictional receipt"), "receipt.pdf", "application/pdf", "yusuf");
}, 120_000);

describe("the ledger screens", { timeout: 60_000 }, () => {
  it("seeds the chart on first load, and only Finance or an administrator sets up the bank and cash accounts", async () => {
    // The demo seed may already have made them (server/demo-ledger); the set-up then adds nothing.
    const first = await view("yusuf");
    expect(first.status).toBe(200);
    expect(Object.keys(first.body.chart).length).toBeGreaterThanOrEqual(22);
    expect((await call(SETUP as Handler, "farida", "setup", {}, {})).status).toBe(403);
    const made = await call<{ created: number }>(SETUP as Handler, "yusuf", "setup", {}, {});
    expect(made.status).toBe(200);
    expect(made.body.created).toBe(first.body.ready ? 0 : 2);
    expect((await call<{ created: number }>(SETUP as Handler, "yusuf", "setup", {}, {})).body.created).toBe(0);
    const after = await view("yusuf");
    expect(after.body.ready).toBe(true);
    expect(after.body.money.map((m) => m.code)).toEqual(expect.arrayContaining(["1000", "1010"]));
    paidFrom = after.body.money.find((m) => m.code === "1010")!.ledgerAccountId;
  });

  it("an organization with no bank or cash account gets them in one click", async () => {
    const [org] = await db.insert(s.organizations).values({ name: "Empty Books Org (fictional)" }).returning();
    const { ensureChart, moneyAccounts, setUpBankAndCash } = await import("@/server/ledger-setup");
    await ensureChart(org.id);
    expect(await moneyAccounts(org.id)).toHaveLength(0);
    expect((await setUpBankAndCash(org.id, "yusuf")).created).toBe(2);
    expect((await moneyAccounts(org.id)).map((m) => [m.code, m.currency])).toEqual([
      ["1000", "USD"],
      ["1010", "USD"],
    ]);
    expect((await setUpBankAndCash(org.id, "yusuf")).created).toBe(0);
  });

  it("a field agent cannot record a payment; a donor cannot read the books", async () => {
    expect((await pay("farida", form("10.00"))).status).toBe(403);
    expect((await view("elena")).status).toBe(403);
    expect((await bva("elena")).status).toBe(403);
  });

  it("records a payment: the entry is posted and budget vs actual moves", async () => {
    const before = actualOn((await bva()).body, lineId);
    const r = await pay("yusuf", form("120.50"));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ outcome: "posted", replayed: false });
    const e = await entry("nadia", r.body.entryId);
    expect(e.status).toBe(200);
    expect(e.body.entry).toMatchObject({ status: "posted", payee: "Kabul Seed Company (fictional)", what: "Wheat seed for the spring planting", amount: "120.50" });
    expect(e.body.lines).toHaveLength(2);
    expect(e.body.lines.map((l) => [l.code, l.functionalDebit, l.functionalCredit])).toEqual([
      ["5000", "120.50", "0.00"],
      ["1010", "0.00", "120.50"],
    ]);
    expect(actualOn((await bva()).body, lineId)).toBeCloseTo(before + 120.5, 2);

    const drill = await call<{ entries: { id: string; onLine: string; payee: string | null }[] }>(BVA as Handler, "nadia", `budget-vs-actual?line=${lineId}`, {});
    expect(drill.body.entries.find((x) => x.id === r.body.entryId)).toMatchObject({ onLine: "120.50", payee: "Kabul Seed Company (fictional)" });
  });

  it("the same form sent twice writes one entry", async () => {
    const f = form("33.00");
    const [a, b] = await Promise.all([pay("yusuf", f), pay("yusuf", f)]);
    const c = await pay("yusuf", f);
    expect(a.body.entryId).toBe(b.body.entryId);
    expect(c.body).toMatchObject({ entryId: a.body.entryId, replayed: true });
    const rows = await db.select().from(s.journalEntries).where(eq(s.journalEntries.idempotencyKey, `payment:yusuf:${f.idempotencyKey}`));
    expect(rows).toHaveLength(1);
  });

  it("over the limit it is kept as a draft: the recorder cannot post it, another finance person can", async () => {
    const before = actualOn((await bva()).body, lineId);
    const r = await pay("yusuf", form("900.00"));
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe("draft");
    expect(r.body.whoCanPost.length).toBeGreaterThan(0);
    expect(r.body.whoCanPost).not.toContain("Yusuf Mohammadi");
    expect(actualOn((await bva()).body, lineId)).toBeCloseTo(before, 2);

    // Finance sees it in Drafts to post; the recorder is not offered the Post button.
    const mine = (await view("yusuf")).body.drafts.find((d) => d.id === r.body.entryId)!;
    expect(mine.canPost).toBe(false);
    const theirs = (await view("omid")).body.drafts.find((d) => d.id === r.body.entryId)!;
    expect(theirs.canPost).toBe(true);
    // Someone without the finance role sees no drafts.
    expect((await view("nadia")).body.drafts).toHaveLength(0);

    const refused = await draft("yusuf", r.body.entryId, "post");
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/someone other than/);
    expect((await draft("nadia", r.body.entryId, "post")).status).toBe(403);
    const posted = await draft("omid", r.body.entryId, "post");
    expect(posted.status).toBe(200);
    expect(actualOn((await bva()).body, lineId)).toBeCloseTo(before + 900, 2);
  });

  it("reversing an entry takes it back out of budget vs actual, once", async () => {
    const r = await pay("yusuf", form("75.25"));
    const before = actualOn((await bva()).body, lineId);
    const x = await rev("yusuf", r.body.entryId, { idempotencyKey: "rev-key-1", reason: "Paid twice by mistake" });
    expect(x.status).toBe(200);
    expect(x.body.outcome).toBe("posted");
    expect(actualOn((await bva()).body, lineId)).toBeCloseTo(before - 75.25, 2);
    const e = await entry("yusuf", r.body.entryId);
    expect(e.body.entry).toMatchObject({ reversedBy: x.body.entryId, canReverse: false });
    const again = await rev("yusuf", r.body.entryId, { idempotencyKey: "rev-key-2", reason: "Again" });
    expect(again.status).toBe(409);
    expect((await rev("farida", r.body.entryId, { idempotencyKey: "rev-key-3", reason: "Not mine" })).status).toBe(403);
  });

  it("refuses a budget line or account from elsewhere, and a receipt that was never uploaded", async () => {
    expect((await pay("yusuf", form("10.00", { budgetLineId: "00000000-0000-4000-8000-000000000000" }))).status).toBe(400);
    expect((await pay("yusuf", form("10.00", { paidFrom: "00000000-0000-4000-8000-000000000000" }))).status).toBe(400);
    expect((await pay("yusuf", form("10.00", { receipt: { ...receipt, hash: "a".repeat(64) } }))).status).toBe(400);
  });
});
