import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { nextSigners } from "@/lib/hr";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { loadHr, resetSample } from "@/server/hr-store";
import { POST } from "@/app/api/hr/route";

/** MF-03: a hire's first signature (the offer) waits for HR to record a clear screening of the finalist. */
const post = async (as: string, body: unknown) => {
  const res = await POST(new Request("http://test/api/hr", { method: "POST", headers: { "x-demo-user": as, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  await resetSample();
}, 120_000);

describe("screening before the offer", { timeout: 60_000 }, () => {
  it("refuses to sign a hire until a clear screening is filed, then lets it through", async () => {
    // HR proposes a new hire, a fictional finalist.
    const start = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const proposed = await post("sima", { action: "propose", proposal: { type: "hire", subject: "test-finalist", effective: start, fields: { name: "Test Finalist", title: "M&E Assistant", office: "Afghanistan", employment: "National staff", supervisor: "nadia", startDate: start, contractEnd: "2027-12-31", payBasis: "Month", pay: 50000, currency: "AFN" }, reason: "A fictional finalist for the screening test." } });
    expect(proposed.body.error ?? "").toBe("");
    const { state } = await loadHr();
    const hire = state.proposals.find((p) => p.type === "hire" && p.status === "pending");
    expect(hire).toBeDefined();
    const signer = nextSigners(hire!, state)!.people[0];
    const refused = await post(signer, { action: "approve", proposal: hire!.id });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/^Screen the finalist before the offer/);

    const hr = state.rules!.holders.hr[0];
    // Only HR records a screening.
    const other = Object.keys(state.people).find((id) => !state.rules!.holders.hr.includes(id))!;
    expect((await post(other, { action: "screen", screening: { person: hire!.subject, date: new Date().toISOString().slice(0, 10), lists: "OFAC SDN list; UN Security Council 1267 list", result: "clear" } })).status).toBe(403);
    expect((await post(hr, { action: "screen", screening: { person: hire!.subject, date: new Date().toISOString().slice(0, 10), lists: "OFAC SDN list; UN Security Council 1267 list", result: "clear", link: "https://example.org/printout" } })).status).toBe(200);
    const signed = await post(signer, { action: "approve", proposal: hire!.id });
    expect(signed.status).toBe(200);
    expect(signed.body.view.screenings[hire!.subject as string]).toHaveLength(1);
  });
});
