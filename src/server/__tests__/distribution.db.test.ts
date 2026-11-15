import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq, like } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { seedDatabase } from "@/server/demo-seed";
import { decideDistribution, listDistributions, recordFromApp, resubmitDistribution, stockFor } from "@/server/distribution";
import { realToday } from "@/lib/clock";
import { loadField, saveItems, saveSetup, setupFor } from "@/server/field-store";
import { loadHome } from "@/server/home-store";
import { loadProcurements, saveProcurements } from "@/server/procurement-store";
import { loadProgress } from "@/server/progress-store";
import { loadResults, reviewResult } from "@/server/results-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * One input distribution on the demo project, field to finance, against a real database: the
 * goods-received gate, a retry, two people saving at once, sent back and fixed, approved, and what
 * each team then sees. The steps run in order and build on each other.
 */
const code = "A-2027";
const farida = userById("farida")!;
const nadia = userById("nadia")!;
const bilal = userById("bilal")!;
const yusuf = userById("yusuf")!;
const omar = userById("omar")!;

const farmer = async (id: string) => (await loadField(code, farida)).items.find((i) => i.id === id) as Farmer;
const evidence = () => db.select().from(s.evidence).where(eq(s.evidence.form, "distribution"));
const tasks = (key: string) => db.select().from(s.workItems).where(like(s.workItems.sourceKey, key));
const audits = (action: string) => db.select().from(s.auditLog).where(eq(s.auditLog.action, action));
const stock = async () => (await stockFor(code))?.stock;
const refusal = async (f: () => Promise<unknown>) => f().then(() => "", (e: Error) => e.message);
const record = async (id: string, by = farida) => {
  const f = await farmer(id);
  const rid = await recordFromApp(code, { ...f, step: "plant" }, by, "http://test");
  await saveItems(code, [{ ...f, step: "plant" }]);
  return rid;
};

let first = "";
let second = "";
let third = "";

beforeAll(async () => {
  await ready;
  await seedDatabase();
}, 120_000);

