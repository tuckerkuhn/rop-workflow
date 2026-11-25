import { randomBytes } from "node:crypto";
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
import { mappedInputs, mappedValue, saveMappings } from "@/server/kobo-link";
import { koboToResults } from "@/server/kobo-results";
import { loadResults } from "@/server/results-store";
import { decide } from "@/server/review";
import { actOnSelection, loadSelection } from "@/server/selection-store";
import { encryptSecret } from "@/server/secrets";
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
  process.env.KOBO_TOKEN_KEY = randomBytes(32).toString("base64");
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

  it("counts each ticked farmer once as a different answer", () => {
    const rows = [
      { date: "2026-11-10", payload: { farmers: "F-0001 F-0002 F-0003" } },
      { date: "2026-11-12", payload: { farmers: "F-0003 F-0004" } },
      // A record from the earlier form, as mappedInputs reads it beside the tick list.
      { date: "2026-11-13", payload: { farmer: "F-0005" } },
      { date: "2026-11-13", payload: { farmer: "F-0001" } },
    ];
    expect(mappedValue({ method: "count_unique", question: "farmers", value: null }, rows).value).toBe(5);
    // A link made on the earlier form's question counts the session records too.
    expect(mappedValue({ method: "count_unique", question: "farmer", value: null }, rows).value).toBe(5);
    // On any other form the farmer question still counts whole answers, one each.
    expect(mappedValue({ method: "count_unique", question: "farmer", value: null }, [{ date: "", payload: { farmer: "F-0001" } }, { date: "", payload: { farmer: "F-0001" } }, { date: "", payload: { farmer: "F-0002" } }]).value).toBe(2);
    // Each record that answers the tick list: two sessions held.
    expect(mappedValue({ method: "count_answered", question: "farmers", value: null }, rows).value).toBe(2);
    // Any other question still counts whole answers.
    expect(mappedValue({ method: "count_unique", question: "village", value: null }, [{ date: "", payload: { village: "North Hill" } }, { date: "", payload: { village: "North Hill" } }]).value).toBe(1);
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

  it("refuses the whole record while a ticked farmer is held in Farmer selection, and names them", async () => {
    expect(await actOnSelection(code, { action: "criteria", outreach: "Announced at the village meeting.", criteria: ["Farms 0.2 to 2 ha"], reason: "" }, marcus)).toBeNull();
    const rules = (await loadSelection(code, marcus)).selection.criteria.map((c) => c.id);
    const all = await farmers();
    const [held, free] = all.filter((f) => f.step !== "train" && f.step !== "prepare").slice(-2);
    await saveItems(code, [
      { ...held, step: "train", enrolled: true, contributionPaid: true, checks: {} },
      { ...free, step: "train", enrolled: true, contributionPaid: true, checks: {} },
    ]);
    expect(await actOnSelection(code, { action: "decide", farmer: held.id, outcome: "waitlisted", met: rules, reason: "Places are full this season.", change: "" }, marcus)).toBeNull();
    const id = await session([free.id, held.id]);
    expect(await refusal(() => decide(code, id, "accepted", omar))).toBe(`${held.id} is waitlisted in Farmer selection. Select them first, or send this form back.`);
    // Nobody moved, and the record still waits.
    expect((await farmer(free.id)).step).toBe("train");
    expect((await queue(id)).status).toBe("pending");
    // Sending it back stays open.
    expect((await decide(code, id, "queried", omar, `${held.id} is waitlisted: untick them`)).applied).toBeNull();
    expect((await queue(id)).status).toBe("queried");
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

  it("makes one result for MEL per session, counting only farmers not counted before, with women and men from their records", async () => {
    await db.delete(s.evidence).where(and(eq(s.evidence.projectId, projectId), eq(s.evidence.koboAssetUid, ASSET)));
    await db.insert(s.koboConnections).values({ projectId, serverUrl: "https://kobo.invalid", tokenEncrypted: encryptSecret("not-a-real-token"), tokenHint: "oken" }).onConflictDoNothing();
    await db.insert(s.koboForms).values({ projectId, assetUid: ASSET, name: "Training attendance", purpose: "training" });
    await db.insert(s.indicators).values({ projectId, unit: "farmers", target: "100", level: "output", source: "results", frequency: "monthly", disaggregation: ["sex"], code: "IND-21", name: "Farmers trained", position: 21 });
    await saveMappings(code, [{ indicatorCode: "IND-21", assetUid: ASSET, question: "farmers", method: "count_unique", value: null }], "nadia");

    const all = await farmers();
    const [w, x, y, z] = all.slice(0, 4);
    const women = (list: Farmer[]) => list.filter((f) => f.gender === "Female").length;
    const first = await session([w.id, x.id, y.id]);
    const second = await session([y.id, z.id], { training_date: "2026-11-12" });
    const old = await single(all[4].id, "yes");
    const absent = await single(all[5].id, "no");
    const mine = async () => (await loadResults(code)).filter((r) => r.kobo?.asset === ASSET);

    // Waiting for MEL: nothing counted yet.
    await koboToResults(code);
    expect(await mine()).toHaveLength(0);

    await db.update(s.evidence).set({ reviewStatus: "accepted" }).where(and(eq(s.evidence.projectId, projectId), eq(s.evidence.koboAssetUid, ASSET)));
    const counts = await koboToResults(code);
    expect(counts.added).toBe(3);
    const rows = await mine();
    const of = async (id: string) => {
      const [e] = await db.select({ num: s.evidence.koboSubmissionId }).from(s.evidence).where(eq(s.evidence.id, id));
      return rows.find((r) => r.kobo?.id === e.num);
    };
    expect(await of(first)).toMatchObject({ value: 3, female: women([w, x, y]), male: 3 - women([w, x, y]), date: "2026-11-10" });
    // The farmer ticked at both sessions is counted at the first only.
    expect(await of(second)).toMatchObject({ value: 1, female: women([z]), male: 1 - women([z]), date: "2026-11-12" });
    // A record from the earlier form still counts its one farmer; an absence makes no result.
    expect(await of(old)).toMatchObject({ value: 1 });
    expect(await of(absent)).toBeUndefined();
    // Running it again adds nothing.
    expect((await koboToResults(code)).added).toBe(0);
    expect(await mine()).toHaveLength(3);

    // The same figure on the linked-question path Progress reads: five different farmers.
    const m = (await mappedInputs(projectId)).get("IND-21")!;
    expect(mappedValue(m.mapping, m.counted).value).toBe(5);

    // A project that linked the earlier form's `farmer` question keeps counting when the form changes:
    // the session records count their ticked farmers under that link too. Here the absence counts as
    // it always did under that link, which is what the project chose.
    await saveMappings(code, [{ indicatorCode: "IND-21", assetUid: ASSET, question: "farmer", method: "count_unique", value: null }], "nadia");
    const viaOld = (await mappedInputs(projectId)).get("IND-21")!;
    expect(mappedValue(viaOld.mapping, viaOld.counted).value).toBe(6);
    await koboToResults(code);
    const relinked = await mine();
    const sessionResult = relinked.find((r) => r.value === 3);
    expect(sessionResult).toMatchObject({ value: 3, date: "2026-11-10" });
    expect(relinked.reduce((t, r) => t + r.value, 0)).toBe(6);
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
