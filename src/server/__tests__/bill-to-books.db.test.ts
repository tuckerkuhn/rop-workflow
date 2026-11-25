import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { GET, POST } from "@/app/api/projects/[code]/bills/route";
import type { BillsView } from "@/app/api/projects/[code]/bills/route";
import { POST as DRAFT } from "@/app/api/projects/[code]/ledger/drafts/[id]/route";
import { GET as ENTRY } from "@/app/api/projects/[code]/ledger/entries/[id]/route";
import { POST as REVERSE } from "@/app/api/projects/[code]/ledger/entries/[id]/reverse/route";
import { userById } from "@/lib/demo";
import type { SaveOutcome } from "@/lib/ledger/screens";
import { loadBills, saveBills } from "@/server/bills-store";
import { seedDatabase } from "@/server/demo-seed";
import { projectByCode } from "@/server/field-store";
import { loadHome } from "@/server/home-store";
import { hrBook } from "@/server/hr-store";
import { lockPeriod } from "@/server/ledger";
import type { EntryView } from "@/server/ledger-view";
import { loadBudget } from "@/server/plan-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * A filed bill reaches the books when Finance posts it (decision AI, 25 Nov 2026). The entry
 * arrives filled in from the bill, it posts once, the ledger's own rules stand, each is found
 * from the other and a reversed entry leaves nothing wrong behind.
 */
const code = "A-2027";
const yusuf = userById("yusuf")!;
const omid = userById("omid")!;
const karim = userById("karim")!;
const nadia = userById("nadia")!;
const bytes = Buffer.from("a fictional bill for the books");
const hash = createHash("sha256").update(bytes).digest("hex");
const file = { hash, name: "internet-bill.jpg", type: "image/jpeg", size: bytes.length };
const today = new Date().toISOString().slice(0, 10);
const SP = "https://rootsofpeace.sharepoint.com/sites/x/v.pdf";

const ctx = { params: Promise.resolve({ code }) };
const post = async (u: { id: string }, body: unknown) => {
  const res = await POST(new Request(`http://test/api/projects/${code}/bills`, { method: "POST", headers: { "x-demo-user": u.id, "Content-Type": "application/json" }, body: JSON.stringify(body) }), ctx);
  return { status: res.status, body: (await res.json()) as BillsView & { error?: string } };
};
const view = async (u: { id: string }) => (await (await GET(new Request(`http://test/api/projects/${code}/bills`, { headers: { "x-demo-user": u.id } }), ctx)).json()) as BillsView;
const bill = async (u: { id: string }, id: string) => (await view(u)).items.find((b) => b.id === id)!;
type Handler = (req: Request, ctx: never) => Promise<Response>;
const ledger = async <T,>(handler: Handler, as: string, params: Record<string, string>, body?: unknown) => {
  const res = await handler(new Request("http://test/ledger", { method: body === undefined ? "GET" : "POST", headers: { "x-demo-user": as, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({ code, ...params }) } as never);
  return { status: res.status, body: (await res.json()) as T & { error?: string } };
};
const spentOn = async (line: string) => (await loadBudget(code)).lines.find((l) => l.code === line)?.spent ?? 0;
const oldSpent = async (line: string) => {
  const project = await projectByCode(code);
  const rows = await db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, project.id));
  return Number(rows.find((l) => l.code === line)?.spent ?? 0);
};
const entriesOf = async (billId: string) => db.select().from(s.journalEntries).where(eq(s.journalEntries.sourceId, `${code}:${billId}`));

let n = 0;
/** A fictional bill taken to "filed": recorded by one person, approved by karim, voucher by yusuf. */
async function filed(over: Record<string, unknown> = {}, by = yusuf) {
  n += 1;
  const r = await post(by, { action: "raise", payee: "Kabul Net (fictional)", invoiceNumber: `KN-${2000 + n}`, invoiceDate: "2026-11-20", description: "Office internet, November", category: "internet", amount: 120, currency: "USD", source: code, budgetLine: "5.2", contractRef: null, file, ...over });
  expect(r.status).toBe(200);
  const id = r.body.items[0].id;
  expect((await post(karim, { action: "approve", id })).status).toBe(200);
  expect((await post(yusuf, { action: "voucher", id, number: `VB-${n}`, month: "2026-11", sharepointUrl: SP, netsuiteRef: `NS-${n}` })).status).toBe(200);
  return id;
}

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  await db.insert(s.hrFiles).values({ hash, book: hrBook(), name: file.name, type: file.type, size: file.size, data: bytes, uploadedBy: yusuf.id });
});

