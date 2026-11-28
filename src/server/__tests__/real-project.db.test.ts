import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq, like } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import { FARMER_TEMPLATE, parseFarmers } from "@/lib/farmer-import";
import type { Farmer } from "@/lib/field";
import { setupProblem, type FieldSetup } from "@/lib/package";
import { seedProcurements, type Procurement } from "@/lib/procurement";
import { seedDatabase } from "@/server/demo-seed";
import { checkKoboDistribution, decideDistribution, listDistributions, processPending, recordFromApp, resubmitDistribution, stockFor } from "@/server/distribution";
import { importFarmers } from "@/server/farmers";
import { loadField, projectsWithField, saveItems, saveSetup, setupFor } from "@/server/field-store";
import { loadHome } from "@/server/home-store";
import { loadProcurements, saveProcurements } from "@/server/procurement-store";
import { approveAs } from "@/server/__tests__/receipt-helper";
import { ready } from "@/server/__tests__/test-db";

// As the screen and the field route require before a distribution is recorded: the recipient's
// signature or thumbprint is confirmed. Without it the distribution cannot be approved.
const handedOut = (f: Farmer): Farmer => ({ ...f, photos: [...f.photos, { id: "note", activity: "distribution" as const, date: "2027-01-01", caption: "Signed goods received note", src: "data:image/png;base64,AA==", signedNote: true }], checks: { ...f.checks, "distribute.recipient": true }, step: "plant" });


/**
 * Field activities on a project that is not the demo: its own package (per hectare and per farmer,
 * three units), a farmer list from a spreadsheet, purchases bought in other units, and distribution
 * records from KoboToolbox with part of the package or none of it. Steps run in order.
 */
const code = "TEST-REAL";
const nadia = userById("nadia")!;
const bilal = userById("bilal")!;
const omar = userById("omar")!;
const refusal = async (f: () => Promise<unknown>) => f().then(() => "", (e: Error) => e.message);
const stock = async () => (await stockFor(code))?.stock;
const farmer = async (id: string) => (await loadField(code, nadia)).items.find((i) => i.id === id) as Farmer;

const setup: FieldSetup = {
  items: [
    { key: "cuttings", item: "Grape cuttings", unit: "cuttings", qty: 400, per: "hectare", budgetLine: "3.1" },
    { key: "fertilizer", item: "DAP fertilizer", unit: "kg", qty: 50, per: "hectare", budgetLine: "3.2" },
    { key: "trellis", item: "Trellis set", unit: "sets", qty: 1, per: "farmer", budgetLine: "3.3" },
  ],
  season: "2027 spring",
  village: "Store A",
};

let projectId = "";
let orgId = "";
let first = "";

beforeAll(async () => {
  await ready;
  await seedDatabase();
  const [org] = await db.select().from(s.organizations);
  orgId = org.id;
  const [project] = await db.insert(s.projects).values({ organizationId: org.id, code, name: "Test real project", country: "AF", stage: "Execute", kind: "real" }).returning();
  projectId = project.id;
}, 120_000);

