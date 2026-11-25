import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { GET, POST } from "@/app/api/projects/[code]/procurements/books/route";
import type { PurchaseBooksView } from "@/app/api/projects/[code]/procurements/books/route";
import { POST as DRAFT } from "@/app/api/projects/[code]/ledger/drafts/[id]/route";
import { GET as ENTRY } from "@/app/api/projects/[code]/ledger/entries/[id]/route";
import { POST as REVERSE } from "@/app/api/projects/[code]/ledger/entries/[id]/reverse/route";
import { userById } from "@/lib/demo";
import type { SaveOutcome } from "@/lib/ledger/screens";
import { closeInstalment } from "@/lib/payments";
import { PURCHASE_BOOKS_KEY } from "@/server/books-posting";
import { seedDatabase } from "@/server/demo-seed";
import { projectByCode } from "@/server/field-store";
import { loadHome } from "@/server/home-store";
import type { EntryView } from "@/server/ledger-view";
import { loadBudget } from "@/server/plan-store";
import { loadProcurements, saveProcurements } from "@/server/procurement-store";
import { saveProjectState } from "@/server/project-state";
import { ready } from "@/server/__tests__/test-db";

/**
 * A purchase recorded as paid reaches the books when Finance posts it (decision AI, 25 Nov 2026).
 * The entry arrives filled in from the purchase, it posts once, the ledger's own rules stand,
 * each is found from the other and a reversed entry leaves nothing wrong behind.
 */
const code = "A-2027";
const yusuf = userById("yusuf")!;
const omid = userById("omid")!;
const zahra = userById("zahra")!;
const today = new Date().toISOString().slice(0, 10);
const ID = "PR-2027-009";

const ctx = { params: Promise.resolve({ code }) };
const view = async (u: { id: string }) => (await (await GET(new Request(`http://test/api/projects/${code}/procurements/books?purchase=${ID}`, { headers: { "x-demo-user": u.id } }), ctx)).json()) as PurchaseBooksView;
const post = async (u: { id: string }, body: unknown) => {
  const res = await POST(new Request(`http://test/api/projects/${code}/procurements/books`, { method: "POST", headers: { "x-demo-user": u.id, "Content-Type": "application/json" }, body: JSON.stringify(body) }), ctx);
  return { status: res.status, body: (await res.json()) as PurchaseBooksView & { error?: string } };
};
type Handler = (req: Request, ctx: never) => Promise<Response>;
const ledger = async <T,>(handler: Handler, as: string, params: Record<string, string>, body?: unknown) => {
  const res = await handler(new Request("http://test/ledger", { method: body === undefined ? "GET" : "POST", headers: { "x-demo-user": as, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({ code, ...params }) } as never);
  return { status: res.status, body: (await res.json()) as T & { error?: string } };
};
const spentOn = async (line: string) => (await loadBudget(code)).lines.find((l) => l.code === line)?.spent ?? 0;
const entriesOf = async (n: number) => db.select().from(s.journalEntries).where(eq(s.journalEntries.sourceId, `${code}:${ID}#${n}`));

/** Records the instalment under way as paid, as the "Record the payment" step files it. Fictional. */
async function recordPaid(invoice?: Record<string, unknown>) {
  const p = (await loadProcurements(code)).find((x) => x.id === ID)!;
  const filed = closeInstalment({ ...p, step: "paid", ...(invoice ? { invoice: { ...p.invoice!, ...invoice } } : {}), paid: { date: today, ref: "TT-0091 (fictional)" } });
  await saveProcurements(code, [{ ...filed, step: "close", timeline: [...p.timeline, { date: today, who: "finance", what: "Paid; invoice marked paid", by: yusuf.name }] }]);
}

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
});

