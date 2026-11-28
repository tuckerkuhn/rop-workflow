import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { dataFlags } from "@/lib/project";
import { seedDatabase } from "@/server/demo-seed";
import { loadField, saveItems } from "@/server/field-store";
import { listSubmissions } from "@/server/kobo";
import { decide } from "@/server/review";
import { formFor, saveForm } from "@/server/app-forms";
import { listDistributions } from "@/server/distribution";
import { ready } from "@/server/__tests__/test-db";

/**
 * Review round 1, Part 2 step 1: field forms filled in inside the app save the same records a
 * KoboCollect submission did, so the review queue, Field activities and the distribution approval
 * read them as they read KoboCollect records.
 */
const code = "A-2027";
const omar = userById("omar")!;
const farida = userById("farida")!;
const bilal = userById("bilal")!;
const hamid = userById("hamid")!;
// A tiny real JPEG would do; any base64 picture passes the shape check.
const PIC = `data:image/jpeg;base64,${Buffer.from("fictional photo bytes").toString("base64")}`;
let n = 0;
const entry = (answers: Record<string, string>, photos?: Record<string, string>) => ({ entryId: `test-${++n}`, answers: { start_geopoint: "34.52 69.17 1800 5", ...answers }, ...(photos ? { photos } : {}) });

