import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { PUT } from "@/app/api/projects/[code]/field/route";
import { userById } from "@/lib/demo";
import type { Farmer, FieldItem } from "@/lib/field";
import { seedDatabase } from "@/server/demo-seed";
import { loadField, saveItems, saveSetup, setupFor } from "@/server/field-store";
import { KOBO_ONLY, handedOutOn } from "@/lib/field";
import { countApprovedDistributions, countPlanting } from "@/server/distribution";
import { loadResults } from "@/server/results-store";
import { ready } from "@/server/__tests__/test-db";
import { saveProjectState } from "@/server/project-state";
import { projectByCode } from "@/server/field-store";
import { CROP_PLAN_KEY } from "@/lib/crops";

/**
 * Saving Field activities from the browser (PUT /api/projects/[code]/field). Field steps are
 * recorded in KoboCollect, so ticking a step's checks, moving a step or entering planting by hand
 * is refused. What the page still saves (notes, issues, the project manager's remove-or-extend
 * decision) refuses a stale copy, and the version comes back so the next save goes through.
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
  it("saves an issue on the record and returns the new version, so a second save from the same page goes through", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "train") as Farmer;
    const issue = { id: "I-1", type: "Field issue", note: "Plot boundary disputed with a neighbour.", by: "extension", blocking: false, status: "open" as const };
    const first = await put("farida", [{ ...f, issues: [...f.issues, issue] }]);
    expect(first.status).toBe(200);
    const rev = first.body.revs![f.id];
    expect(rev).toBeTruthy();
    expect(rev).not.toBe(f.rev);
    const second = await put("farida", [{ ...f, rev, issues: [...f.issues, { ...issue, status: "resolved" as const, resolution: "Settled with the village council." }] }]);
    expect(second.status).toBe(200);
    expect((await farmer(f.id)).issues.at(-1)?.status).toBe("resolved");
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

  it("refuses a field step entered by hand: KoboCollect is the one source", async () => {
    const train = (await all()).find((i) => i.kind === "farmer" && i.step === "train") as Farmer;
    const tick = await put("farida", [{ ...train, checks: { ...train.checks, "train.attended": true, "train.register": true } }]);
    expect(tick.status).toBe(409);
    expect(tick.body.error).toBe(KOBO_ONLY);
    const prep = (await all()).find((i) => i.kind === "farmer" && i.step === "prepare") as Farmer;
    const move = await put("farida", [{ ...prep, checks: { ...prep.checks, "prepare.plot": true, "prepare.spec": true }, step: "verify" }]);
    expect(move.status).toBe(409);
    expect(move.body.error).toBe(KOBO_ONLY);
    expect((await farmer(prep.id)).step).toBe("prepare");
    const verify = (await all()).find((i) => i.kind === "farmer" && i.step === "verify") as Farmer;
    expect((await put("omar", [{ ...verify, step: "distribute" }])).body.error).toBe(KOBO_ONLY);
  });

  it("refuses a handover recorded by hand: distributions come from KoboCollect, for the project manager to approve", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "distribute" && !(i as Farmer).awaiting) as Farmer;
    const res = await put("bilal", [{ ...f, checks: { ...f.checks, "distribute.recipient": true, "distribute.voucher": true }, step: "plant" }]);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(KOBO_ONLY);
    const after = await farmer(f.id);
    expect(after.step).toBe("distribute");
    expect(after.awaiting).toBeUndefined();
  });

  it("keeps the project manager's decision to remove a farmer or extend the deadline", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "removal") as Farmer;
    // Not the extension agent's to decide.
    const notHers = await put("farida", [{ ...f, step: "correct" }]);
    expect(notHers.status).toBe(409);
    expect(notHers.body.error).toMatch(/is for the Project manager to record/);
    const res = await put("nadia", [{ ...f, step: "correct", deadline: "2027-03-20", timeline: [...f.timeline, { date: "2026-11-20", who: "manager", what: "Deadline extended 7 days" }] }]);
    expect(res.status).toBe(200);
    expect((await farmer(f.id)).step).toBe("correct");
  });

  it("keeps the version stamp out of the stored record", async () => {
    const { db, schema: s } = await import("@/db");
    const rows = await db.select().from(s.fieldItems);
    expect(rows.every((r) => !("rev" in (r.data as object)))).toBe(true);
  });
});

describe("recording the contribution received", { timeout: 60_000 }, () => {
  it("records it from the app, and moves on a farmer whose training KoboCollect already recorded", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "train") as Farmer;
    await saveItems(code, [{ ...f, enrolled: true, contributionPaid: false, checks: { ...f.checks, "train.attended": true, "train.register": true } }]);
    const got = await farmer(f.id);
    const r = await put("farida", [{ ...got, contributionPaid: true, timeline: [...got.timeline, { date: "2026-11-16", who: "extension", what: "Contribution received" }] }]);
    expect(r.status).toBe(200);
    const after = await farmer(f.id);
    expect(after.contributionPaid).toBe(true);
    expect(after.step).toBe("prepare");
    expect(after.timeline.at(-1)!.what).toMatch(/^Contribution received; training already recorded from KoboCollect/);
  });

  it("records it without moving a farmer whose training is not recorded yet", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "train") as Farmer;
    await saveItems(code, [{ ...f, enrolled: true, contributionPaid: false, checks: {} }]);
    const got = await farmer(f.id);
    expect((await put("farida", [{ ...got, contributionPaid: true }])).status).toBe(200);
    expect((await farmer(f.id)).contributionPaid).toBe(true);
    expect((await farmer(f.id)).step).toBe("train");
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

  it("refuses a planting record entered by hand", async () => {
    const f = ticked(await plantFarmer());
    const r = await put("farida", [{ ...f, planting: { date: handedOutOn(f)!, hectares: f.hectares }, step: "complete" }]);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe(KOBO_ONLY);
    expect((await farmer(f.id)).planting).toBeUndefined();
  });

  it("counts the farmer toward a target that counts at planting, once, and then fixes the record", async () => {
    const setup = (await setupFor(code))!;
    await saveSetup(code, { ...setup, target: "IND-2", targetAt: "planting" });
    const f = ticked(await plantFarmer());
    const planting = { date: handedOutOn(f)!, hectares: f.hectares };
    await saveItems(code, [{ ...f, planting, step: "complete" }]);
    const r = await countPlanting(code, { ...f, planting, step: "complete" }, farida);
    expect(r?.result).toBeTruthy();
    const made = (await loadResults(code)).filter((x) => x.planting === f.id);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ indicator: "IND-2", date: planting.date, value: 1, status: "pending", by: "farida" });
    expect((await farmer(f.id)).planting).toEqual(planting);
    // The extension agent sees at once that it counted.
    expect((await farmer(f.id)).timeline.at(-1)).toMatchObject({ who: "system", by: "ROP Workflow", what: expect.stringMatching(/^Counted toward ".+": waiting for MEL to accept it on the Results page$/) });
    // Counted once: counting the same farmer again adds nothing.
    expect((await countPlanting(code, { ...f, planting, step: "complete" }, farida))?.already).toBe(true);
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
    const planted = { ...at, planting: { date: given, count: 100, hectares: 0.05 }, step: "complete" };
    await saveItems(code, [planted]);
    const r = await countPlanting(code, planted, farida);
    expect(r?.already).toBe(true);
    expect((await loadResults(code)).length).toBe(before);
    expect((await farmer(farmerId)).timeline.at(-1)!.what).toMatch(/^Already counted toward ".+" when the package was handed out \(\d{4}-\d{2}-\d{2}\): not counted again$/);
    await saveSetup(code, setup);
  });
});

describe("history save times", { timeout: 60_000 }, () => {
  it("stamps a new history line with the time it was saved and keeps it through the next save", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "train") as Farmer;
    const first = await put("farida", [{ ...f, timeline: [...f.timeline, { date: "2026-11-20", who: "extension", what: "Visited", at: "2030-01-01T00:00:00.000Z" }] }]);
    expect(first.status).toBe(200);
    const saved = (await farmer(f.id)).timeline.at(-1) as { at?: string };
    expect(saved.at).toBeTruthy();
    expect(saved.at).not.toBe("2030-01-01T00:00:00.000Z");
    // The screen's copy has no times; saving it again keeps the stored one.
    const again = await farmer(f.id);
    const bare = again.timeline.map((t) => ({ date: t.date, who: t.who, what: t.what }));
    expect((await put("farida", [{ ...again, timeline: bare, issues: [...again.issues, { id: "I-9", type: "Evidence gap", note: "Register page missing.", by: "extension", blocking: false, status: "open" }] }])).status).toBe(200);
    expect(((await farmer(f.id)).timeline.at(-1) as { at?: string }).at).toBe(saved.at);
  });
});
