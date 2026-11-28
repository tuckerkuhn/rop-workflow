import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { farmerQuestion, sessionFarmers } from "@/lib/kobo-setup";
import { actualFor, dataFlags, perFarmer, whoOf, type Indicator } from "@/lib/project";
import { seedDatabase } from "@/server/demo-seed";
import { loadField, roster, saveItems } from "@/server/field-store";
import { listSubmissions } from "@/server/kobo";
import { decide, settleHeld } from "@/server/review";
import { actOnSelection, loadSelection } from "@/server/selection-store";
import { GET as exportFile } from "@/app/api/projects/[code]/field/export/route";
import { ready } from "@/server/__tests__/test-db";

/**
 * Training attendance as one record per session (kobo/build_field_forms.py): the session, the date
 * and the register are given once and every farmer who attended is ticked. MEL accepts the record
 * once and each ticked farmer is recorded and counted, once. Records from the earlier form (one per
 * farmer, with `farmer` and `attended`) keep working beside it. No Kobo account is called:
 * submissions are placed in the database as a sync leaves them.
 */
const code = "A-2027";
const ASSET = "aTRAIN";
const omar = userById("omar")!; // MEL officer
const marcus = userById("marcus")!; // decides selection
const farida = userById("farida")!; // extension agent

let projectId = "";
let orgId: string | null = null;
let n = 5000;

const farmers = async () => (await loadField(code, farida)).items.filter((i): i is Farmer => i.kind === "farmer");
const farmer = async (id: string) => (await farmers()).find((f) => f.id === id)!;
const refusal = async (f: () => Promise<unknown>) => f().then(() => "", (e: Error) => e.message);
const queue = async (id: string) => (await listSubmissions(code)).submissions.find((x) => x.dbId === id)!;

/** A session record as the sync stores it: no farmer code on the row, the ticked farmers in the answers. */
async function session(ticked: string[], answers: Record<string, string> = {}) {
  n += 1;
  const [row] = await db
    .insert(s.evidence)
    .values({ organizationId: orgId, projectId, source: "kobo", koboAssetUid: ASSET, koboSubmissionId: n, koboSubmissionUuid: `session-${n}`, form: "training", reviewStatus: "pending", farmerCode: null, completedBy: "farida", completedAt: new Date(Date.UTC(2026, 10, 14, 8, 0, n - 5000)), payload: { _id: n, training_date: "2026-11-10", session: "land_prep", register_ref: "Book 2 p. 14", photo: "register.jpg", farmers: ticked.join(" "), ...answers } })
    .returning({ id: s.evidence.id });
  return row.id;
}
/** A record from the earlier form: one farmer, attended yes or no. */
async function single(farmerCode: string, attended: "yes" | "no") {
  n += 1;
  const [row] = await db
    .insert(s.evidence)
    .values({ organizationId: orgId, projectId, source: "kobo", koboAssetUid: ASSET, koboSubmissionId: n, koboSubmissionUuid: `single-${n}`, form: "training", reviewStatus: "pending", farmerCode, completedBy: "farida", completedAt: new Date(Date.UTC(2026, 10, 14, 8, 0, n - 5000)), payload: { _id: n, training_date: "2026-11-11", session: "land_prep", register_ref: "Book 2 p. 15", photo: "register.jpg", farmer: farmerCode, attended } })
    .returning({ id: s.evidence.id });
  return row.id;
}

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  const [project] = await db.select().from(s.projects).where(eq(s.projects.code, code));
  projectId = project.id;
  orgId = project.organizationId;
}, 120_000);

describe("the pure rules", () => {
  it("reads the ticked farmers of a session record and leaves a one-farmer record alone", () => {
    expect(sessionFarmers({ farmers: "F-0001 F-0002  F-0001" })).toEqual(["F-0001", "F-0002"]);
    expect(sessionFarmers({ farmers: "" })).toEqual([]);
    expect(sessionFarmers({ farmer: "F-0001", attended: "yes" })).toBeNull();
    expect(farmerQuestion("farmers")).toEqual({ linked: "farmers", ticks: "farmers", one: "farmer" });
    expect(farmerQuestion("group/farmer")).toEqual({ linked: "farmer", ticks: "group/farmers", one: "group/farmer" });
    expect(farmerQuestion("farmer_sex")).toBeNull();
  });

});