describe("a purchase recorded as paid and the books", () => {
  let entryId = "";
  let before = 0;

  it("has nothing to post before its payment is recorded", async () => {
    expect((await view(omid)).payments).toHaveLength(0);
    expect((await post(omid, { purchase: ID, n: 1, date: today, paidFrom: "1010" })).status).toBe(404);
    before = await spentOn("2.3");
  });

  it("gives Finance an entry filled in from the purchase, and recording it as paid posted nothing", async () => {
    await recordPaid();
    expect(await spentOn("2.3")).toBe(before);
    const v = await view(omid);
    expect(v.payments).toHaveLength(1);
    expect(v.payments[0]).toMatchObject({ purchase: ID, n: 1, goes: true, canPost: true, standing: null, entry: { payee: "FarmTools Co. (fictional)", project: code, budgetLine: "2.3", budgetLineName: "Crop protection equipment", date: today, amount: 7800, currency: "USD", usd: 7800 } });
    expect(v.payments[0].entry.what).toContain("Knapsack sprayers");
    expect(v.payments[0].entry.what).toContain("FT-0118");
    expect(v.accounts.map((a) => a.code)).toContain("1010");
    // Procurement staff read it and are told who posts.
    expect((await view(zahra)).payments[0]).toMatchObject({ canPost: false, whyNot: "Finance posts it to the books." });
    expect((await post(zahra, { purchase: ID, n: 1, date: today, paidFrom: "1010" })).status).toBe(403);
  });

  it("is on Finance's Home until it is posted", async () => {
    const row = (await loadHome(code, omid)).actions.find((a) => a.key === "purchases-post");
    expect(row?.text).toBe("Post the payment to FarmTools Co. (fictional) to the books");
    expect(row?.href).toBe(`/work?source=procurement&open=${ID}&project=${code}`);
    expect((await loadHome(code, zahra)).actions.find((a) => a.key === "purchases-post")).toBeUndefined();
  });

  it("over the limit, the person who recorded the payment does not post it", async () => {
    const mine = (await view(yusuf)).payments[0];
    expect(mine).toMatchObject({ canPost: false, second: { limit: "USD 500.00" } });
    const refused = await post(yusuf, { purchase: ID, n: 1, date: today, paidFrom: "1010" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/someone in Finance other than the person who recorded it/);
    expect(await entriesOf(1)).toHaveLength(0);
  });

  it("posts with one press to the purchase's own budget line and counts as spent", async () => {
    const r = await post(omid, { purchase: ID, n: 1, date: today, paidFrom: "1010" });
    expect(r.status).toBe(200);
    expect(r.body.payments[0].standing).toMatchObject({ n: 1, date: today, paidFrom: "1010", budgetLine: "2.3", amount: "7800.00", currency: "USD", by: "omid" });
    entryId = r.body.payments[0].standing!.entryId;
    expect(await spentOn("2.3")).toBe(before + 7800);
    const [e] = await entriesOf(1);
    expect(e).toMatchObject({ id: entryId, status: "posted", sourceType: "purchase", recordedBy: "yusuf", postedBy: "omid", entryDate: today });
    expect((await loadHome(code, omid)).actions.find((a) => a.key === "purchases-post")).toBeUndefined();
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "purchase_posted_to_books"));
    expect(audit).toHaveLength(1);
    expect(audit[0].detail).toMatchObject({ purchase: ID, payment: 1, entry: entryId });
  });

  it("cannot be posted twice, also when its record of the posting was lost", async () => {
    expect((await post(omid, { purchase: ID, n: 1, date: today, paidFrom: "1000" })).status).toBe(200);
    await saveProjectState((await projectByCode(code)).id, PURCHASE_BOOKS_KEY, { postings: {} });
    const again = await post(omid, { purchase: ID, n: 1, date: today, paidFrom: "1000" });
    expect(again.body.payments[0].standing).toMatchObject({ entryId, paidFrom: "1010" });
    expect(await entriesOf(1)).toHaveLength(1);
    expect(await spentOn("2.3")).toBe(before + 7800);
    expect(await db.select().from(s.auditLog).where(eq(s.auditLog.action, "purchase_posted_to_books"))).toHaveLength(1);
  });

  it("is found from the books, and the entry is found from the purchase", async () => {
    const e = await ledger<EntryView>(ENTRY as Handler, "omid", { id: entryId });
    expect(e.body.entry.from).toEqual({ kind: "purchase", id: `${ID}#1`, project: code, href: `/work?source=procurement&open=${ID}&project=${code}` });
    expect(e.body.entry.payee).toBe("FarmTools Co. (fictional)");
    expect((await view(zahra)).payments[0].standing!.entryId).toBe(entryId);
  });

  it("a wrong entry is reversed by two people and a corrected one posted to another line", async () => {
    const r = await ledger<SaveOutcome>(REVERSE as Handler, "omid", { id: entryId }, { idempotencyKey: "rev-key-p001", reason: "Charged to the wrong line" });
    expect(r.body).toMatchObject({ outcome: "draft" });
    expect(await spentOn("2.3")).toBe(before + 7800);
    expect((await view(omid)).payments[0]).toMatchObject({ canPost: false, standing: { reversal: { posted: false } } });
    expect((await ledger<{ outcome: string }>(DRAFT as Handler, "yusuf", { id: r.body.entryId }, { action: "post" })).body).toMatchObject({ outcome: "posted" });
    expect(await spentOn("2.3")).toBe(before);
    const open = (await view(omid)).payments[0];
    expect(open).toMatchObject({ standing: null, canPost: true });
    expect(open.reversed).toHaveLength(1);
    const before22 = await spentOn("2.2");
    const c = await post(omid, { purchase: ID, n: 1, date: today, paidFrom: "1010", budgetLine: "2.2" });
    expect(c.status).toBe(200);
    expect(c.body.payments[0].standing).toMatchObject({ n: 2, budgetLine: "2.2" });
    expect(await spentOn("2.2")).toBe(before22 + 7800);
    expect(await spentOn("2.3")).toBe(before);
    // Nothing deleted: the first entry, its reversal and the corrected entry are all posted.
    expect((await entriesOf(1)).every((e) => e.status === "posted")).toBe(true);
    expect(await entriesOf(1)).toHaveLength(2);
  });
});
