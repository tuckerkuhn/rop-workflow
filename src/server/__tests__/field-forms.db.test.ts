import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { dataFlags } from "@/lib/project";
import { seedDatabase } from "@/server/demo-seed";
import { loadField, saveItems, saveSetup, setupFor } from "@/server/field-store";
import { loadResults } from "@/server/results-store";
import { plantingFromVisit } from "@/server/review";
import { listSubmissions } from "@/server/kobo";
import { decide } from "@/server/review";
import { loadHome } from "@/server/home-store";
import { GET as listQueue } from "@/app/api/projects/[code]/submissions/route";
import { ready } from "@/server/__tests__/test-db";

/**
 * The training attendance and farm visit forms (kobo/build_field_forms.py) on the demo project:
 * a submission waits in the review queue and moves the farmer only once MEL accepts it.
 */
const code = "A-2027";
const omar = userById("omar")!;
const farida = userById("farida")!;

const farmers = async () => (await loadField(code, farida)).items.filter((i): i is Farmer => i.kind === "farmer");
const farmer = async (id: string) => (await farmers()).find((f) => f.id === id)!;
let n = 9000;

async function submit(form: "training" | "visit", farmerCode: string, answers: Record<string, string>) {
  const [project] = await db.select().from(s.projects).where(eq(s.projects.code, code)).limit(1);
  n += 1;
  const [row] = await db
    .insert(s.evidence)
    .values({ organizationId: project.organizationId, projectId: project.id, source: "kobo", koboAssetUid: `a${form}`, koboSubmissionId: n, koboSubmissionUuid: `uuid-${n}`, form, reviewStatus: "pending", farmerCode, completedBy: "farida", payload: { _id: n, farmer: farmerCode, ...answers } })
    .returning({ id: s.evidence.id });
  return row.id;
}

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("training attendance and farm visit forms", { timeout: 60_000 }, () => {
  it("shows a training submission in the queue with its answers and nothing moved yet", async () => {
    const f = (await farmers()).find((x) => x.step === "train")!;
    await saveItems(code, [{ ...f, enrolled: true, contributionPaid: true }]);
    const id = await submit("training", f.id, { training_date: "2026-11-10", session: "land_prep", attended: "yes", register_ref: "Book 2 p. 14" });
    const sub = (await listSubmissions(code)).submissions.find((x) => x.dbId === id)!;
    expect(sub.form).toBe("training");
    expect(sub.fields).toEqual({ session: "Land prep", attended: "Yes", register: "Book 2 p. 14" });
    expect(sub.date).toBe("2026-11-10");
    expect((await farmer(f.id)).step).toBe("train");

    const { applied } = await decide(code, id, "accepted", omar);
    expect(applied).toBe("Training recorded. Moved to Prepare the plot.");
    const after = await farmer(f.id);
    expect(after.step).toBe("prepare");
    expect(after.checks["train.attended"] && after.checks["train.register"]).toBe(true);
    expect(after.timeline.at(-1)!.what).toMatch(/^Training recorded: land prep, register Book 2 p\. 14 \(Kobo KB-\d+, accepted by/);
  });

  it("keeps a trained farmer at Train while the contribution is unpaid, and records an absence without moving", async () => {
    const a = (await farmers()).find((x) => x.step === "train")!;
    await saveItems(code, [{ ...a, enrolled: true, contributionPaid: false }]);
    const paid = await decide(code, await submit("training", a.id, { session: "land_prep", attended: "yes", register_ref: "B2 p15" }), "accepted", omar);
    expect(paid.applied).toBe("Attendance recorded. Stays at Train: contribution not yet paid.");
    expect((await farmer(a.id)).step).toBe("train");
    expect((await farmer(a.id)).checks["train.attended"]).toBe(true);

    const absent = await submit("training", a.id, { session: "land_prep", attended: "no", register_ref: "B2 p15" });
    const sub = (await listSubmissions(code)).submissions.find((x) => x.dbId === absent)!;
    expect(dataFlags(sub, [sub])).toContain("Marked as not attended: accepting it records the absence only");
    expect((await decide(code, absent, "accepted", omar)).applied).toMatch(/^Not attended/);
    expect((await farmer(a.id)).step).toBe("train");
  });

  it("records planting from an accepted visit, or the follow-up when not planted as trained", async () => {
    const all = await farmers();
    const [p, q] = all.filter((x) => x.step === "plant").concat(all.filter((x) => x.step === "distribute").map((x) => ({ ...x, step: "plant" })));
    await saveItems(code, [p, q]);

    const good = await submit("visit", p.id, { visit_date: "2026-11-12", purpose: "planting_followup", both_present: "yes", planted: "yes", planting_date: "2026-11-05", spacing_ok: "yes" });
    expect((await decide(code, good, "accepted", omar)).applied).toBe("Planting recorded. Season path complete.");
    expect((await farmer(p.id)).step).toBe("complete");
    expect((await farmer(p.id)).timeline.at(-1)!.what).toMatch(/^Planting recorded on 2026-11-05/);

    const late = await submit("visit", q.id, { visit_date: "2026-11-12", purpose: "planting_followup", both_present: "yes", planted: "no", issue: "Waiting for irrigation turn" });
    const sub = (await listSubmissions(code)).submissions.find((x) => x.dbId === late)!;
    expect(sub.fields).toEqual({ purpose: "Planting followup", both_present: "Yes", planted: "No", issue: "Waiting for irrigation turn" });
    expect((await decide(code, late, "accepted", omar)).applied).toBe("Visit recorded: not yet planted. Stays at Plant for follow-up.");
    const after = await farmer(q.id);
    expect(after.step).toBe("plant");
    expect(after.timeline.at(-1)!.what).toMatch(/To follow up: Waiting for irrigation turn/);
  });

  it("writes the planting date and area from an accepted visit and counts it toward a target that counts at planting", async () => {
    const setup = (await setupFor(code))!;
    await saveSetup(code, { ...setup, target: "IND-2", targetAt: "planting" });
    const f = (await farmers()).find((x) => x.step === "distribute" && !x.planting)!;
    await saveItems(code, [{ ...f, step: "plant", awaiting: undefined }]);
    const area = Math.round(f.hectares * 50) / 100;
    const id = await submit("visit", f.id, { visit_date: "2026-11-12", purpose: "planting_followup", both_present: "yes", planted: "yes", planting_date: "2026-11-06", spacing_ok: "yes", area_planted: String(area) });
    const sub = (await listSubmissions(code)).submissions.find((x) => x.dbId === id)!;
    expect(sub.fields.area).toBe(String(area));

    const { applied } = await decide(code, id, "accepted", omar);
    expect(applied).toBe("Planting recorded. Season path complete. Counted toward the target, waiting for MEL on the Results page.");
    const after = await farmer(f.id);
    expect(after.step).toBe("complete");
    expect(after.planting).toEqual({ date: "2026-11-06", hectares: area });
    expect(after.timeline.some((t) => t.what.startsWith(`Planting recorded on 2026-11-06, ${area} of ${f.hectares} ha, at the trained spacing`))).toBe(true);
    const made = (await loadResults(code)).filter((r) => r.planting === f.id);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ indicator: "IND-2", date: "2026-11-06", status: "pending" });
    await saveSetup(code, setup);
  });

  it("keeps the farmer at Plant when the planting record does not hold up", async () => {
    const f = (await farmers()).find((x) => !["complete", "plant", "train"].includes(x.step) && !x.planting)!;
    await saveItems(code, [{ ...f, step: "plant", awaiting: undefined }]);
    const id = await submit("visit", f.id, { visit_date: "2026-11-12", purpose: "planting_followup", both_present: "yes", planted: "yes", planting_date: "2026-11-06", spacing_ok: "yes", area_planted: String(f.hectares + 5) });
    expect((await decide(code, id, "accepted", omar)).applied).toMatch(/^Visit recorded\. Planting not recorded: .*more than the farmer's plot/);
    const after = await farmer(f.id);
    expect(after.step).toBe("plant");
    expect(after.planting).toBeUndefined();
  });

  it("works out the area from the number planted for a crop counted one by one", () => {
    const plan = { by: "count" as const, unit: "vines", rowM: 3, plantM: 1.5 };
    // 10,000 m² / 4.5 m² = 2,222 vines a hectare: 1,111 vines is 0.5 ha.
    expect(plantingFromVisit({ planting_date: "2026-11-06", count: "1111", area: "0.9" }, "2026-11-12", 1, plan)).toEqual({ planting: { date: "2026-11-06", count: 1111, hectares: 0.5 }, assumed: false });
    expect(plantingFromVisit({ planting_date: "2026-11-06", area: "0.4" }, "2026-11-12", 1, null)).toEqual({ planting: { date: "2026-11-06", hectares: 0.4 }, assumed: false });
    // A visit from the form before it asked the area: the farmer's plot, said so on the record.
    expect(plantingFromVisit({}, "2026-11-12", 0.7, null)).toEqual({ planting: { date: "2026-11-12", hectares: 0.7 }, assumed: true });
    // A number planted that cannot become hectares is never taken as the whole plot.
    expect(plantingFromVisit({ count: "400" }, "2026-11-12", 0.7, { by: "area" })).toEqual({ problem: "The visit gave a number planted, but this crop is planned by area: record the area planted." });
    expect(plantingFromVisit({ count: "400" }, "2026-11-12", 0.7, { by: "count", unit: "vines" })).toMatchObject({ problem: expect.stringMatching(/cannot turn it into hectares/) });
    // With the area typed too, the area stands and the count is kept.
    expect(plantingFromVisit({ count: "400", area: "0.3" }, "2026-11-12", 0.7, { by: "area" })).toEqual({ planting: { date: "2026-11-12", hectares: 0.3, count: 400 }, assumed: false });
  });

  it("moves nobody on a queried record", async () => {
    const f = (await farmers()).find((x) => x.step === "train")!;
    await saveItems(code, [{ ...f, enrolled: true, contributionPaid: true }]);
    const id = await submit("training", f.id, { session: "land_prep", attended: "yes", register_ref: "" });
    expect((await decide(code, id, "queried", omar, "Register reference missing")).applied).toBeNull();
    expect((await farmer(f.id)).step).toBe("train");
  });
  it("puts waiting field forms on Home for whoever may decide them, and says who on the queue", async () => {
    const f = (await farmers()).find((x) => x.step === "train")!;
    await submit("training", f.id, { session: "land_prep", attended: "yes", register_ref: "B3 p1" });
    const forms = (h: Awaited<ReturnType<typeof loadHome>>) => h.actions.find((a) => a.key === "field-forms");
    // Collected by farida: MEL (omar) decides it, farida does not.
    expect(forms(await loadHome(code, omar))?.href).toBe("/progress/results#field-records");
    expect(forms(await loadHome(code, omar))?.text).toMatch(/^Check \d+ field forms? \(readiness, training, farm visits\)/);
    expect(forms(await loadHome(code, farida))).toBeUndefined();

    const res = await listQueue(new Request(`http://test/api/projects/${code}/submissions`, { headers: { "x-demo-user": "farida" } }), { params: Promise.resolve({ code }) });
    const { submissions } = (await res.json()) as { submissions: { farmerId: string; status: string; form: string; mayDecide: boolean; deciders: string }[] };
    const mine = submissions.find((x) => x.farmerId === f.id && x.status === "pending" && x.form === "training")!;
    expect(mine.mayDecide).toBe(false);
    // The demo project names the Director of MEL for KoboCollect data, with the MEL officer as stand-in.
    expect(mine.deciders).toBe("Rahima Stanikzai or Omar Sadiq");
  });
});