describe("a filed bill and the books", () => {
  let id = "";
  let entryId = "";
  let before = 0;

  it("does not go to the books before its voucher is filed, and nothing posts by itself", async () => {
    const r = await post(yusuf, { action: "raise", payee: "Kabul Net (fictional)", invoiceNumber: "KN-1999", invoiceDate: "2026-11-20", description: "Office internet, October", category: "internet", amount: 110, currency: "USD", source: code, budgetLine: "5.2", contractRef: null, file });
    const waiting = r.body.items[0].id;
    expect((await post(omid, { action: "post", id: waiting, date: today, paidFrom: "1010" })).status).toBe(409);
    before = await spentOn("5.2");
    id = await filed();
    // Filing the voucher wrote nothing to the books.
    expect(await spentOn("5.2")).toBe(before);
    expect(await entriesOf(id)).toHaveLength(0);
  });

  it("gives Finance an entry filled in from the bill: who was paid, the line, the day the voucher was filed and the amount", async () => {
    const b = await bill(omid, id);
    expect(b.books).toMatchObject({ goes: true, canPost: true, standing: null, entry: { payee: "Kabul Net (fictional)", project: code, budgetLine: "5.2", budgetLineName: "Office and communications", date: today, amount: 120, currency: "USD", usd: 120 } });
    expect(b.books!.entry.what).toContain("Office internet, November");
    // The accounts to pay from come with it, so nothing is looked up elsewhere.
    expect((await view(omid)).accounts[code].map((a) => a.code)).toContain("1010");
    // People outside Finance are told who posts it.
    const forKarim = await bill(karim, id);
    expect(forKarim.books).toMatchObject({ canPost: false, whyNot: "Finance posts it to the books." });
    expect((await post(karim, { action: "post", id, date: today, paidFrom: "1010" })).status).toBe(403);
    expect((await post(nadia, { action: "post", id, date: today, paidFrom: "1010" })).status).toBe(403);
  });

  it("is on Finance's Home until it is posted", async () => {
    const row = (await loadHome(code, omid)).actions.find((a) => a.key === "bills-post");
    expect(row?.text).toBe("Post the bill from Kabul Net (fictional) to the books");
    expect(row?.href).toBe("/work/bills");
    expect((await loadHome(code, nadia)).actions.find((a) => a.key === "bills-post")).toBeUndefined();
  });

  it("posts with one press, to the bill's own budget line, and counts as spent", async () => {
    const r = await post(omid, { action: "post", id, date: today, paidFrom: "1010" });
    expect(r.status).toBe(200);
    const b = r.body.items.find((x) => x.id === id)!;
    expect(b.books!.standing).toMatchObject({ n: 1, date: today, paidFrom: "1010", budgetLine: "5.2", amount: "120.00", currency: "USD", by: "omid" });
    expect(b.books!.canPost).toBe(false);
    entryId = b.books!.standing!.entryId;
    expect(await spentOn("5.2")).toBe(before + 120);
    const [e] = await entriesOf(id);
    expect(e).toMatchObject({ id: entryId, status: "posted", sourceType: "bill", kind: "payment", recordedBy: "yusuf", postedBy: "omid", entryDate: today, memo: expect.stringContaining("Kabul Net (fictional): Office internet, November") });
    const lines = await db.select().from(s.journalLines).where(eq(s.journalLines.entryId, entryId));
    const project = await projectByCode(code);
    const [line] = (await db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, project.id))).filter((l) => l.code === "5.2");
    expect(lines.find((l) => Number(l.debit) > 0)).toMatchObject({ budgetLineId: line.id, debit: "120.00" });
    expect((await loadHome(code, omid)).actions.find((a) => a.key === "bills-post")).toBeUndefined();
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "bill_posted_to_books"));
    expect(audit).toHaveLength(1);
    expect(audit[0].detail).toMatchObject({ bill: id, entry: entryId, budgetLine: "5.2" });
  });

  it("cannot be posted twice: a second press, and a press after its record on the bill was lost, write nothing", async () => {
    expect((await post(omid, { action: "post", id, date: today, paidFrom: "1000" })).status).toBe(200);
    expect(await entriesOf(id)).toHaveLength(1);
    // The entry was written and the bill's own record of it was lost: the next press finds the entry.
    const book = await loadBills(code);
    book.items.find((x) => x.id === id)!.postings = [];
    await saveBills(code, book);
    const again = await post(yusuf, { action: "post", id, date: "2026-11-21", paidFrom: "1000" });
    expect(again.status).toBe(200);
    expect(await entriesOf(id)).toHaveLength(1);
    expect(again.body.items.find((x) => x.id === id)!.books!.standing).toMatchObject({ entryId, date: today, paidFrom: "1010" });
    expect(await spentOn("5.2")).toBe(before + 120);
    expect(await db.select().from(s.auditLog).where(eq(s.auditLog.action, "bill_posted_to_books"))).toHaveLength(1);
  });

  it("is found from the books, and the entry is found from the bill", async () => {
    const e = await ledger<EntryView>(ENTRY as Handler, "omid", { id: entryId });
    expect(e.status).toBe(200);
    expect(e.body.entry.from).toEqual({ kind: "bill", id, project: code, href: `/work/bills?project=${code}&open=${id}` });
    expect(e.body.entry).toMatchObject({ payee: "Kabul Net (fictional)", sourceType: "bill" });
    expect((await bill(nadia, id)).books!.standing!.entryId).toBe(entryId);
  });

  it("a wrong entry is reversed and a corrected one posted: nothing is deleted and nothing wrong is left", async () => {
    const old52 = await oldSpent("5.2");
    const r = await ledger<SaveOutcome>(REVERSE as Handler, "omid", { id: entryId }, { idempotencyKey: "rev-key-0001", reason: "Charged to the wrong line" });
    expect(r.body).toMatchObject({ outcome: "posted" });
    expect(await spentOn("5.2")).toBe(before);
    expect(await oldSpent("5.2")).toBe(old52 - 120);
    const b = await bill(omid, id);
    expect(b.books).toMatchObject({ standing: null, canPost: true });
    expect(b.books!.reversed).toHaveLength(1);
    expect(b.books!.reversed[0].reversal).toMatchObject({ posted: true, by: "Omid Rahmani", reason: "Charged to the wrong line" });
    // The corrected entry goes to another line. The first press's line cannot be changed that way.
    const before51 = await spentOn("5.1");
    const c = await post(omid, { action: "post", id, date: today, paidFrom: "1010", budgetLine: "5.1" });
    expect(c.status).toBe(200);
    expect(c.body.items.find((x) => x.id === id)!.books!.standing).toMatchObject({ n: 2, budgetLine: "5.1" });
    expect(await spentOn("5.1")).toBe(before51 + 120);
    expect(await spentOn("5.2")).toBe(before);
    // Three entries for the bill's money: the first, its reversal and the corrected one. All posted, none deleted.
    const mine = await entriesOf(id);
    expect(mine).toHaveLength(2);
    const reversals = await db.select().from(s.journalEntries).where(eq(s.journalEntries.reversesId, entryId));
    expect(reversals).toHaveLength(1);
    // The expenditures table adds up to what was spent: +120, -120, +120.
    const ids = [...mine.map((e) => e.idempotencyKey), reversals[0].idempotencyKey].map((k) => k.replace("expenditure:", ""));
    const rows = await db.select().from(s.expenditures).where(inArray(s.expenditures.id, ids));
    expect(rows.map((x) => Number(x.amount)).sort((a, b) => a - b)).toEqual([-120, 120, 120]);
  });
});