describe("one training record per session", { timeout: 90_000 }, () => {
  it("shows one row in the queue with its farmers, and flags the ones that will not move", async () => {
    const all = await farmers();
    const atTrain = all.filter((f) => f.step === "train").slice(0, 1);
    const past = all.find((f) => f.step !== "train")!;
    const id = await session([atTrain[0].id, past.id, "F-9999"]);
    const sub = await queue(id);
    expect(sub.form).toBe("training");
    expect(sub.farmerId).toBe("");
    expect(sub.farmers).toEqual([atTrain[0].id, past.id, "F-9999"]);
    expect(sub.fields).toEqual({ session: "Land prep", attended: `${atTrain[0].id}, ${past.id}, F-9999`, register: "Book 2 p. 14" });
    expect(sub.date).toBe("2026-11-10");
    expect(sub.photo).toBe(true);
    expect(whoOf(sub)).toBe("3 farmers");
    const flags = dataFlags(sub, [sub], await roster(projectId));
    expect(flags).toContain("Not on the project roster: F-9999. Their attendance stays on this record only");
    expect(flags).toContain(`Past training: ${past.id}. Attendance will be recorded but their step will not move`);
    // The same session on the same day sent twice is flagged on the later record only.
    const again = await queue(await session([atTrain[0].id]));
    expect(dataFlags(again, [sub, again]).some((f) => f.startsWith(`Possible duplicate of ${sub.id} (same session, same day)`))).toBe(true);
    expect(dataFlags(sub, [sub, again]).some((f) => f.startsWith("Possible duplicate"))).toBe(false);
    await db.delete(s.evidence).where(and(eq(s.evidence.projectId, projectId), eq(s.evidence.koboAssetUid, ASSET)));
  });

  it("records every ticked farmer when MEL accepts once: moved, kept at Train, noted or not on the list", async () => {
    const all = await farmers();
    const [a, b] = all.filter((f) => f.step !== "train" && f.step !== "complete").slice(0, 2);
    const past = all.find((f) => f.step === "complete") ?? all.find((f) => f.step !== "train" && f.id !== a.id && f.id !== b.id)!;
    await saveItems(code, [
      { ...a, step: "train", enrolled: true, contributionPaid: true, checks: {} },
      { ...b, step: "train", enrolled: true, contributionPaid: false, checks: {} },
    ]);
    const id = await session([a.id, b.id, past.id, "F-9999"]);
    // Nothing moves until a named person accepts.
    expect((await farmer(a.id)).step).toBe("train");

    const { applied } = await decide(code, id, "accepted", omar);
    expect(applied).toBe(`Training recorded for 4 farmers. 1 moved to Prepare the plot. 1 stays at Train: ${b.id} (contribution not yet paid). 1 already past Train, attendance noted: ${past.id}. Not on the farmer list, kept on this record only: F-9999.`);

    const moved = await farmer(a.id);
    expect(moved.step).toBe("prepare");
    expect(moved.checks["train.attended"] && moved.checks["train.register"]).toBe(true);
    expect(moved.timeline.at(-1)!.what).toMatch(/^Training recorded: land prep, register Book 2 p\. 14 \(Kobo KB-\d+, accepted by/);
    expect(moved.timeline.at(-1)!.date).toBe("2026-11-10");

    const stays = await farmer(b.id);
    expect(stays.step).toBe("train");
    expect(stays.checks["train.attended"]).toBe(true);
    expect(stays.timeline.at(-1)!.what).toMatch(/^Attended land prep, register Book 2 p\. 14; stays at Train: contribution not yet paid/);

    const noted = await farmer(past.id);
    expect(noted.step).toBe(past.step);
    expect(noted.timeline.at(-1)!.what).toMatch(/^Attended land prep/);

    // The audit trail names every farmer the decision covered.
    const [log] = await db.select({ detail: s.auditLog.detail }).from(s.auditLog).where(and(eq(s.auditLog.entityId, id), eq(s.auditLog.action, "accepted")));
    expect((log.detail as { farmers?: string[] }).farmers).toEqual([a.id, b.id, past.id, "F-9999"]);
    // Accepting it a second time changes nothing.
    expect((await decide(code, id, "accepted", omar)).already).toBe("accepted");
    expect((await farmer(a.id)).timeline.length).toBe(moved.timeline.length);
  });

  // Decision P, 25 Nov 2026: one held farmer no longer holds up the others on a session record.
  it("records everyone else when a ticked farmer is held in Farmer selection, and keeps the held farmer open on the record", async () => {
    expect(await actOnSelection(code, { action: "criteria", outreach: "Announced at the village meeting.", criteria: ["Farms 0.2 to 2 ha"], reason: "" }, marcus)).toBeNull();
    const rules = (await loadSelection(code, marcus)).selection.criteria.map((c) => c.id);
    const all = await farmers();
    const [left, held, free] = all.filter((f) => f.step !== "train" && f.step !== "prepare").slice(-3);
    await saveItems(code, [
      { ...left, step: "train", enrolled: true, contributionPaid: true, checks: {} },
      { ...held, step: "train", enrolled: true, contributionPaid: true, checks: {} },
      { ...free, step: "train", enrolled: true, contributionPaid: true, checks: {} },
    ]);
    for (const f of [held, left]) expect(await actOnSelection(code, { action: "decide", farmer: f.id, outcome: "waitlisted", met: rules, reason: "Places are full this season.", change: "" }, marcus)).toBeNull();
    const id = await session([free.id, held.id, left.id]);
    const ind: Indicator = { id: "T", result: "", name: "Farmers trained", unit: "farmers", target: 20, source: "training", frequency: "Monthly", donorRef: "" };
    // What this one record counts toward a target counted straight from training forms.
    const counted = async () => actualFor(ind, [await queue(id)]).value!;
    const before = await counted();
    expect(before).toBe(0);

    const r = await decide(code, id, "accepted", omar);
    expect(r.applied).toContain("Training recorded for 1 farmer. 1 moved to Prepare the plot.");
    expect(r.applied).toContain(`2 farmers are not recorded and stay open on this record: ${held.id} is waitlisted in Farmer selection; ${left.id} is waitlisted in Farmer selection. Select them first, or leave them out.`);
    // The farmer who is clear moved. The held ones did not, and nothing was written on their records.
    expect((await farmer(free.id)).step).toBe("prepare");
    expect((await farmer(held.id)).step).toBe("train");
    expect((await farmer(held.id)).timeline.some((x) => x.what.includes(`Kobo KB-${n},`))).toBe(false);
    // The record is accepted for the others and names who stays open. Only the recorded farmer counts.
    const q = await queue(id);
    expect(q.status).toBe("accepted");
    expect(q.farmers).toEqual([free.id]);
    expect(q.held?.map((h) => h.id)).toEqual([held.id, left.id]);
    expect(await counted()).toBe(before + 1);
    // The tick list as the phone sent it is kept beside it.
    const [row] = await db.select({ payload: s.evidence.payload }).from(s.evidence).where(eq(s.evidence.id, id));
    expect((row.payload as Record<string, string>)._rop_ticked).toBe(`${free.id} ${held.id} ${left.id}`);
    const [log] = await db.select({ detail: s.auditLog.detail }).from(s.auditLog).where(and(eq(s.auditLog.entityId, id), eq(s.auditLog.action, "accepted")));
    expect(log.detail).toMatchObject({ farmers: [free.id], held: [held.id, left.id] });

    // Home tells the person who may accept the record that two farmers are left open on it.
    const { loadHome } = await import("@/server/home-store");
    expect((await loadHome(code, omar)).actions.find((a) => a.key === "held-farmers")?.text).toBe("2 farmers are left open on training records: record each once selected, or leave them out");

    // Still held: recording them is refused with the same message.
    expect(await refusal(() => settleHeld(code, id, held.id, "record", omar))).toBe(`${held.id} is waitlisted in Farmer selection. Select them first, or leave them out.`);
    expect((await farmer(held.id)).step).toBe("train");
    // Selected: recorded as the others were, and counted from now on.
    expect(await actOnSelection(code, { action: "decide", farmer: held.id, outcome: "selected", met: rules, reason: "", change: "A place came free." }, marcus)).toBeNull();
    const done = await settleHeld(code, id, held.id, "record", omar);
    expect(done.applied).toBe(`${held.id}: Training recorded. Moved to Prepare the plot.`);
    expect((await farmer(held.id)).step).toBe("prepare");
    expect((await queue(id)).farmers).toEqual([free.id, held.id]);
    expect((await queue(id)).held?.map((h) => h.id)).toEqual([left.id]);
    expect(await counted()).toBe(before + 2);
    // Pressing again records nothing twice.
    expect((await settleHeld(code, id, held.id, "record", omar)).already).toBe(true);
    expect((await farmer(held.id)).timeline.filter((x) => x.what.includes(`Kobo ${q.id},`)).length).toBe(1);

    // Left out: off the record for good, nothing recorded for them, not counted.
    const out = await settleHeld(code, id, left.id, "leave_out", omar);
    expect(out.applied).toBe(`${left.id} is left out of this record. Nothing was recorded for them.`);
    expect((await farmer(left.id)).step).toBe("train");
    expect((await queue(id)).held).toBeUndefined();
    expect((await loadHome(code, omar)).actions.find((a) => a.key === "held-farmers")).toBeUndefined();
    expect((await queue(id)).farmers).toEqual([free.id, held.id]);
    expect(await counted()).toBe(before + 2);
    expect((await db.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, id), eq(s.auditLog.action, "held_farmer_left_out")))).length).toBe(1);
    expect((await db.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, id), eq(s.auditLog.action, "held_farmer_recorded")))).length).toBe(1);
    // A held farmer on a session counts on the other two paths the same way: only those in the tick list.
    expect(sessionFarmers((await db.select({ payload: s.evidence.payload }).from(s.evidence).where(eq(s.evidence.id, id)))[0].payload as Record<string, unknown>)).toEqual([free.id, held.id]);
  });

  it("still refuses a session whose farmers are all held, and a record about one held farmer", async () => {
    const rules = (await loadSelection(code, marcus)).selection.criteria.map((c) => c.id);
    const all = await farmers();
    const [a, b] = all.filter((f) => f.step !== "train" && f.step !== "prepare").slice(0, 2);
    await saveItems(code, [
      { ...a, step: "train", enrolled: true, contributionPaid: true, checks: {} },
      { ...b, step: "train", enrolled: true, contributionPaid: true, checks: {} },
    ]);
    for (const f of [a, b]) expect(await actOnSelection(code, { action: "decide", farmer: f.id, outcome: "waitlisted", met: rules, reason: "Places are full this season.", change: "" }, marcus)).toBeNull();
    const both = await session([a.id, b.id]);
    expect(await refusal(() => decide(code, both, "accepted", omar))).toBe(`2 farmers on this record are held in Farmer selection: ${a.id} is waitlisted in Farmer selection; ${b.id} is waitlisted in Farmer selection. Select them first, or send this form back.`);
    expect((await queue(both)).status).toBe("pending");
    const one = await single(a.id, "yes");
    expect(await refusal(() => decide(code, one, "accepted", omar))).toBe(`${a.id} is waitlisted in Farmer selection. Select them first, or send this form back.`);
    expect((await queue(one)).status).toBe("pending");
    expect((await farmer(a.id)).step).toBe("train");
    // Sending it back stays open.
    expect((await decide(code, both, "queried", omar, `${a.id} and ${b.id} are waitlisted`)).applied).toBeNull();
    expect((await queue(both)).status).toBe("queried");
  });

  it("counts each ticked farmer once toward a target counted straight from training forms, and never an absence", async () => {
    await db.delete(s.evidence).where(and(eq(s.evidence.projectId, projectId), eq(s.evidence.koboAssetUid, ASSET)));
    const ind: Indicator = { id: "T", result: "", name: "Farmers trained", unit: "farmers", target: 20, source: "training", frequency: "Monthly", donorRef: "" };
    const before = actualFor(ind, (await listSubmissions(code)).submissions).value!;
    const first = await session(["F-8001", "F-8002", "F-8003"]);
    const second = await session(["F-8003", "F-8004"], { training_date: "2026-11-12" });
    const absent = await single("F-8005", "no");
    const present = await single("F-8006", "yes");
    // Waiting records count nothing yet.
    let now = actualFor(ind, (await listSubmissions(code)).submissions);
    expect(now.value).toBe(before);
    expect(now.pending).toBeGreaterThanOrEqual(4);
    for (const id of [first, second, absent, present]) await decide(code, id, "accepted", omar);
    now = actualFor(ind, (await listSubmissions(code)).submissions);
    // Four from the two sessions (F-8003 once) and one from the earlier form. The absence is kept, not counted.
    expect(now.value).toBe(before + 5);
    expect(perFarmer([await queue(first)]).map((x) => [x.farmerId, x.fields.attended])).toEqual([["F-8001", "Yes"], ["F-8002", "Yes"], ["F-8003", "Yes"]]);
  });

  it("gives the records table one row per ticked farmer, so it still joins to the farmer table", async () => {
    await db.delete(s.evidence).where(and(eq(s.evidence.projectId, projectId), eq(s.evidence.koboAssetUid, ASSET)));
    await session(["F-8101", "F-8102"]);
    const res = await exportFile(new Request(`http://test/api/projects/${code}/field/export?table=records`, { headers: { "x-demo-user": "omar" } }), { params: Promise.resolve({ code }) });
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\n").filter((l) => l.includes("F-8101") || l.includes("F-8102"));
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.includes("Training attendance"))).toBe(true);
  });
});