const farmers = async () => (await loadField(code, farida)).items.filter((i): i is Farmer => i.kind === "farmer");
const farmer = async (id: string) => (await farmers()).find((f) => f.id === id)!;

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("field forms filled in inside the app", { timeout: 60_000 }, () => {
  it("a training session waits in the queue, then moves every farmer ticked once MEL accepts it", async () => {
    const [a, b] = (await farmers()).filter((x) => x.step === "train");
    await saveItems(code, [{ ...a, enrolled: true, contributionPaid: true }, { ...b, enrolled: true, contributionPaid: true }]);
    const { id } = (await saveForm(code, "training", entry({ session: "land_prep", farmers: `${a.id} ${b.id}`, curriculum: "Wheat farmer field school, version 2.1", score_max: "10", scores: `${a.id}:4:8`, register_ref: "Book 3 p. 2", photo: "x" }, { photo: PIC }), farida)) as { id: string };
    const sub = (await listSubmissions(code)).submissions.find((x) => x.dbId === id)!;
    expect(sub.source).toBe("form");
    expect(sub.farmers).toEqual([a.id, b.id]);
    expect(sub.photo).toBe(true);
    expect(sub.gps).toEqual([34.52, 69.17]);
    expect(sub.enumerator).toBe("farida");
    expect((await farmer(a.id)).step).toBe("train");
    // The person who filled it in does not accept it.
    const { applied } = await decide(code, id, "accepted", omar);
    expect(applied).toBeTruthy();
    expect((await farmer(a.id)).step).toBe("prepare");
    expect((await farmer(b.id)).timeline.at(-1)!.what).toMatch(/\(Recorded in the app by Farida Noori, AF-[0-9a-f]{8}, accepted by Omar Sadiq\)/);
    // MF-09: the curriculum and each farmer's scores go on their record.
    expect((await farmer(a.id)).trainings?.at(-1)).toMatchObject({ session: "Land prep", curriculum: "Wheat farmer field school, version 2.1", pre: 4, post: 8, outOf: 10 });
    expect((await farmer(a.id)).timeline.at(-1)!.what).toContain("pre-test 4/10, post-test 8/10");
    expect((await farmer(b.id)).trainings?.at(-1)).not.toHaveProperty("pre");
    // The audit log says who filled it in, and keeps the photo's fingerprint, never the photo.
    const [log] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, id), eq(s.auditLog.action, "form_filled")));
    expect(log.detail).toMatchObject({ by: "farida", form: "training", farmers: [a.id, b.id] });
    expect(JSON.stringify(log.detail)).not.toContain("base64");
  });

  it("saving the same form twice keeps one record", async () => {
    const f = (await farmers()).find((x) => x.step === "verify" || x.step === "prepare")!;
    const e = entry({ farmer: f.id, visit_type: "first", both_present: "yes", ready: "yes", photo: "x" }, { photo: PIC });
    const one = (await saveForm(code, "readiness", e, farida)) as { id: string; again: boolean };
    const two = (await saveForm(code, "readiness", e, farida)) as { id: string; again: boolean };
    expect(two).toEqual({ id: one.id, again: true });
    const sub = (await listSubmissions(code)).submissions.find((x) => x.dbId === one.id)!;
    expect(sub.fields.result).toBe("Yes");
    expect(dataFlags(sub, [sub], { [f.id]: f.step })).not.toContain("No GPS point recorded");
  });

  it("the server checks the rules again, and a photo question needs its photo", async () => {
    const f = (await farmers())[0];
    await expect(saveForm(code, "readiness", entry({ farmer: f.id, visit_type: "first", both_present: "yes", ready: "no", photo: "x" }, { photo: PIC }), farida)).rejects.toThrow(/What needs fixing\? This is needed\./);
    await expect(saveForm(code, "readiness", entry({ farmer: f.id, visit_type: "first", both_present: "yes", ready: "yes", photo: "x" }), farida)).rejects.toThrow(/the photo did not arrive/);
    await expect(saveForm(code, "readiness", entry({ farmer: "F-NOT-HERE", visit_type: "first", both_present: "yes", ready: "yes", photo: "x" }, { photo: PIC }), farida)).rejects.toThrow(/not on this project's farmer list/);
    // Someone with no say in Field activities fills in nothing.
    await expect(saveForm(code, "readiness", entry({ farmer: f.id }), hamid)).rejects.toThrow(/Only field staff/);
  });

  it("a distribution gets the same checks as one from KoboCollect and goes to the project manager", async () => {
    const f = (await farmers()).find((x) => x.step === "distribute")!;
    const { form } = await formFor(code, "distribution", bilal);
    const given = Object.fromEntries(form.questions.filter((q) => q.name.endsWith("_given")).map((q) => [q.name, "yes"]));
    const { id } = (await saveForm(code, "distribution", entry({ farmer: f.id, ...given, condition: "good", signed: "yes", list_photo: "x" }, { list_photo: PIC }), bilal)) as { id: string };
    const d = (await listDistributions(code)).find((x) => x.id === id)!;
    expect(d.status).toBe("pending");
    expect(d.photo).toBe(true);
    expect(d.signed).toBe(true);
    expect(d.items.length).toBeGreaterThan(0);
    expect(d.approvers).not.toContain("bilal");
    // Part 2 step 3: every distribution needs the recipient's signed receipt and its photo, from the app too.
    const g = (await farmers()).find((x) => x.step === "distribute" && x.id !== f.id);
    expect(g).toBeDefined();
    {
      const { id: unsigned } = (await saveForm(code, "distribution", entry({ farmer: g!.id, ...given, condition: "good", signed: "no", list_photo: "x" }, { list_photo: PIC }), bilal)) as { id: string };
      expect((await listDistributions(code)).find((x) => x.id === unsigned)!.closeBlock).toMatch(/signature or thumbprint on the distribution receipt is not confirmed/);
    }
    await expect(saveForm(code, "distribution", entry({ farmer: f.id, ...given, condition: "good", signed: "yes", list_photo: "x" }), bilal)).rejects.toThrow(/the photo did not arrive/);
  });

  it("registering a farmer adds them to the farmer list, once", async () => {
    const r = await saveForm(code, "register", entry({ farmer_id: "F-APP-001", village: "Qala-e-Nau", sex: "Female", hectares: "0.4", household: "Female 31, Male 35, Female 6", contribution_paid: "no" }), farida);
    expect(r).toMatchObject({ farmer: { id: "F-APP-001", added: 1 } });
    const f = await farmer("F-APP-001");
    expect(f).toMatchObject({ gender: "Female", hectares: 0.4, community: "Qala-e-Nau", householdSize: 3, household: [{ sex: "Female", age: 31 }, { sex: "Male", age: 35 }, { sex: "Female", age: 6 }] });
    await expect(saveForm(code, "register", entry({ farmer_id: "F-APP-001", village: "Qala", sex: "Male", hectares: "1" }), farida)).rejects.toThrow(/already registered on this project/);
    // MF-08: the same person registered again under a new ID is caught by the phone, and saved once checked.
    await saveForm(code, "register", entry({ farmer_id: "F-APP-003", farmer_name: "Zainab Fictional", phone: "070 111 2222", village: "Qala", sex: "Female", hectares: "1" }), farida);
    const again = entry({ farmer_id: "F-APP-004", farmer_name: "Zaynab Fictionel", phone: "+93 70 111 2222", village: "Qala", sex: "Female", hectares: "1" });
    const refused = await saveForm(code, "register", again, farida).catch((e) => e);
    expect(refused.status).toBe(409);
    expect(refused.message).toContain("F-APP-004 has the same phone number as F-APP-003");
    expect(refused.message).not.toContain("Zainab");
    expect(refused.extra.duplicates).toEqual([{ id: "F-APP-004", other: "F-APP-003", why: "phone" }]);
    expect(await saveForm(code, "register", { ...again, duplicatesChecked: true }, farida)).toMatchObject({ farmer: { id: "F-APP-004", added: 1 } });
    // The MEL officer fills in forms but does not register farmers.
    await expect(saveForm(code, "register", entry({ farmer_id: "F-APP-002", village: "Qala", sex: "Male", hectares: "1" }), omar)).rejects.toThrow(/register farmers/);
  });
});
