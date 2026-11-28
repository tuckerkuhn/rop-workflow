import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import { CROP_PLAN_KEY } from "@/lib/crops";
import type { Farmer, FieldItem } from "@/lib/field";
import { seedDatabase } from "@/server/demo-seed";
import { decideDistribution, listDistributions } from "@/server/distribution";
import { loadField, projectByCode, saveItems } from "@/server/field-store";
import { saveProjectState } from "@/server/project-state";
import { decide } from "@/server/review";
import { actOnSelection, loadSelection } from "@/server/selection-store";
import { PUT } from "@/app/api/projects/[code]/field/route";
import { approveAs } from "@/server/__tests__/receipt-helper";
import { ready } from "@/server/__tests__/test-db";

/**
 * Farmer selection enforced on the server: a farmer waitlisted or left out is not moved along by an
 * accepted KoboCollect form or given inputs by an approved distribution, whatever the page shows.
 * The Train rule runs again when enrolment or selection changes. A farm visit's number planted is
 * never taken as the whole plot.
 */
const code = "A-2027";
const omar = userById("omar")!; // MEL
const marcus = userById("marcus")!; // plan approver: decides selection
const nadia = userById("nadia")!; // project manager
const farida = userById("farida")!; // extension agent

const farmers = async () => (await loadField(code, farida)).items.filter((i): i is Farmer => i.kind === "farmer");
const farmer = async (id: string) => (await farmers()).find((f) => f.id === id)!;
const refusal = async (f: () => Promise<unknown>) => f().then(() => "", (e: Error) => e.message);
const status = async (id: string) => (await db.select({ st: s.evidence.reviewStatus }).from(s.evidence).where(eq(s.evidence.id, id)))[0].st;
let n = 7000;
let rules: string[] = [];

async function submit(form: "training" | "visit" | "readiness", farmerCode: string, answers: Record<string, string>) {
  const project = await projectByCode(code);
  n += 1;
  const [row] = await db
    .insert(s.evidence)
    .values({ organizationId: project.organizationId, projectId: project.id, source: "kobo", koboAssetUid: `a${form}`, koboSubmissionId: n, koboSubmissionUuid: `uuid-${n}`, form, reviewStatus: "pending", farmerCode, completedBy: "farida", payload: { _id: n, farmer: farmerCode, ...answers } })
    .returning({ id: s.evidence.id });
  return row.id;
}
/** Records a selection decision; one already decided is changed with a reason. */
const outcome = async (farmerId: string, o: "selected" | "waitlisted" | "not_qualified", change = "") => {
  const decided = farmerId in (await loadSelection(code, marcus)).selection.decisions;
  return actOnSelection(code, { action: "decide", farmer: farmerId, outcome: o, met: o === "not_qualified" ? [] : rules, reason: o === "selected" ? "" : "Places are full this season.", change: change || (decided ? "Checked again with the village committee." : "") }, marcus);
};
async function put(items: FieldItem[]) {
  const res = await PUT(new Request(`http://test/api/projects/${code}/field`, { method: "PUT", headers: { "x-demo-user": "farida", "content-type": "application/json" }, body: JSON.stringify({ items }) }), { params: Promise.resolve({ code }) });
  return { status: res.status, body: (await res.json()) as { error?: string } };
}

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  expect(await actOnSelection(code, { action: "criteria", outreach: "Announced at the village meeting.", criteria: ["Farms 0.2 to 2 ha"], reason: "" }, marcus)).toBeNull();
  rules = (await loadSelection(code, marcus)).selection.criteria.map((c) => c.id);
}, 120_000);

describe("selection enforced on the server", { timeout: 60_000 }, () => {
  it("refuses to accept a training form for a waitlisted farmer, and still lets MEL send it back", async () => {
    const f = await farmer("F-0003");
    await saveItems(code, [{ ...f, step: "train", enrolled: true, contributionPaid: true }]);
    expect(await outcome(f.id, "waitlisted")).toBeNull();
    const id = await submit("training", f.id, { session: "land_prep", attended: "yes", register_ref: "B1 p2" });
    expect(await refusal(() => decide(code, id, "accepted", omar))).toBe(`${f.id} is waitlisted in Farmer selection. Select them first, or send this form back.`);
    expect(await status(id)).toBe("pending");
    expect((await farmer(f.id)).step).toBe("train");
    expect((await decide(code, id, "queried", omar, "Farmer is waitlisted; not trained this season")).applied).toBeNull();
    expect(await status(id)).toBe("queried");
  });

  it("refuses a readiness check or farm visit for a farmer who did not qualify", async () => {
    const v = await farmer("F-0009");
    const p = { ...(await farmer("F-0012")), step: "plant", awaiting: undefined, planting: undefined };
    await saveItems(code, [{ ...v, step: "verify" }, p]);
    expect(await outcome(v.id, "not_qualified")).toBeNull();
    expect(await outcome(p.id, "not_qualified")).toBeNull();
    const r = await submit("readiness", v.id, { result: "yes", both_present: "yes" });
    expect(await refusal(() => decide(code, r, "accepted", omar))).toMatch(new RegExp(`^${v.id} is marked Did not qualify in Farmer selection\\. Select them first`));
    const visit = await submit("visit", p.id, { visit_date: "2026-11-12", purpose: "planting_followup", both_present: "yes", planted: "yes", planting_date: "2026-11-05", spacing_ok: "yes" });
    expect(await refusal(() => decide(code, visit, "accepted", omar))).toMatch(/Did not qualify in Farmer selection/);
    expect((await farmer(p.id)).step).toBe("plant");
    expect((await farmer(p.id)).planting).toBeUndefined();
  });

  it("refuses to approve a distribution for a waitlisted farmer; sending it back stays open", async () => {
    const d = (await listDistributions(code)).find((x) => x.status === "pending")!;
    expect(await outcome(d.farmerId, "waitlisted")).toBeNull();
    expect(await refusal(() => approveAs(code, d.id, nadia))).toBe(`Not approved: ${d.farmerId} is waitlisted in Farmer selection. Select them first, or send this distribution back.`);
    expect(await status(d.id)).toBe("pending");
    expect((await decideDistribution(code, d.id, "sent_back", nadia, "Farmer is waitlisted")).decision).toBe("sent_back");
  });
});

