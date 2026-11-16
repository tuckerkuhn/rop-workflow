import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { dataFlags } from "@/lib/project";
import { seedDatabase } from "@/server/demo-seed";
import { loadField, saveItems } from "@/server/field-store";
import { listSubmissions } from "@/server/kobo";
import { decide } from "@/server/review";
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

  it("moves nobody on a queried record", async () => {
    const f = (await farmers()).find((x) => x.step === "train")!;
    await saveItems(code, [{ ...f, enrolled: true, contributionPaid: true }]);
    const id = await submit("training", f.id, { session: "land_prep", attended: "yes", register_ref: "" });
    expect((await decide(code, id, "queried", omar, "Register reference missing")).applied).toBeNull();
    expect((await farmer(f.id)).step).toBe("train");
  });
});
