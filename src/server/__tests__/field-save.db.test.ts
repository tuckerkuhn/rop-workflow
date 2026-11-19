import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { PUT } from "@/app/api/projects/[code]/field/route";
import { userById } from "@/lib/demo";
import type { Farmer, FieldItem } from "@/lib/field";
import { seedDatabase } from "@/server/demo-seed";
import { loadField, saveItems, saveSetup, setupFor } from "@/server/field-store";
import { handedOutOn } from "@/lib/field";
import { countApprovedDistributions } from "@/server/distribution";
import { loadResults } from "@/server/results-store";
import { loadProcurements, saveProcurements } from "@/server/procurement-store";
import { ready } from "@/server/__tests__/test-db";
import { saveProjectState } from "@/server/project-state";
import { projectByCode } from "@/server/field-store";
import { CROP_PLAN_KEY } from "@/lib/crops";

/**
 * Saving Field activities from the browser (PUT /api/projects/[code]/field): the server applies the
 * screen's rules itself. A stale copy is refused, a step is moved only by its owner with its checks
 * done, and the version comes back so the next save from the same page goes through.
 */
const code = "A-2027";
const farida = userById("farida")!;

const all = async () => (await loadField(code, farida)).items;
const farmer = async (id: string) => (await all()).find((i) => i.id === id) as Farmer;
async function put(as: string, items: FieldItem[]) {
  const res = await PUT(new Request(`http://test/api/projects/${code}/field`, { method: "PUT", headers: { "x-demo-user": as, "content-type": "application/json" }, body: JSON.stringify({ items }) }), { params: Promise.resolve({ code }) });
  return { status: res.status, body: (await res.json()) as { error?: string; revs?: Record<string, string>; results?: string[] } };
}

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("saving Field activities from the browser", { timeout: 60_000 }, () => {
  it("saves an edit and returns the new version, so a second save from the same page goes through", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "train") as Farmer;
    const first = await put("farida", [{ ...f, checks: { ...f.checks, "train.attended": true } }]);
    expect(first.status).toBe(200);
    const rev = first.body.revs![f.id];
    expect(rev).toBeTruthy();
    expect(rev).not.toBe(f.rev);
    const second = await put("farida", [{ ...f, rev, checks: { ...f.checks, "train.attended": true, "train.register": true } }]);
    expect(second.status).toBe(200);
    expect((await farmer(f.id)).checks["train.register"]).toBe(true);
  });

  it("refuses a stale copy and keeps the newer work", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "train") as Farmer;
    // Another page saves first.
    expect((await put("farida", [{ ...f, timeline: [...f.timeline, { date: "2026-11-16", who: "extension", what: "Newer note" }] }])).status).toBe(200);
    // This page still holds the old version.
    const stale = await put("farida", [{ ...f, checks: {} }]);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/changed by someone else since you opened this page/);
    expect((await farmer(f.id)).timeline.at(-1)!.what).toBe("Newer note");
  });

  it("refuses a step moved by someone who does not own it", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "prepare") as Farmer;
    const ticked = { ...f, checks: { ...f.checks, "prepare.plot": true, "prepare.spec": true } };
    const byMel = await put("omar", [{ ...ticked, step: "verify" }]);
    expect(byMel.status).toBe(409);
    expect(byMel.body.error).toMatch(/is for the Extension agent to record/);
    expect((await farmer(f.id)).step).toBe("prepare");
  });

  it("refuses a move whose checks are not done, and accepts it once they are", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "prepare") as Farmer;
    const early = await put("farida", [{ ...f, checks: { ...f.checks, "prepare.plot": true }, step: "verify" }]);
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/Not done: Farmer reports land prepared to the technical spec/);
    const done = await put("farida", [{ ...f, checks: { ...f.checks, "prepare.plot": true, "prepare.spec": true }, step: "verify" }]);
    expect(done.status).toBe(200);
    expect((await farmer(f.id)).step).toBe("verify");
  });

  it("refuses moving past readiness without the joint visit recorded", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "verify") as Farmer;
    const skip = await put("omar", [{ ...f, checks: {}, step: "distribute" }]);
    expect(skip.status).toBe(409);
    expect(skip.body.error).toMatch(/cannot be recorded as "Readiness: Yes" yet/);
  });

  it("lets an outcome that goes ahead without its checks through, for the step's owner", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "correct") as Farmer;
    const res = await put("farida", [{ ...f, step: "removal" }]);
    expect(res.status).toBe(200);
    expect((await farmer(f.id)).step).toBe("removal");
  });

  it("records a handover but keeps the farmer at Distribute until the project manager approves", async () => {
    // The fertilizer's goods received note signed, so the package can go out.
    const p = (await loadProcurements(code)).find((x) => x.id === "PR-2027-011")!;
    await saveProcurements(code, [{ ...p, step: "package" }]);
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "distribute" && !(i as Farmer).awaiting) as Farmer;
    const done = { ...f, checks: { ...f.checks, "distribute.recipient": true, "distribute.voucher": true }, step: "plant" };
    const res = await put("bilal", [done]);
    expect(res.status).toBe(200);
    const after = await farmer(f.id);
    expect(after.step).toBe("distribute");
    expect(after.awaiting?.status).toBe("pending");
    expect(after.checks["distribute.voucher"]).toBe(true);
    // Recording it again is refused while it waits, with the reason.
    const again = await put("bilal", [{ ...after, step: "plant" }]);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already recorded and waiting for the project manager/);
    // The page cannot clear the marker itself.
    expect((await put("bilal", [{ ...after, awaiting: undefined, community: after.community }])).status).toBe(200);
    expect((await farmer(f.id)).awaiting?.status).toBe("pending");
  });

  it("keeps the version stamp out of the stored record", async () => {
    const { db, schema: s } = await import("@/db");
    const rows = await db.select().from(s.fieldItems);
    expect(rows.every((r) => !("rev" in (r.data as object)))).toBe(true);
  });
});

