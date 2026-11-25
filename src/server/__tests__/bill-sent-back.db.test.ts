import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { db, schema as s } from "@/db";
import { GET, POST } from "@/app/api/projects/[code]/bills/route";
import type { BillsView } from "@/app/api/projects/[code]/bills/route";
import { billFlags, redoneAs, toCorrect, type Bill } from "@/lib/bills";
import { userById } from "@/lib/demo";
import { loadBills } from "@/server/bills-store";
import { seedDatabase } from "@/server/demo-seed";
import { loadHome } from "@/server/home-store";
import { hrBook } from "@/server/hr-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * A bill paid directly reaches the people who act on it. A bill waiting for approval is on the
 * approver's Home. A bill sent back is on the Home of the person who records bills, and they
 * correct it and record it again from what was recorded, with the same document.
 */
const code = "A-2027";
const yusuf = userById("yusuf")!;
const karim = userById("karim")!;
const nadia = userById("nadia")!;
const bytes = Buffer.from("a fictional bill");
const hash = createHash("sha256").update(bytes).digest("hex");
const file = { hash, name: "internet-bill.jpg", type: "image/jpeg", size: bytes.length };
const raise = { action: "raise", payee: "Kabul Net (fictional)", invoiceNumber: "KN-1101", invoiceDate: "2026-11-20", description: "Office internet, November", category: "rent", amount: 4200, currency: "AFN", source: "non-contract", budgetLine: null, contractRef: null, file };

const ctx = { params: Promise.resolve({ code }) };
const post = async (u: { id: string }, body: unknown) => {
  const res = await POST(new Request(`http://test/api/projects/${code}/bills`, { method: "POST", headers: { "x-demo-user": u.id, "Content-Type": "application/json" }, body: JSON.stringify(body) }), ctx);
  return { status: res.status, body: (await res.json()) as BillsView & { error?: string } };
};
const view = async (u: { id: string }) => (await (await GET(new Request(`http://test/api/projects/${code}/bills`, { headers: { "x-demo-user": u.id } }), ctx)).json()) as BillsView;
const homeRow = async (u: typeof yusuf, key: string) => (await loadHome(code, u)).actions.find((a) => a.key === key);

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  await db.insert(s.hrFiles).values({ hash, book: hrBook(), name: file.name, type: file.type, size: file.size, data: bytes, uploadedBy: yusuf.id });
});

describe("a bill waiting for approval", () => {
  it("is on the approver's Home, and not on the Home of the person who recorded it", async () => {
    expect(await homeRow(karim, "bills-approve")).toBeUndefined();
    const r = await post(yusuf, raise);
    expect(r.status).toBe(200);
    const row = await homeRow(karim, "bills-approve");
    expect(row?.text).toBe("Approve the bill from Kabul Net (fictional)");
    expect(row?.bucket).toBe("approve");
    expect(row?.href).toBe("/work/bills");
    expect(await homeRow(yusuf, "bills-approve")).toBeUndefined();
    // A budget holder approves no bills and records none.
    expect(await homeRow(nadia, "bills-approve")).toBeUndefined();
  });
});