describe("Field activities on a real project", { timeout: 60_000 }, () => {
  it("is off until the project's package is saved", async () => {
    expect(await setupFor(code)).toBeNull();
    expect((await projectsWithField()).has(code)).toBe(false);
    expect(await stockFor(code)).toBeNull();
    expect(setupProblem(setup)).toBeNull();
    await saveSetup(code, setup);
    expect((await projectsWithField()).has(code)).toBe(true);
  });

  it("loads a farmer list: bad rows reported, an ID from another project refused, names kept apart", async () => {
    const csv = "Farmer ID,Village,Sex,Hectares,Name,Step\nT-001,Dasht,F,0.5,Test Person One,distribute\nT-002,Dasht,M,2,,distribute\nT-003,Qala,F,1,,train\nF-0007,Qala,F,1,,train\nT-005,Qala,X,abc,,train\n";
    const parsed = parseFarmers(csv);
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.problems).toEqual(['Row 6: sex "X" is not F or M; hectares "abc" is not a number.']);
    expect(parseFarmers(FARMER_TEMPLATE).problems).toEqual([]);
    // F-0007 belongs to the demo project: the whole list is refused, nothing is loaded.
    expect(await refusal(() => importFarmers(code, parsed.rows, nadia))).toMatch(/already used on another project: F-0007/);
    expect((await loadField(code, nadia)).items).toHaveLength(0);
    const rows = parsed.rows.filter((r) => r.id !== "F-0007");
    expect(await importFarmers(code, rows, nadia)).toEqual({ added: 3, updated: 0 });
    expect(await importFarmers(code, rows, nadia)).toEqual({ added: 0, updated: 3 });
    // The name is in the protected table only, and only for roles that may see names.
    const stored = await db.select().from(s.fieldItems).where(eq(s.fieldItems.projectId, projectId));
    expect(JSON.stringify(stored.map((r) => r.data))).not.toContain("Test Person");
    expect(((await loadField(code, nadia)).items.find((i) => i.id === "T-001") as Farmer).name).toBe("Test Person One");
    expect(((await loadField(code, omar)).items.find((i) => i.id === "T-001") as Farmer).name).toBe(omar.pii ? "Test Person One" : "");
  });

  it("refuses a distribution until each item has a purchase with a signed received note", async () => {
    const t1 = await farmer("T-001");
    expect(await refusal(() => recordFromApp(code, handedOut(t1), bilal, "http://test"))).toMatch(/No purchase on budget line 3.1 supplies Grape cuttings/);
    const base = seedProcurements().find((p) => p.id === "PR-2027-006")!;
    const buy = (id: string, over: Partial<Procurement>) => ({ ...base, id, distribution: undefined, plan: undefined, ...over }) as Procurement;
    await saveProcurements(code, [
      buy("PR-T-1", { title: "Grape cuttings", unit: "cuttings", qty: 1000, budgetLine: "3.1", grn: { qty: 1000, place: "Store A" }, step: "package" }),
      // Bought in tonnes, handed out in kg.
      buy("PR-T-2", { title: "DAP", unit: "t", qty: 0.1, budgetLine: "3.2", grn: { qty: 0.1, place: "Store A" }, step: "package" }),
      // Delivered, received note not signed; its unit is spelled "Set", the package says "sets".
      buy("PR-T-3", { title: "Trellis", unit: "Set", qty: 10, budgetLine: "3.3", grn: { qty: 10, place: "Store A" }, step: "receive" }),
    ]);
    expect(await stock()).toEqual({ cuttings: 1000, fertilizer: 100, trellis: 0 });
    expect(await refusal(() => recordFromApp(code, handedOut(t1), bilal, "http://test"))).toMatch(/Trellis set: the goods received note is not signed yet \(PR-T-3 is at Receive\)/);
    const p3 = (await loadProcurements(code)).find((p) => p.id === "PR-T-3")!;
    await saveProcurements(code, [{ ...p3, step: "package" }]);
    expect(await stock()).toEqual({ cuttings: 1000, fertilizer: 100, trellis: 10 });
  });

  it("scales per-hectare items by the farmer's hectares, and refuses when one item runs short", async () => {
    const t1 = await farmer("T-001");
    first = await recordFromApp(code, handedOut(t1), bilal, "http://test");
    await saveItems(code, [handedOut(t1)]);
    const d = (await listDistributions(code)).find((x) => x.id === first)!;
    // 0.5 hectares.
    expect(d.items.map((i) => [i.key, i.qty])).toEqual([["cuttings", 200], ["fertilizer", 25], ["trellis", 1]]);
    expect(await stock()).toEqual({ cuttings: 800, fertilizer: 75, trellis: 9 });
    // 2 hectares needs 100 kg of fertilizer; 75 kg is left. The cuttings (800 of 800) are fine.
    const msg = await refusal(async () => recordFromApp(code, handedOut((await farmer("T-002"))), bilal, "http://test"));
    expect(msg).toMatch(/DAP fertilizer: this package needs 100 kg, but only 75 kg of the 100 kg received is left/);
    expect(msg).not.toMatch(/Grape cuttings:/);
  });

  it("shows the approval and the waiting farmer on Home, as on the demo project", async () => {
    expect((await loadHome(code, nadia)).actions.find((a) => a.key === "distributions")?.text).toBe("Approve the input distribution to Test Person One (T-001)");
    expect((await loadHome(code, bilal)).actions.find((a) => a.key === "field:distribute")?.text).toBe("Distribute the input package: 1 farmer is waiting for you");
  });

  it("on approval charges each purchase in its own unit and asks finance to pay each", async () => {
    const res = await approveAs(code, first, nadia);
    expect([...res.procurements].sort()).toEqual(["PR-T-1", "PR-T-2", "PR-T-3"]);
    const procs = await loadProcurements(code);
    const listed = (id: string) => procs.find((p) => p.id === id)!.distribution!.lists.reduce((n, l) => n + l.qty, 0);
    expect(listed("PR-T-1")).toBe(200);
    expect(listed("PR-T-2")).toBeCloseTo(0.025, 9); // 25 kg, in tonnes
    expect(listed("PR-T-3")).toBe(1);
    expect((await db.select().from(s.workItems).where(like(s.workItems.sourceKey, "pay-ready:PR-T-%"))).map((t) => t.sourceKey).sort()).toEqual(["pay-ready:PR-T-1", "pay-ready:PR-T-2", "pay-ready:PR-T-3"]);
  });

  it("takes a partial package from KoboToolbox, and will not approve a record with nothing given", async () => {
    const kobo = async (uuid: string, farmerCode: string, payload: Record<string, unknown>) =>
      (await db.insert(s.evidence).values({ projectId, organizationId: orgId, source: "kobo", form: "distribution", farmerCode, reviewStatus: "pending", koboSubmissionUuid: uuid, completedAt: new Date(), payload }).returning())[0].id;
    const part = await kobo("k-1", "T-003", { cuttings_given: "yes", cuttings_qty: "300", fertilizer_given: "no", trellis_given: "yes", trellis_qty: "1", signed: "yes", list_photo: "p.jpg" });
    const none = await kobo("k-2", "T-002", { cuttings_given: "no", fertilizer_given: "no", trellis_given: "no", signed: "yes", list_photo: "p.jpg" });
    await processPending(code, "http://test");
    const all = await listDistributions(code);
    const d1 = all.find((x) => x.id === part)!;
    const d2 = all.find((x) => x.id === none)!;
    expect(d1.items.map((i) => [i.key, i.qty])).toEqual([["cuttings", 300], ["trellis", 1]]);
    // T-003 is still at training: flagged for the manager.
    expect(d1.flags.map((f) => f.id)).toContain("notready");
    expect(d2.items).toEqual([]);
    expect(d2.flags.map((f) => f.id)).toContain("nothing");
    expect(d2.gate.ok).toBe(false);

    // From a phone: held until the person this project names for KoboCollect data has checked it.
    expect(d1.koboCheck).toMatchObject({ needed: true, by: "Omar Sadiq", done: null });
    // Not sent to the project manager yet: no email, no link, and the record says why.
    expect(d1.notified).toMatchObject({ to: [], emailed: false, why: "Waiting for Omar Sadiq to check the KoboCollect record first" });
    expect(await refusal(() => approveAs(code, part, nadia))).toMatch(/^Not approved yet: this record came from KoboCollect, and Omar Sadiq checks KoboCollect data/);
    expect((await loadHome(code, omar)).actions.find((a) => a.key === "kobo-check")?.text).toBe("Check 2 KoboCollect distributions before they go to the project manager");
    expect((await loadHome(code, nadia)).actions.find((a) => a.key === "distributions")).toBeUndefined();
    // One recorded in the app by a named person never needs it.
    expect(all.filter((x) => x.source !== "kobo").every((x) => !x.koboCheck.needed)).toBe(true);
    await checkKoboDistribution(code, part, omar);
    await checkKoboDistribution(code, none, omar);
    expect((await db.select().from(s.auditLog).where(eq(s.auditLog.action, "distribution_kobo_checked")))).toHaveLength(2);
    const after = (await listDistributions(code)).find((x) => x.id === part)!;
    expect(after.koboCheck).toMatchObject({ needed: false, done: { by: "omar", byName: "Omar Sadiq" } });
    // The check is what sends it on: the manager is told now, once.
    expect(after.notified?.to).toEqual(["nadia"]);
    expect(await db.select().from(s.auditLog).where(eq(s.auditLog.action, "distribution_sent_to_manager"))).toHaveLength(2);
    expect((await loadHome(code, omar)).actions.find((a) => a.key === "kobo-check")).toBeUndefined();
    expect((await loadHome(code, nadia)).actions.find((a) => a.key === "distributions")?.text).toBe("Approve 2 input distributions");

    expect(await refusal(() => approveAs(code, none, nadia))).toMatch(/Not approved: No item is recorded as given/);
    // The farmer has not moved on and nothing was counted.
    expect((await farmer("T-002")).step).toBe("distribute");

    // Sent back, the storekeeper adds what was in fact given (2 ha: up to 800 cuttings), and it can then be approved.
    const back = await decideDistribution(code, none, "sent_back", nadia, "The form says nothing was given. What did T-002 receive?");
    expect(back.fixer).toBe("bilal");
    expect(d2.planned.map((i) => [i.key, i.qty])).toEqual([["cuttings", 800], ["fertilizer", 100], ["trellis", 1]]);
    await resubmitDistribution(code, none, bilal, { qty: { cuttings: 500, fertilizer: 0, trellis: 1 } }, "T-002 received 500 cuttings and a trellis set", "http://test");
    const fixed = (await listDistributions(code)).find((x) => x.id === none)!;
    expect(fixed.items.map((i) => [i.key, i.qty])).toEqual([["cuttings", 500], ["trellis", 1]]);
    expect(fixed.gate.ok).toBe(true);
    await approveAs(code, none, nadia);
    expect((await farmer("T-002")).step).toBe("plant");
  });
});

describe("the field review queue", { timeout: 60_000 }, () => {
  it("lists field forms only, never a recorded result or weekly update", async () => {
    const { isQueueForm, listSubmissions } = await import("@/server/kobo");
    expect(["training", "readiness", "distribution", "visit"].every(isQueueForm)).toBe(true);
    expect([null, "", "result", "update"].some(isQueueForm)).toBe(false);
    const { addResult } = await import("@/server/results-store");
    const [ind] = await db.select({ code: s.indicators.code }).from(s.indicators).where(eq(s.indicators.source, "results")).limit(1);
    if (ind) await addResult(code, { indicator: ind.code, date: "2026-11-01", value: 3, note: "Three farmers trained in the field.", files: [], noFile: "Sheet to follow." }, "farida");
    const { submissions } = await listSubmissions(code);
    // Every row has the answers the queue's screen reads; a result has none and used to break it.
    expect(submissions.every((x) => x.fields && typeof x.fields === "object")).toBe(true);
    expect(submissions.some((x) => (x.form as string) === "result")).toBe(false);
  });
});
