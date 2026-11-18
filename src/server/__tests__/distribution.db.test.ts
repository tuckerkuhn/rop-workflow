import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq, like } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { seedDatabase } from "@/server/demo-seed";
import { checkKoboDistribution, decideDistribution, listDistributions, recordFromApp, resubmitDistribution, stockFor } from "@/server/distribution";
import { saveKoboApproval } from "@/server/kobo-approval";
import { saveMappings } from "@/server/kobo-link";
import { realToday } from "@/lib/clock";
import { loadField, saveItems, saveSetup, setupFor } from "@/server/field-store";
import { loadHome } from "@/server/home-store";
import { loadProcurements, saveProcurements } from "@/server/procurement-store";
import { loadProgress } from "@/server/progress-store";
import { loadResults, reviewResult } from "@/server/results-store";
import { ready } from "@/server/__tests__/test-db";

// As the screen and the field route require before a distribution is recorded: the recipient's
// signature or thumbprint is confirmed. Without it the distribution cannot be approved.
const handedOut = (f: Farmer): Farmer => ({ ...f, photos: [...f.photos, { id: "note", activity: "distribution" as const, date: "2027-01-01", caption: "Signed goods received note", src: "data:image/png;base64,AA==", signedNote: true }], checks: { ...f.checks, "distribute.recipient": true }, step: "plant" });


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
// As the field route does: the farmer is saved at "distribute", then the distribution recorded;
// the farmer moves to planting only when the project manager approves.
const record = async (id: string, by = farida) => {
  const f = await farmer(id);
  await saveItems(code, [f]);
  return recordFromApp(code, handedOut(f), by, "http://test");
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
    // The fertilizer's received note is not signed yet, so the store has nothing to hand out: Home says so,
    // and the project manager is told to get it in.
    expect((await loadHome(code, bilal)).actions.find((a) => a.key === "field:distribute")?.text).toMatch(/^Distribute the input package: 2 farmers are waiting, but the store has nothing to hand out yet\. NPK 17-17-17:/);
    // Purchases for the package are already under way, so the row names them rather than asking for one.
    expect((await loadHome(code, userById("nadia")!)).actions.find((a) => a.key === "restock")?.text).toMatch(/^2 farmers waiting at Distribute for inputs on the way: PR-2027-\d+ NPK fertilizer/);
    const listed = await listDistributions(code);
    expect(listed.map((d) => [d.farmerId, d.status, d.gate.ok])).toEqual([["F-0002", "pending", true]]);
    // Recorded in the app by the storekeeper: named, and never held for a KoboCollect check.
    expect(listed[0].recordedBy).toBe("Bilal Haidari");
    expect(listed[0].notified?.why ?? "").not.toMatch(/KoboCollect/);
    // The demo's waiting distribution keeps its farmer at "distribute", shown as waiting for approval.
    expect(await farmer("F-0002")).toMatchObject({ step: "distribute", awaiting: { status: "pending" } });
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
    expect(await refusal(() => recordFromApp(code, handedOut(f), farida, "http://test"))).toMatch(/PR-2027-011 has been delivered: once its goods received note is signed/);
    expect(await evidence()).toHaveLength(2);
  });

  it("lets it through once the received note is signed", async () => {
    const p = (await loadProcurements(code)).find((x) => x.id === "PR-2027-011")!;
    await saveProcurements(code, [{ ...p, step: "package" }]);
    expect(await stock()).toEqual({ seed: 380, npk: 600 });
    const f = await farmer("F-0007");
    first = await recordFromApp(code, handedOut(f), farida, "http://test");
    // The same save arriving again (a retry, a double tap) is the same record.
    expect(await recordFromApp(code, handedOut(f), farida, "http://test")).toBe(first);
    // The farmer waits at "distribute" for the project manager; nothing moves them on before that.
    expect(await farmer("F-0007")).toMatchObject({ step: "distribute", awaiting: { id: first, status: "pending" } });
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

  it("puts the approval on the manager's Home, and keeps the farmers off everyone else's until it is approved", async () => {
    expect((await loadHome(code, nadia)).actions.find((a) => a.key === "distributions")?.bucket).toBe("approve");
    // Nobody is left waiting for inputs, so the storekeeper's Home has no field row.
    expect((await loadHome(code, bilal)).actions.some((a) => a.key === "field:distribute")).toBe(false);
    // Not ready to plant yet: nobody moves to planting before the project manager approves.
    expect((await loadHome(code, farida)).actions.some((a) => a.key === "field:plant")).toBe(false);
  });

  it("sends a record back to the person who recorded it, with a task on their Home", async () => {
    expect(await refusal(() => decideDistribution(code, first, "sent_back", nadia, " "))).toMatch(/Say what needs fixing/);
    const back = await decideDistribution(code, first, "sent_back", nadia, "Signature missing on the list");
    // The farmer stays at "distribute", showing why it came back.
    expect(await farmer("F-0007")).toMatchObject({ step: "distribute", awaiting: { id: first, status: "sent_back", note: "Signature missing on the list" } });
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
    expect((await farmer("F-0007")).awaiting).toEqual({ id: first, status: "pending" });
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
    // Approval is what moves the farmer on to planting.
    const moved = await farmer("F-0007");
    expect(moved.step).toBe("plant");
    expect(moved.awaiting).toBeUndefined();
    expect(moved.timeline.at(-1)!.what).toBe("Distribution approved by Nadia Rahimi: moved to planting");
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

  it("opens the finished demo project with its procurement calendar already built", async () => {
    const { loadPlan } = await import("@/server/procurement-plan-store");
    const plan = await loadPlan(code);
    // One entry for each budget line that is bought through procurement (lib/demo-design).
    expect(plan.length).toBeGreaterThanOrEqual(6);
    expect(new Set(plan.map((i) => i.budgetCode))).toEqual(new Set(["2.1", "2.2", "2.3", "2.4", "2.5", "3.1"]));
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

  it("counts a KoboCollect distribution toward the same target, once checked and approved, under its collector", async () => {
    const project = (await db.select().from(s.projects).where(eq(s.projects.code, code)))[0];
    // The KoboCollect account farida.kobo belongs to Farida; Omar (MEL) checks, Nadia approves.
    await saveKoboApproval(code, { who: "mel", accounts: { "farida.kobo": "farida" } });
    const someone = (await loadField(code, farida)).items.find((i) => i.kind === "farmer") as Farmer;
    const [row] = await db
      .insert(s.evidence)
      .values({ organizationId: project.organizationId, projectId: project.id, source: "kobo", form: "distribution", farmerCode: someone.id, reviewStatus: "pending", completedBy: "farida.kobo", completedAt: new Date(), koboAssetUid: "aDistForm", koboSubmissionUuid: "kobo-dist-1", koboSubmissionId: 9001, payload: { seed_given: "yes", seed_qty: "1", npk_given: "no", signed: "yes", list_photo: "list.jpg" } })
      .returning({ id: s.evidence.id });
    await listDistributions(code);
    // Not before the KoboCollect check.
    expect(await refusal(() => decideDistribution(code, row.id, "approved", nadia))).toMatch(/came from KoboCollect/);
    await checkKoboDistribution(code, row.id, { id: omar.id, name: omar.name }, "http://test");
    const res = await decideDistribution(code, row.id, "approved", nadia);
    expect(res.target).toBe("IND-2");
    const made = (await loadResults(code)).filter((r) => r.distribution === row.id);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ indicator: "IND-2", value: 1, status: "pending", by: "farida" });
  });

  it("does not let a distribution form be mapped to a target in the KoboToolbox setup", async () => {
    const project = (await db.select().from(s.projects).where(eq(s.projects.code, code)))[0];
    await db.insert(s.koboForms).values({ projectId: project.id, assetUid: "aDistForm", name: "Input distribution", purpose: "distribution" });
    expect(await refusal(() => saveMappings(code, [{ indicatorCode: "IND-2", assetUid: "aDistForm", question: "farmer", method: "count_answered", value: null }], "omar"))).toMatch(/Input package/);
  });
});