describe("a bill sent back", () => {
  it("is on the Home of the person who records bills, with what to do", async () => {
    const r = await post(karim, { action: "return", id: "BL-001", note: "This is internet, not rent." });
    expect(r.status).toBe(200);
    expect(await homeRow(karim, "bills-approve")).toBeUndefined();
    const row = await homeRow(yusuf, "bills-correct");
    expect(row?.text).toBe("Correct the bill from Kabul Net (fictional) that was sent back and record it again");
    expect(row?.bucket).toBe("fix");
    expect(await homeRow(karim, "bills-correct")).toBeUndefined();
    expect(await homeRow(nadia, "bills-correct")).toBeUndefined();
  });

  it("can be recorded again by the people who record bills, and by nobody else", async () => {
    expect((await view(yusuf)).items.find((b) => b.id === "BL-001")).toMatchObject({ status: "returned", canRedo: true, redoneAs: null });
    expect((await view(karim)).items.find((b) => b.id === "BL-001")).toMatchObject({ canRedo: false });
    expect((await post(nadia, { ...raise, category: "internet" })).status).toBe(403);
  });

  it("is recorded again from the same document with no warning of a second payment, and the first is closed", async () => {
    const r = await post(yusuf, { ...raise, category: "internet", source: code, budgetLine: "5.2" });
    expect(r.status).toBe(200);
    const [again, first] = r.body.items;
    expect(again).toMatchObject({ id: "BL-002", status: "waiting", category: "internet", budgetLine: "5.2", flags: [] });
    expect(again.file.hash).toBe(hash);
    expect(first).toMatchObject({ id: "BL-001", status: "returned", canRedo: false, redoneAs: "BL-002", flags: [] });
    expect(await homeRow(yusuf, "bills-correct")).toBeUndefined();
    expect((await homeRow(karim, "bills-approve"))?.text).toBe("Approve the bill from Kabul Net (fictional)");
    // The bill sent back is kept as it was recorded.
    const kept = (await loadBills(code)).items[0];
    expect(kept).toMatchObject({ id: "BL-001", category: "rent", source: "non-contract" });
    expect(kept.returned?.note).toBe("This is internet, not rent.");
  });

  it("still warns when a bill that was not sent back is recorded twice", async () => {
    const r = await post(yusuf, { ...raise, category: "internet", source: code, budgetLine: "5.2" });
    expect(r.body.items[0].flags).toEqual(["The same payee and invoice number as BL-002: possibly paid twice.", "The same document as BL-002."]);
  });
});

describe("the rules for a bill sent back", () => {
  const bill = (id: string, status: Bill["status"], over: Partial<Bill> = {}): Bill => ({ id, payee: "Kabul Net", invoiceNumber: "KN-1", invoiceDate: "2026-11-20", description: "Internet", category: "internet", amount: 10, currency: "USD", usd: 10, source: "non-contract", budgetLine: null, contractRef: null, file: { hash: id.padEnd(64, "0"), name: "a.jpg", type: "image/jpeg", size: 1 }, raised: { by: "yusuf", name: "Yusuf", at: "2026-11-20" }, status, timeline: [], ...over });

  it("counts a bill as replaced by a later one for the same invoice or the same document", () => {
    const back = bill("BL-001", "returned");
    expect(redoneAs(back, [back])).toBeNull();
    expect(toCorrect([back])).toEqual([back]);
    const sameInvoice = bill("BL-002", "waiting", { invoiceNumber: "kn 1" });
    expect(redoneAs(back, [back, sameInvoice])).toBe("BL-002");
    const sameFile = bill("BL-003", "waiting", { payee: "Kabul Net Ltd", file: back.file });
    expect(redoneAs(back, [back, sameFile])).toBe("BL-003");
    expect(toCorrect([back, sameFile])).toEqual([]);
  });

  it("counts the bill recorded again in its place, even with another document and invoice number", () => {
    const back = bill("BL-001", "returned");
    const fixed = bill("BL-002", "waiting", { invoiceNumber: "KN-2", replaces: "BL-001" });
    const unrelated = bill("BL-003", "waiting", { invoiceNumber: "KN-2" });
    expect(redoneAs(back, [back, fixed])).toBe("BL-002");
    expect(toCorrect([back, unrelated])).toEqual([back]);
    expect(toCorrect([back, fixed])).toEqual([]);
  });

  it("does not count an earlier bill, another bill sent back or another payee's bill", () => {
    const earlier = bill("BL-001", "filed");
    const back = bill("BL-002", "returned");
    const backAgain = bill("BL-003", "returned");
    const other = bill("BL-004", "waiting", { payee: "Pamir Power", invoiceNumber: "PP-9" });
    expect(redoneAs(back, [earlier, back, backAgain, other])).toBeNull();
    expect(redoneAs(earlier, [earlier, back])).toBeNull();
  });

  it("never warns that a bill sent back was paid twice", () => {
    const back = bill("BL-001", "returned");
    const again = bill("BL-002", "waiting", { file: back.file });
    expect(billFlags(back, [back, again], 500)).toEqual([]);
    expect(billFlags(again, [back, again], 500)).toEqual([]);
  });
});
