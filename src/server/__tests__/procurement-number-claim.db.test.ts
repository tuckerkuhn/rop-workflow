import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import type { Procurement } from "@/lib/procurement";
import { seedDatabase } from "@/server/demo-seed";
import { claimNewProcurements, loadProcurements, nextProcurementId, releaseNewProcurements } from "@/server/procurement-store";
import { ready } from "@/server/__tests__/test-db";

/** Review round 1, ISS-11 (code review): two people saving the same new number at once never overwrite each other. */
const code = "A-2027";

beforeAll(async () => {
  await ready;
  await seedDatabase();
}, 120_000);

describe("a new purchase number is taken once", { timeout: 60_000 }, () => {
  it("of two saves of the same new number at once, one keeps it and the other is told", async () => {
    const id = await nextProcurementId(code);
    expect(id).toMatch(/^PR-A2027-\d{3}$/);
    const base = (await loadProcurements(code))[0];
    const a = { ...base, id, title: "Seed, first request (fictional)" } as Procurement;
    const b = { ...base, id, title: "Fertilizer, second request (fictional)" } as Procurement;
    const [ra, rb] = await Promise.all([claimNewProcurements(code, [a]), claimNewProcurements(code, [b])]);
    expect([ra, rb].filter((x) => x.length === 0)).toHaveLength(1);
    expect([...ra, ...rb]).toEqual([id]);
    const kept = (await loadProcurements(code)).filter((p) => p.id === id);
    expect(kept).toHaveLength(1);
    expect(["Seed, first request (fictional)", "Fertilizer, second request (fictional)"]).toContain(kept[0].title);
    // The next number moves on; a released claim frees its number again.
    expect(await nextProcurementId(code)).not.toBe(id);
    await releaseNewProcurements(code, [id]);
    expect(await nextProcurementId(code)).toBe(id);
  });
});

describe("a goods received note dated after today (code review of ISS-16)", { timeout: 60_000 }, () => {
  it("is refused on a real project, so it cannot switch off the stock-by-date check", async () => {
    process.env.DEMO_SIGN_IN = "1";
    const { PUT } = await import("@/app/api/projects/[code]/procurements/route");
    const p = (await loadProcurements(code)).find((x) => (x.signatures?.["Goods received note"] ?? []).length)!;
    const signed = (p.signatures!["Goods received note"] ?? []).map((x) => ({ ...x, date: "2099-01-01" }));
    const body = { items: [{ ...p, signatures: { ...p.signatures, "Goods received note": signed } }] };
    const res = await PUT(new Request(`http://test/api/projects/${code}/procurements`, { method: "PUT", headers: { "x-demo-user": "hamid", "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ code }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("cannot be dated after today");
  });
});

describe("the person the approval table names can sign with view access (review round 2, R2-01)", { timeout: 60_000 }, () => {
  const put = async (who: string, items: Procurement[]) => {
    process.env.DEMO_SIGN_IN = "1";
    const { PUT } = await import("@/app/api/projects/[code]/procurements/route");
    return PUT(new Request(`http://test/api/projects/${code}/procurements`, { method: "PUT", headers: { "x-demo-user": who, "content-type": "application/json" }, body: JSON.stringify({ items }) }), { params: Promise.resolve({ code }) });
  };
  it("the CEO (view access, signs above $25,000) gets past the door; the guard still limits them to their own step", async () => {
    const p = (await loadProcurements(code)).find((x) => x.step !== "done" && x.step !== "need")!;
    const ok = await put("tucker", [p]);
    expect(ok.status).not.toBe(403);
    const now = (await loadProcurements(code)).find((x) => x.id === p.id)!;
    const changed = await put("tucker", [{ ...now, title: `${now.title} (changed)` }]);
    expect([400, 409]).toContain(changed.status);
    expect(((await changed.json()) as { error: string }).error).toMatch(/cannot change|Only the/);
  });
  it("someone with view access and no signing role is still refused", async () => {
    const { users: DEMO_USERS } = await import("@/lib/demo");
    const { procRolesFor } = await import("@/lib/procurement");
    const viewer = DEMO_USERS.find((u) => u.kind === "employee" && u.procurementAccess === "view" && !procRolesFor(u).length && !u.admin)!;
    const p = (await loadProcurements(code))[0];
    expect((await put(viewer.id, [p])).status).toBe(403);
  });
});

describe("the demo project follows the calendar for new requests (review round 2, R2-05)", { timeout: 60_000 }, () => {
  it("a request with no calendar item is refused on A-2027 too", async () => {
    process.env.DEMO_SIGN_IN = "1";
    const { PUT } = await import("@/app/api/projects/[code]/procurements/route");
    const base = (await loadProcurements(code))[0];
    const id = await nextProcurementId(code);
    const fresh = { ...base, id, step: "need", signatures: {}, checks: {}, timeline: [], issues: [], payments: [], overrides: {}, rev: 0, plan: undefined } as unknown as Procurement;
    const res = await PUT(new Request(`http://test/api/projects/${code}/procurements`, { method: "PUT", headers: { "x-demo-user": "laila", "content-type": "application/json" }, body: JSON.stringify({ items: [fresh] }) }), { params: Promise.resolve({ code }) });
    expect(((await res.json()) as { error: string }).error).toContain("Start the request from an approved item on the procurement calendar");
  });
});
