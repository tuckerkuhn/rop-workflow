import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById } from "@/lib/demo";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { loadHr, resetSample } from "@/server/hr-store";
import { GET, POST } from "@/app/api/advances/route";
import type { AdvanceView } from "@/app/api/advances/route";

/** MF-02: an advance asked for, approved, paid to its holder only, aged, settled with receipts, the rest recovered. */
const call = async (as: string, body?: unknown) => {
  const res = body ? await POST(new Request("http://test/api/advances", { method: "POST", headers: { "x-demo-user": as, "Content-Type": "application/json" }, body: JSON.stringify(body) })) : await GET(new Request("http://test/api/advances", { headers: { "x-demo-user": as } }));
  return { status: res.status, body: (await res.json()) as { error?: string; view?: AdvanceView } & AdvanceView };
};
const today = new Date().toISOString().slice(0, 10);
let holder = "";
let sup = "";
let fin = "";

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  await resetSample();
  const { state } = await loadHr();
  fin = (state.rules!.holders.finance ?? state.rules!.holders.payroll)[0];
  // Someone with a record and a supervisor, who is neither Finance nor their own supervisor, and who is a demo user.
  const p = Object.values(state.people).find((x) => typeof x.current.supervisor === "string" && x.id !== fin && x.current.supervisor !== fin && !x.separated && userById(x.id) && userById(x.current.supervisor as string))!;
  holder = p.id;
  sup = p.current.supervisor as string;
}, 120_000);

describe("advances", { timeout: 60_000 }, () => {
  it("runs from request to settlement, paid only to the holder, with an age and a deadline", async () => {
    const req = await call(holder, { action: "request", request: { amount: 300, currency: "USD", purpose: "Field trip to the project villages, fuel and lodging", source: "A-2027", neededBy: today } });
    expect(req.body.error ?? "").toBe("");
    const n = req.body.view!.mine[0].n;
    // A second one waits until the first is settled.
    expect((await call(holder, { action: "request", request: { amount: 50, currency: "USD", purpose: "Another trip next week", source: "A-2027", neededBy: today } })).status).toBe(409);
    // Not the holder's to approve; the supervisor's.
    expect((await call(holder, { action: "approve", advance: n })).status).toBe(409);
    expect((await call(sup, { action: "approve", advance: n })).body.error ?? "").toBe("");
    // Paid only to the holder.
    expect((await call(fin, { action: "pay", payment: { advance: n, paidOn: today, method: "bank", reference: "TRX-0001", payee: sup } })).body.error).toMatch(/only to the person who holds it/);
    const paid = await call(fin, { action: "pay", payment: { advance: n, paidOn: today, method: "bank", reference: "TRX-0001", payee: holder } });
    expect(paid.body.error ?? "").toBe("");
    const mine = (await call(holder)).body.mine.find((a) => a.n === n)!;
    expect(mine.age).toMatchObject({ days: 0, overdue: false });
    expect(mine.settleDays).toBeGreaterThan(0);

    // Settled with receipts (one explained without), more than the advance refused.
    expect((await call(holder, { action: "settle", settlement: { advance: n, lines: [{ date: today, description: "Fuel", amount: 290, receipts: [], noReceipt: "Roadside fuel, no receipt given" }], returned: 20 } })).body.error).toMatch(/more than the advance/);
    expect((await call(holder, { action: "settle", settlement: { advance: n, lines: [{ date: today, description: "Fuel", amount: 250, receipts: [], noReceipt: "Roadside fuel, no receipt given" }], returned: 20 } })).body.error ?? "").toBe("");
    expect((await call(holder, { action: "accept", advance: n })).status).toBe(409);
    expect((await call(fin, { action: "accept", advance: n })).body.error ?? "").toBe("");
    // 300 - 250 spent - 20 returned = 30 still owed, recovered from pay.
    const settled = (await call(fin)).body.others.find((a) => a.n === n)!;
    expect(settled.owed).toBe(30);
    expect((await call(fin, { action: "recover", advance: n, amount: 40 })).body.error).toMatch(/Only 30/);
    expect((await call(fin, { action: "recover", advance: n, amount: 30 })).body.error ?? "").toBe("");
    expect((await call(fin)).body.others.find((a) => a.n === n)!.owed).toBe(0);
  });
});
