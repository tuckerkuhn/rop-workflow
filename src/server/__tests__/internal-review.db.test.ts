import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));
vi.mock("@/server/hr-store", async (original) => {
  const real = await original<typeof import("@/server/hr-store")>();
  return { ...real, loadHr: async () => ({ entries: [], state: { people: {}, proposals: [], rules: { holders: {} } } }) };
});

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import { seedDatabase } from "@/server/demo-seed";
import { actOnReview, candidatesFor, loadBook } from "@/server/internal-review-store";
import { ready } from "@/server/__tests__/test-db";

/** The quarterly internal review: who may do each step, and that the sample stays as drawn. */
const [daniel, marcus, karim, tucker, nadia] = ["daniel", "marcus", "karim", "tucker", "nadia"].map((id) => userById(id)!);
let orgId = "";

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  orgId = (await db.select().from(s.organizations).limit(1))[0].id;
}, 120_000);

describe("quarterly internal review", { timeout: 60_000 }, () => {
  it("only an administrator names the four people, and the lead, reviewer and focal point are three people", async () => {
    const roles = { lead: "daniel", reviewer: "marcus", focal: "karim", ceo: "tucker" };
    expect(await actOnReview(orgId, { action: "roles", roles }, nadia)).toMatch(/administrator/);
    expect(await actOnReview(orgId, { action: "roles", roles: { ...roles, reviewer: "daniel" } }, tucker)).toMatch(/two people/);
    expect(await actOnReview(orgId, { action: "roles", roles: { ...roles, focal: "marcus" } }, tucker)).toMatch(/focal point/);
    expect(await actOnReview(orgId, { action: "roles", roles }, tucker)).toBeNull();
  });

  it("the lead draws the sample once the quarter has ended, once only", async () => {
    expect(await actOnReview(orgId, { action: "draw", quarter: "2099-Q1" }, daniel)).toMatch(/after the quarter ends/);
    expect(await actOnReview(orgId, { action: "draw", quarter: "2026-Q3" }, marcus)).toMatch(/lead draws/);
    expect(await actOnReview(orgId, { action: "draw", quarter: "2026-Q3" }, daniel)).toBeNull();
    expect(await actOnReview(orgId, { action: "draw", quarter: "2026-Q3" }, daniel)).toMatch(/stays as drawn/);
    const rv = (await loadBook(orgId)).reviews[0];
    // Every award is in the sample, and the asset spot check.
    expect(rv.items.some((i) => i.area === "assets")).toBe(true);
    expect(rv.items.some((i) => i.area === "donor")).toBe(true);
  });

  it("each item is tested by the person it falls to, and the cycle goes in order", async () => {
    const rv = (await loadBook(orgId)).reviews[0];
    const item = rv.items.find((i) => i.tester === "lead")!;
    expect(await actOnReview(orgId, { action: "test", quarter: rv.quarter, ref: item.ref, ok: true, note: "" }, karim)).toMatch(/tests this one/);
    expect(await actOnReview(orgId, { action: "step", quarter: rv.quarter, step: "documentsIn" }, karim)).toMatch(/First: sample list sent/);
    expect(await actOnReview(orgId, { action: "step", quarter: rv.quarter, step: "sampleSent" }, daniel)).toBeNull();
    expect(await actOnReview(orgId, { action: "step", quarter: rv.quarter, step: "documentsIn" }, karim)).toBeNull();
    expect(await actOnReview(orgId, { action: "step", quarter: rv.quarter, step: "testingDone" }, daniel)).toMatch(/Every item/);
    expect(await actOnReview(orgId, { action: "test", quarter: rv.quarter, ref: item.ref, ok: false, note: "short" }, daniel)).toMatch(/what is wrong/);
    expect(await actOnReview(orgId, { action: "test", quarter: rv.quarter, ref: item.ref, ok: false, note: "No signed reconciliation for the month." }, daniel)).toBeNull();
  });

  it("a finding: recorded by the lead, answered by the focal point, approved by the CEO, closed by the lead", async () => {
    const q = "2026-Q3";
    expect(await actOnReview(orgId, { action: "finding", quarter: q, area: "cash", rating: "medium", text: "Reconciliation not signed for September." }, karim)).toMatch(/lead or the reviewer/);
    expect(await actOnReview(orgId, { action: "finding", quarter: q, area: "cash", rating: "medium", text: "Reconciliation not signed for September." }, daniel)).toBeNull();
    const f = (await loadBook(orgId)).findings[0];
    expect(await actOnReview(orgId, { action: "close", finding: f.id, note: "Re-tested and signed now." }, daniel)).toMatch(/responded/);
    expect(await actOnReview(orgId, { action: "approve", finding: f.id }, tucker)).toMatch(/response first/);
    expect(await actOnReview(orgId, { action: "respond", finding: f.id, text: "Finance signs each month by the 10th." }, daniel)).toMatch(/focal point/);
    expect(await actOnReview(orgId, { action: "respond", finding: f.id, text: "Finance signs each month by the 10th." }, karim)).toBeNull();
    // Not closed before the CEO approves the corrective action.
    expect(await actOnReview(orgId, { action: "close", finding: f.id, note: "Re-tested: October and November signed." }, daniel)).toMatch(/CEO approves/);
    expect(await actOnReview(orgId, { action: "approve", finding: f.id }, tucker)).toBeNull();
    expect(await actOnReview(orgId, { action: "close", finding: f.id, note: "Re-tested: October and November signed." }, daniel)).toBeNull();
    const after = (await loadBook(orgId)).findings[0];
    expect(after.closed?.by).toBe("daniel");
    const logged = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entity, "internal_review"), eq(s.auditLog.action, "internal_review_close")));
    expect(logged).toHaveLength(1);
  });

  it("two actions at the same moment both stay", async () => {
    const q = "2026-Q3";
    const text = (n: number) => `Simultaneous finding number ${n}, both must stay.`;
    const before = (await loadBook(orgId)).findings.length;
    const out = await Promise.all([1, 2, 3].map((n) => actOnReview(orgId, { action: "finding", quarter: q, area: "cash", rating: "low", text: text(n) }, daniel)));
    expect(out).toEqual([null, null, null]);
    expect((await loadBook(orgId)).findings.length).toBe(before + 3);
  });

  it("reads candidates from the records without failing on a quarter with none", async () => {
    const c = await candidatesFor(orgId, "2026-Q3");
    expect(c.every((x) => x.ref && x.area)).toBe(true);
  });
});