describe("recording planting", { timeout: 60_000 }, () => {
  // A farmer whose distribution the project manager approved: at "Plant and follow up".
  beforeAll(async () => {
    const f = await farmer("F-0002");
    const day = (await all()).find((i) => i.kind === "farmer" && i.planting)?.timeline[0]?.date ?? "2026-11-01";
    await saveItems(code, [{ ...f, step: "plant", awaiting: undefined, photos: [...f.photos, { id: "F-0002-n", activity: "distribution", date: day, caption: "Signed goods received note", src: "data:image/png;base64,AA==", signedNote: true }] }]);
  });
  const plantFarmer = () => farmer("F-0002");
  const ticked = (f: Farmer) => ({ ...f, checks: { ...f.checks, "plant.manner": true, "plant.followup": true } });

  it("refuses planting recorded without the day and the area", async () => {
    const f = ticked(await plantFarmer());
    const r = await put("farida", [{ ...f, step: "complete" }]);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Not done: Planting date and area recorded/);
  });

  it("lets only the extension agent enter the planting record", async () => {
    const f = await plantFarmer();
    const r = await put("bilal", [{ ...f, planting: { date: handedOutOn(f)!, hectares: f.hectares } }]);
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/for the extension agent to enter/);
  });

  it("counts the farmer toward a target that counts at planting, once, and then fixes the record", async () => {
    const setup = (await setupFor(code))!;
    await saveSetup(code, { ...setup, target: "IND-2", targetAt: "planting" });
    const f = ticked(await plantFarmer());
    const planting = { date: handedOutOn(f)!, hectares: f.hectares };
    const r = await put("farida", [{ ...f, planting, step: "complete" }]);
    expect(r.status).toBe(200);
    expect(r.body.results).toHaveLength(1);
    const made = (await loadResults(code)).filter((x) => x.planting === f.id);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ indicator: "IND-2", date: planting.date, value: 1, status: "pending", by: "farida" });
    expect((await farmer(f.id)).planting).toEqual(planting);
    // The extension agent sees at once that it counted.
    expect((await farmer(f.id)).timeline.at(-1)).toMatchObject({ who: "system", by: "ROP Workflow", what: expect.stringMatching(/^Counted toward ".+": waiting for MEL to accept it on the Results page$/) });
    // Filed: the record that was counted cannot be changed afterwards.
    const after = await farmer(f.id);
    const change = await put("farida", [{ ...after, planting: { ...planting, hectares: 0.1 } }]);
    expect(change.status).toBe(409);
    expect(change.body.error).toMatch(/already recorded/);
    // Naming the target again counts farmers planted before, never one already counted.
    const backfill = await countApprovedDistributions(code, "IND-2");
    expect((await loadResults(code)).filter((x) => x.planting === f.id)).toHaveLength(1);
    expect(await countApprovedDistributions(code, "IND-2")).toBe(0);
    // F-0001 planted last season in the sample story and was never counted.
    expect(backfill).toBe(1);
    await saveSetup(code, setup);
  });
});