describe("input distribution, field to finance (demo project)", { timeout: 60_000 }, () => {
  it("starts with the store's stock worked out from signed received notes", async () => {
    expect(await stock()).toEqual({ seed: 380, npk: 0 });
    expect((await loadHome(code, bilal)).actions.find((a) => a.key === "field:distribute")?.text).toBe("Distribute the input package: 2 farmers are waiting for you");
    const listed = await listDistributions(code);
    expect(listed.map((d) => [d.farmerId, d.status, d.gate.ok])).toEqual([["F-0002", "pending", true]]);
  });

  it("loads the sample story from today: history behind, the planting window sixteen days ahead", async () => {
    const today = realToday();
    const plus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
    expect((await setupFor(code))?.windowEnd).toBe(plus(16));
    expect((await setupFor(code))?.season).toBe(`${plus(16).slice(0, 4)} season`);
    const items = (await loadField(code, farida)).items;
    const history = items.flatMap((i) => i.timeline.map((t) => t.date));
    expect(history.length).toBeGreaterThan(10);
    expect(history.every((d) => d <= today)).toBe(true);
    // The newest entry is recent, not months old: the story really was moved.
    expect([...history].sort().at(-1)! >= plus(-3)).toBe(true);
    const neededBy = (await loadProcurements(code)).find((p) => p.id === "PR-2027-011")!.neededBy;
    expect(neededBy).toBe(plus(1));
  });

  it("refuses a distribution before the fertilizer's received note is signed, and stores nothing", async () => {
    const f = await farmer("F-0007");
    expect(await refusal(() => recordFromApp(code, { ...f, step: "plant" }, farida, "http://test"))).toMatch(/PR-2027-011 has been delivered: once its goods received note is signed/);
    expect(await evidence()).toHaveLength(2);
  });

  it("lets it through once the received note is signed", async () => {
    const p = (await loadProcurements(code)).find((x) => x.id === "PR-2027-011")!;
    await saveProcurements(code, [{ ...p, step: "package" }]);
    expect(await stock()).toEqual({ seed: 380, npk: 600 });
    const f = await farmer("F-0007");
    first = await recordFromApp(code, { ...f, step: "plant" }, farida, "http://test");
    // The same save arriving again (a retry, a double tap) is the same record.
    expect(await recordFromApp(code, { ...f, step: "plant" }, farida, "http://test")).toBe(first);
    await saveItems(code, [{ ...f, step: "plant" }]);
    expect(await evidence()).toHaveLength(3);
    expect((await audits("distribution_recorded")).filter((a) => a.entityId === first)).toHaveLength(1);
    expect(await stock()).toEqual({ seed: 370, npk: 550 });
  });

  it("keeps both records when two people save at the same moment", async () => {
    // (The second farmer is not at Distribute: the save route refuses that; here only the two writes matter.)
    [second, third] = await Promise.all([record("F-0008"), record("F-0009")]);
    const ids = (await listDistributions(code)).map((d) => d.id);
    expect(ids).toContain(second);
    expect(ids).toContain(third);
  });

  it("puts the approval on the manager's Home, and the farmers now ready to plant on the extension agent's", async () => {
    expect((await loadHome(code, nadia)).actions.find((a) => a.key === "distributions")?.bucket).toBe("approve");
    // Nobody is left waiting for inputs, so the storekeeper's Home has no field row.
    expect((await loadHome(code, bilal)).actions.some((a) => a.key === "field:distribute")).toBe(false);
    expect((await loadHome(code, farida)).actions.find((a) => a.key === "field:plant")?.text).toMatch(/farmers are waiting for you$/);
  });

  it("sends a record back to the person who recorded it, with a task on their Home", async () => {
    expect(await refusal(() => decideDistribution(code, first, "sent_back", nadia, " "))).toMatch(/Say what needs fixing/);
    const back = await decideDistribution(code, first, "sent_back", nadia, "Signature missing on the list");
    expect(back.fixer).toBe("farida");
    const [task] = await tasks(`dist-fix:${first}`);
    expect(task.assignee).toBe("farida");
    expect(task.doneAt).toBeNull();
    expect(task.notes).toContain(`/approve/A-2027/${first}`);
    const row = (await loadHome(code, farida)).actions.find((a) => a.key === `task:${task.id}`);
    expect(row?.bucket).toBe("fix");
    expect(row?.href).toBe(`/approve/A-2027/${first}`);
    // Sent back, it no longer takes stock and cannot be approved.
    expect(await stock()).toEqual({ seed: 360, npk: 500 });
    expect(await refusal(() => decideDistribution(code, first, "approved", nadia))).toMatch(/already sent back/);
  });

  it("returns to the manager once fixed, with the corrections and the history", async () => {
    expect(await refusal(() => resubmitDistribution(code, first, farida, {}, ""))).toMatch(/Say what you fixed/);
    await resubmitDistribution(code, first, farida, { signed: true, photo: true, qty: { seed: 8 } }, "Got the thumbprint; seed was 8 kg", "http://test");
    const d = (await listDistributions(code)).find((x) => x.id === first)!;
    expect(d.status).toBe("pending");
    expect(d.signed && d.photo).toBe(true);
    expect(d.items.find((i) => i.key === "seed")?.qty).toBe(8);
    expect(d.history).toHaveLength(1);
    expect(d.decided).toBeNull();
    const [task] = await tasks(`dist-fix:${first}`);
    expect(task.doneBy).toBe("farida");
    expect(await audits("distribution_resubmitted")).toHaveLength(1);
    expect(await refusal(() => resubmitDistribution(code, first, farida, {}, "again"))).toMatch(/Only a distribution the project manager sent back/);
  });

  it("reopens the same task when sent back a second time", async () => {
    await decideDistribution(code, first, "sent_back", nadia, "Photo is unreadable");
    const found = await tasks(`dist-fix:${first}`);
    expect(found).toHaveLength(1);
    expect(found[0].doneAt).toBeNull();
    expect(found[0].title).toContain("Photo is unreadable");
    await resubmitDistribution(code, first, farida, { photo: true }, "New photo taken", "http://test");
  });

  it("on approval: counts toward the target, grows the right purchase's list, and is in the audit log", async () => {
    const target = async () => (await loadProgress(code, nadia)).indicators.find((i) => i.code === "IND-2")!;
    const before = await target();
    const res = await decideDistribution(code, first, "approved", nadia);
    // Charged to the purchases that received goods, never one still on order.
    expect([...res.procurements].sort()).toEqual(["PR-2027-006", "PR-2027-007"]);
    // One result for the target named in the package settings, made from the record already entered.
    expect(res.target).toBe("IND-2");
    const made = (await loadResults(code)).filter((r) => r.distribution === first);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ indicator: "IND-2", value: 1, status: "pending", by: "farida" });
    expect(made[0].note).toMatch(/^Input package given to farmer F-\d{4} in Village B: .+ Recorded by Farida Noori, approved by Nadia Rahimi\.$/);
    // It waits for MEL like any other result: not counted yet, and on the MEL officer's Home.
    expect((await target()).total).toBe(before.total);
    expect((await target()).pending).toBe(before.pending + 1);
    expect((await loadHome(code, omar)).actions.find((a) => a.key === "accept")?.text).toMatch(/^Accept or query \d+ results? waiting for you$/);
    await reviewResult(code, made[0].id, "accepted", "omar", null);
    expect((await target()).total).toBe((before.total ?? 0) + 1);
    const procs = await loadProcurements(code);
    expect(procs.find((p) => p.id === "PR-2027-006")!.distribution!.lists.map((l) => [l.recipients, l.qty])).toEqual([[1, 8]]);
    // Those two purchases are paid and closed: finance is not asked to pay them again.
    expect(await tasks("pay-ready:%")).toHaveLength(0);
    const d = (await listDistributions(code)).find((x) => x.id === first)!;
    expect(d.history).toHaveLength(2);
    expect(d.decided?.decision).toBe("approved");
  });

  it("adds no result when the project has not named a target, and says so", async () => {
    const setup = (await setupFor(code))!;
    await saveSetup(code, { ...setup, target: undefined });
    const before = (await loadResults(code)).length;
    const res = await decideDistribution(code, second, "approved", nadia);
    expect(res.result).toBeNull();
    expect((await loadResults(code)).length).toBe(before);
    await saveSetup(code, setup);
  });

  it("asks finance to pay once, for the purchase that still has a payment to make", async () => {
    await decideDistribution(code, third, "approved", nadia);
    const pay = await tasks("pay-ready:%");
    expect(pay.map((t) => [t.sourceKey, t.assignee])).toEqual([["pay-ready:PR-2027-011", "yusuf"]]);
    const row = (await loadHome(code, yusuf)).actions.find((a) => a.key === `task:${pay[0].id}`);
    expect(row?.href).toBe("/work?source=procurement&open=PR-2027-011&project=A-2027");
    expect(await audits("distribution_approved")).toHaveLength(3);
    // A result for each approval made while a target was named, each tied to its own distribution: none counted twice.
    const made = (await loadResults(code)).filter((r) => r.distribution);
    expect(made.map((r) => r.distribution).sort()).toEqual([first, third].sort());
    expect(await audits("distribution_sent_back")).toHaveLength(2);
  });
});