describe("the ledger's own rules stand for a bill", () => {
  it("over the limit, the person who recorded the bill does not post it, and a second person does", async () => {
    const id = await filed({ amount: 900, description: "Office rent, November", category: "rent", contractRef: "Lease 2026-01" });
    // The bill says so before the press, with who can post it.
    const mine = await bill(yusuf, id);
    expect(mine.books).toMatchObject({ canPost: false, second: { limit: "USD 500.00" } });
    expect(mine.books!.second!.who).toContain("Omid Rahmani");
    expect((await bill(omid, id)).books).toMatchObject({ canPost: true, second: null });
    const refused = await post(yusuf, { action: "post", id, date: today, paidFrom: "1010" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/over USD 500\.00, so someone in Finance other than the person who recorded it posts it to the books/);
    expect(await entriesOf(id)).toHaveLength(0);
    expect((await post(omid, { action: "post", id, date: today, paidFrom: "1010" })).status).toBe(200);
    expect(await entriesOf(id)).toHaveLength(1);
  });

  it("under the limit, the Finance person who recorded the bill posts it", async () => {
    const id = await filed({ amount: 80 });
    expect((await post(yusuf, { action: "post", id, date: today, paidFrom: "1000" })).status).toBe(200);
    expect((await bill(yusuf, id)).books!.standing).toMatchObject({ paidFrom: "1000", by: "yusuf" });
  });

  it("nothing posts into a locked month, and the bill stays out of the books until it is dated in an open one", async () => {
    const project = await projectByCode(code);
    await lockPeriod(project.organizationId, "2026-09-01", "omid");
    const id = await filed({ amount: 60, invoiceDate: "2026-09-10" });
    const before = await spentOn("5.2");
    const refused = await post(omid, { action: "post", id, date: "2026-09-12", paidFrom: "1010" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/September 2026 is locked/);
    expect(await entriesOf(id)).toHaveLength(0);
    expect(await spentOn("5.2")).toBe(before);
    expect((await bill(omid, id)).books!.standing).toBeNull();
    expect((await post(omid, { action: "post", id, date: today, paidFrom: "1010" })).status).toBe(200);
    expect(await spentOn("5.2")).toBe(before + 60);
  });

  it("a date after today is refused", async () => {
    const id = await filed({ amount: 20 });
    expect((await post(omid, { action: "post", id, date: "2099-01-01", paidFrom: "1010" })).status).toBe(400);
    expect(await entriesOf(id)).toHaveLength(0);
  });

  it("a reversal over the limit waits for a second person, and takes the amount off only when it is posted", async () => {
    const id = await filed({ amount: 700, description: "Generator service, November", category: "maintenance", contractRef: "Agreement 2026-07" });
    expect((await post(omid, { action: "post", id, date: today, paidFrom: "1010" })).status).toBe(200);
    const entryId = (await bill(omid, id)).books!.standing!.entryId;
    const old = await oldSpent("5.2");
    const now = await spentOn("5.2");
    const r = await ledger<SaveOutcome>(REVERSE as Handler, "omid", { id: entryId }, { idempotencyKey: "rev-key-0002", reason: "Paid from the wrong account" });
    expect(r.body).toMatchObject({ outcome: "draft" });
    // Still in the books, and the bill says a reversal waits. It cannot be posted again meanwhile.
    expect(await oldSpent("5.2")).toBe(old);
    expect(await spentOn("5.2")).toBe(now);
    const waiting = await bill(omid, id);
    expect(waiting.books!.standing!.reversal).toMatchObject({ posted: false });
    expect(waiting.books!.canPost).toBe(false);
    const posted = await ledger<{ outcome: string }>(DRAFT as Handler, "yusuf", { id: r.body.entryId }, { action: "post" });
    expect(posted.body).toMatchObject({ outcome: "posted" });
    expect(await oldSpent("5.2")).toBe(old - 700);
    expect(await spentOn("5.2")).toBe(now - 700);
    expect((await bill(omid, id)).books).toMatchObject({ standing: null, canPost: true });
  });
});

describe("bills the books do not take as they are", () => {
  it("an afghani bill paid from a dollar account is written in dollars at the rate recorded on the bill", async () => {
    const id = await filed({ amount: 4200, currency: "AFN", description: "Mobile top-up, November", category: "mobile" });
    const b = await bill(omid, id);
    expect(b.books!.entry).toMatchObject({ amount: 4200, currency: "AFN", usd: 60 });
    const before = await spentOn("5.2");
    expect((await post(omid, { action: "post", id, date: today, paidFrom: "1010" })).status).toBe(200);
    expect((await bill(omid, id)).books!.standing).toMatchObject({ amount: "60.00", currency: "USD" });
    expect(await spentOn("5.2")).toBe(before + 60);
    const [e] = await entriesOf(id);
    expect(e.memo).toContain("AFN 4,200 at the rate recorded");
  });

  it("a general and admin bill goes to the organization's general and admin account, on no project (AN)", async () => {
    const id = await filed({ source: "non-contract", budgetLine: null, amount: 40 });
    const before = await spentOn("5.2");
    const b = await bill(omid, id);
    expect(b.books).toMatchObject({ goes: true, canPost: true, entry: { budgetLine: "", project: code, amount: 40 } });
    expect(b.books!.entry.budgetLineName).toContain("7000");
    const r = await post(omid, { action: "post", id, date: today, paidFrom: "1010" });
    expect(r.status).toBe(200);
    expect((await bill(omid, id)).books!.standing).toMatchObject({ budgetLine: "", amount: "40.00", currency: "USD", by: "omid" });
    const [e] = await entriesOf(id);
    expect(e).toMatchObject({ status: "posted", sourceType: "bill", projectId: null, recordedBy: "yusuf", postedBy: "omid" });
    const lines = await db.select().from(s.journalLines).where(eq(s.journalLines.entryId, e.id));
    const debit = lines.find((l) => Number(l.debit) > 0)!;
    const [acct] = await db.select().from(s.ledgerAccounts).where(eq(s.ledgerAccounts.id, debit.accountId));
    expect(acct.code).toBe("7000");
    expect(debit.budgetLineId).toBeNull();
    // No project's budget line is charged.
    expect(await spentOn("5.2")).toBe(before);
    // Pressing again posts nothing new.
    expect((await post(omid, { action: "post", id, date: today, paidFrom: "1010" })).status).toBe(200);
    expect(await entriesOf(id)).toHaveLength(1);
  });
});