describe("planting a crop counted one by one", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    const project = await projectByCode(code);
    await saveProjectState(project.id, CROP_PLAN_KEY, { by: "count", unit: "vines", rowM: 3, plantM: 1.5 });
    const f = await farmer("F-0008");
    await saveItems(code, [{ ...f, step: "plant", awaiting: undefined, photos: [...f.photos, { id: "F-0008-n", activity: "distribution", date: "2026-01-01", caption: "Signed goods received note", src: "data:image/png;base64,AA==", signedNote: true }] }]);
  });

  it("carries the project's crop plan to Field, and keeps it out of the package settings", async () => {
    expect((await loadField(code, farida)).setup?.plan).toMatchObject({ unit: "vines", rowM: 3 });
    const setup = (await setupFor(code))!;
    await saveSetup(code, setup);
    expect((await setupFor(code))!.plan).toMatchObject({ unit: "vines" });
  });

  it("refuses hectares that do not follow from the count, and saves those that do", async () => {
    const f = await farmer("F-0008");
    const wrong = await put("farida", [{ ...f, planting: { date: "2026-01-02", count: 1000, hectares: 0.6 } }]);
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/1000 planted at the project's spacing is 0.45 ha, not 0.6/);
    const right = await put("farida", [{ ...f, planting: { date: "2026-01-02", count: 1000, hectares: 0.45 } }]);
    expect(right.status).toBe(200);
    expect((await farmer("F-0008")).planting).toEqual({ date: "2026-01-02", count: 1000, hectares: 0.45 });
  });

  it("tells the extension agent when a farmer counted at handout is not counted again at planting", async () => {
    const setup = (await setupFor(code))!;
    await saveSetup(code, { ...setup, target: "IND-2", targetAt: "planting" });
    // F-0007's distribution was approved and counted toward IND-2 at the time.
    const farmerId = "F-0007";
    const { db: d, schema: sc } = await import("@/db");
    const project = await projectByCode(code);
    const [dist] = await d.insert(sc.evidence).values({ organizationId: project.organizationId, projectId: project.id, source: "manual", form: "distribution", reviewStatus: "accepted", farmerCode: farmerId, completedAt: new Date("2026-01-01T12:00:00Z"), payload: {} }).returning();
    await d.insert(sc.evidence).values({ organizationId: project.organizationId, projectId: project.id, source: "manual", form: "result", reviewStatus: "accepted", completedBy: "farida", completedAt: new Date("2026-01-01T12:00:00Z"), payload: { indicator: "IND-2", date: "2026-01-01", value: 1, note: "Input package given to farmer F-0007.", files: [], noFile: "Distribution record", distribution: dist.id } });
    const f = await farmer(farmerId);
    await saveItems(code, [{ ...f, step: "plant", awaiting: undefined }]);
    const got = await farmer(farmerId);
    const at = { ...got, checks: { ...got.checks, "plant.manner": true, "plant.followup": true } };
    const given = handedOutOn(at) ?? "2026-01-01";
    const before = (await loadResults(code)).length;
    const r = await put("farida", [{ ...at, planting: { date: given, count: 100, hectares: 0.05 }, step: "complete" }]);
    expect(r.status).toBe(200);
    expect((await loadResults(code)).length).toBe(before);
    expect((await farmer(farmerId)).timeline.at(-1)!.what).toMatch(/^Already counted toward ".+" when the package was handed out \(\d{4}-\d{2}-\d{2}\): not counted again$/);
    await saveSetup(code, setup);
  });
});