describe("the Train rule runs again when its inputs change", { timeout: 60_000 }, () => {
  it("moves on a farmer whose training was accepted while not enrolled, once enrolment is recorded", async () => {
    const f = { ...(await farmer("F-0004")), step: "train", checks: {} };
    await saveItems(code, [{ ...f, enrolled: false, contributionPaid: true }]);
    expect(await outcome(f.id, "selected")).toBeNull();
    const id = await submit("training", f.id, { session: "land_prep", attended: "yes", register_ref: "B1 p3" });
    expect((await decide(code, id, "accepted", omar)).applied).toBe("Attendance recorded. Stays at Train: not enrolled.");
    const stuck = await farmer(f.id);
    expect(stuck.step).toBe("train");
    const saved = await put([{ ...stuck, enrolled: true }]);
    expect(saved.status).toBe(200);
    const after = await farmer(f.id);
    expect(after.step).toBe("prepare");
    expect(after.timeline.at(-1)!.what).toBe("Enrolment recorded; training already recorded from KoboCollect: moved to Prepare the plot");
  });

  it("keeps a waitlisted farmer at Train when the contribution is recorded, and moves them on once selected", async () => {
    const f = { ...(await farmer("F-0005")), step: "train", checks: {} };
    await saveItems(code, [{ ...f, enrolled: true, contributionPaid: false }]);
    expect(await outcome(f.id, "selected")).toBeNull();
    const id = await submit("training", f.id, { session: "land_prep", attended: "yes", register_ref: "B1 p4" });
    expect((await decide(code, id, "accepted", omar)).applied).toBe("Attendance recorded. Stays at Train: contribution not yet paid.");
    expect(await outcome(f.id, "waitlisted")).toBeNull();
    expect((await put([{ ...(await farmer(f.id)), contributionPaid: true }])).status).toBe(200);
    const held = await farmer(f.id);
    expect(held.step).toBe("train");
    expect(held.timeline.at(-1)!.what).toBe(`Contribution received; training already recorded, but stays at Train: ${f.id} is waitlisted in Farmer selection`);
    expect(await outcome(f.id, "selected", "A place came free after a farmer withdrew.")).toBeNull();
    const after = await farmer(f.id);
    expect(after.step).toBe("prepare");
    expect(after.timeline.at(-1)!.what).toBe(`Selected in Farmer selection by ${marcus.name}; training already recorded from KoboCollect: moved to Prepare the plot`);
  });
});

describe("a farm visit's number planted", { timeout: 60_000 }, () => {
  it("is never taken as the whole plot for a crop planned by area: the farmer stays at Plant, saying what to record", async () => {
    const project = await projectByCode(code);
    await saveProjectState(project.id, CROP_PLAN_KEY, { by: "area" });
    const f = await farmer("F-0007");
    expect(await outcome(f.id, "selected")).toBeNull();
    await saveItems(code, [{ ...f, step: "plant", awaiting: undefined }]);
    const id = await submit("visit", f.id, { visit_date: "2026-11-12", purpose: "planting_followup", both_present: "yes", planted: "yes", planting_date: "2026-11-06", spacing_ok: "yes", number_planted: "400" });
    expect((await decide(code, id, "accepted", omar)).applied).toBe("Visit recorded. Planting not recorded: The visit gave a number planted, but this crop is planned by area: record the area planted. Stays at Plant.");
    const after = await farmer(f.id);
    expect(after.step).toBe("plant");
    expect(after.planting).toBeUndefined();
    expect(after.timeline.at(-1)!.what).toMatch(/this crop is planned by area: record the area planted/);
  });
});
