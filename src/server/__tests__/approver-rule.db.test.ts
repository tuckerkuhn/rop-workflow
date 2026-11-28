import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { seedDatabase } from "@/server/demo-seed";
import { checkKoboDistribution, decideDistribution, listDistributions, recordFromApp, resubmitDistribution } from "@/server/distribution";
import { saveKoboApproval } from "@/server/kobo-approval";
import { loadField, saveItems } from "@/server/field-store";
import { loadHome } from "@/server/home-store";
import { loadProcurements, saveProcurements } from "@/server/procurement-store";
import { decide } from "@/server/review";
import { approveAs } from "@/server/__tests__/receipt-helper";
import { ready } from "@/server/__tests__/test-db";

/**
 * Two rules at the last step of an input distribution, against a real database: nobody approves a
 * distribution they recorded or collected (it goes to another manager, else to the person they
 * report to), and it cannot close until the recipient's signed note is confirmed.
 */
const code = "A-2027";
const nadia = userById("nadia")!;
const karim = userById("karim")!;
const omar = userById("omar")!;
const bilal = userById("bilal")!;
const refusal = async (f: () => Promise<unknown>) => f().then(() => "", (e: Error) => e.message);
const farmer = async (id: string) => (await loadField(code, nadia)).items.find((i) => i.id === id) as Farmer;
const row = (id: string) => listDistributions(code).then((all) => all.find((d) => d.id === id)!);
const homeRow = async (u: typeof nadia) => (await loadHome(code, u)).actions.find((a) => a.key === "distributions")?.text;

let own = "";

beforeAll(async () => {
  await ready;
  await seedDatabase();
  // The second fertilizer lot's received note is signed, so the store has stock.
  const p = (await loadProcurements(code)).find((x) => x.id === "PR-2027-011")!;
  await saveProcurements(code, [{ ...p, step: "package" }]);
}, 120_000);

describe("who approves an input distribution", { timeout: 60_000 }, () => {
  it("sends a distribution the project manager recorded herself to the person she reports to", async () => {
    const f = await farmer("F-0007");
    await saveItems(code, [f]);
    own = await recordFromApp(code, { ...f, photos: [...f.photos, { id: "note", activity: "distribution" as const, date: "2027-01-01", caption: "Signed distribution receipt", src: "data:image/png;base64,AA==", signedNote: true }], checks: { ...f.checks, "distribute.recipient": true }, step: "plant" }, nadia, "http://test");
    const d = await row(own);
    expect(d.approvers).toEqual(["karim"]);
    expect(d.approverNames).toBe("Karim Ahmadi");
    // The notice went to him, not to her.
    expect(d.notified?.to).toEqual(["karim"]);
  });

  it("refuses her approval and her send-back, with who decides instead", async () => {
    expect(await refusal(() => approveAs(code, own, nadia))).toBe("You recorded this distribution, so someone else approves it: Karim Ahmadi.");
    expect(await refusal(() => decideDistribution(code, own, "sent_back", nadia, "Wrong amount"))).toMatch(/^You recorded this distribution/);
    expect(await refusal(() => approveAs(code, own, bilal))).toBe("Only Karim Ahmadi can approve this distribution or send it back.");
  });

  it("puts it on his Home, not hers, and lets him approve", async () => {
    // Hers still lists the demo's own waiting distribution (recorded by the storekeeper), not this one.
    // Names come first for people allowed to see them (Nadia); Karim may not, so he sees the number only.
    expect(await homeRow(nadia)).toBe("Approve the input distribution to Rahmatullah Sharifi (F-0002)");
    expect(await homeRow(karim)).toBe("Approve the input distribution to F-0007");
    const res = await approveAs(code, own, karim);
    expect(res.decision).toBe("approved");
    expect(await farmer("F-0007")).toMatchObject({ step: "plant" });
    expect((await row(own)).decided).toMatchObject({ by: "karim", decision: "approved" });
  });

  it("keeps a manager from approving a KoboCollect record sent from her own account", async () => {
    const project = (await db.select().from(s.projects).where(eq(s.projects.code, code)))[0];
    await saveKoboApproval(code, { who: "mel", accounts: { "nadia.kobo": "nadia" } });
    const [r] = await db
      .insert(s.evidence)
      .values({ organizationId: project.organizationId, projectId: project.id, source: "kobo", form: "distribution", farmerCode: "F-0008", reviewStatus: "pending", completedBy: "nadia.kobo", completedAt: new Date(), koboAssetUid: "aDist", koboSubmissionUuid: "own-kobo-1", koboSubmissionId: 1, payload: { seed_given: "yes", seed_qty: "10", npk_given: "yes", npk_qty: "50", signed: "yes", list_photo: "l.jpg" } })
      .returning({ id: s.evidence.id });
    await listDistributions(code);
    await checkKoboDistribution(code, r.id, { id: omar.id, name: omar.name }, "http://test");
    expect((await row(r.id)).approvers).toEqual(["karim"]);
    expect(await refusal(() => approveAs(code, r.id, nadia))).toMatch(/^You recorded this distribution/);
    expect((await approveAs(code, r.id, karim)).decision).toBe("approved");
  });
});

describe("the signed note closes a distribution", { timeout: 60_000 }, () => {
  let unsigned = "";

  it("will not approve a KoboCollect record whose recipient did not sign", async () => {
    const project = (await db.select().from(s.projects).where(eq(s.projects.code, code)))[0];
    const [r] = await db
      .insert(s.evidence)
      .values({ organizationId: project.organizationId, projectId: project.id, source: "kobo", form: "distribution", farmerCode: "F-0009", reviewStatus: "pending", completedBy: "someone.else", completedAt: new Date(), koboAssetUid: "aDist", koboSubmissionUuid: "unsigned-1", koboSubmissionId: 2, payload: { seed_given: "yes", seed_qty: "10", npk_given: "yes", npk_qty: "50", signed: "no", list_photo: "l.jpg" } })
      .returning({ id: s.evidence.id });
    unsigned = r.id;
    await listDistributions(code);
    await checkKoboDistribution(code, unsigned, { id: omar.id, name: omar.name }, "http://test");
    const d = await row(unsigned);
    expect(d.signed).toBe(false);
    expect(d.closeBlock).toMatch(/not confirmed/);
    expect(await refusal(() => approveAs(code, unsigned, nadia))).toMatch(/^Not approved: The recipient's signature or thumbprint on the distribution receipt is not confirmed/);
    expect((await row(unsigned)).status).toBe("pending");
  });

  it("approves it once it is sent back and the signed note is confirmed", async () => {
    await decideDistribution(code, unsigned, "sent_back", nadia, "The note is not signed. Get the thumbprint.");
    await resubmitDistribution(code, unsigned, { id: bilal.id, name: bilal.name }, { signed: true }, "Thumbprint taken on the note", "http://test");
    const d = await row(unsigned);
    expect(d.closeBlock).toBeNull();
    expect((await approveAs(code, unsigned, nadia)).decision).toBe("approved");
  });
});

describe("a readiness No goes back to the agent who made the visit", { timeout: 60_000 }, () => {
  const readiness = async (uuid: string, farmerCode: string, account: string) => {
    const project = (await db.select().from(s.projects).where(eq(s.projects.code, code)))[0];
    const [r] = await db
      .insert(s.evidence)
      .values({ organizationId: project.organizationId, projectId: project.id, source: "kobo", form: "readiness", farmerCode, reviewStatus: "pending", completedBy: account, completedAt: new Date(), koboAssetUid: "aReady", koboSubmissionUuid: uuid, koboSubmissionId: 50, payload: { farmer: farmerCode, ready: "no", visit_type: "first", both_present: "yes", issue: "Ridges too shallow" } })
      .returning({ id: s.evidence.id });
    return r.id;
  };
  const taskFor = async (id: string) => (await db.select().from(s.workItems).where(eq(s.workItems.sourceKey, `correction:${id}`)))[0];

  it("assigns the correction to the matched collector, and to the first agent when the account is unknown", async () => {
    // A second extension agent, whose KoboCollect account the project has matched to her.
    const [farida] = await db.select().from(s.staff).where(eq(s.staff.personId, "farida"));
    await db.insert(s.staff).values({ organizationId: farida.organizationId, personId: "soraya", fullName: "Soraya Amiri", profile: farida.profile });
    await saveKoboApproval(code, { who: "mel", accounts: { "soraya.kobo": "soraya" } });
    const hers = await readiness("ready-1", "F-0011", "soraya.kobo");
    await decide(code, hers, "accepted", omar);
    expect((await taskFor(hers))?.assignee).toBe("soraya");
    const unknown = await readiness("ready-2", "F-0009", "tablet-7");
    await decide(code, unknown, "accepted", omar);
    expect((await taskFor(unknown))?.assignee).toBe("farida");
  });

  it("will not approve goods recorded as damaged at handover until that is put right", async () => {
    const project = (await db.select().from(s.projects).where(eq(s.projects.code, code)))[0];
    const [r] = await db
      .insert(s.evidence)
      .values({ organizationId: project.organizationId, projectId: project.id, source: "kobo", form: "distribution", farmerCode: "F-0008", reviewStatus: "pending", completedBy: "someone.else", completedAt: new Date(), koboAssetUid: "aDist", koboSubmissionUuid: "damaged-1", koboSubmissionId: 3, payload: { seed_given: "yes", seed_qty: "10", npk_given: "yes", npk_qty: "50", signed: "yes", list_photo: "l.jpg", condition: "some_damaged" } })
      .returning({ id: s.evidence.id });
    await listDistributions(code);
    await checkKoboDistribution(code, r.id, { id: omar.id, name: omar.name }, "http://test");
    expect((await row(r.id)).condition).toBe("some_damaged");
    expect(await refusal(() => approveAs(code, r.id, nadia))).toMatch(/damaged at handover/);
    await decideDistribution(code, r.id, "sent_back", nadia, "Replace the damaged bags.");
    await resubmitDistribution(code, r.id, { id: bilal.id, name: bilal.name }, { conditionOk: true }, "Damaged bags replaced; recipient accepted", "http://test");
    expect((await row(r.id)).closeBlock).toBeNull();
  });

  it("will not approve a distribution recorded in the app until the photo of the signed note is on the farmer's record", async () => {
    const f = await farmer("F-0005");
    await saveItems(code, [f]);
    const id = await recordFromApp(code, { ...f, checks: { ...f.checks, "distribute.recipient": true }, step: "plant" }, bilal, "http://test");
    expect((await row(id)).photo).toBe(false);
    expect(await refusal(() => approveAs(code, id, nadia))).toMatch(/no photo of the signed distribution receipt/);
    // The storekeeper adds the photo on the farmer's record: the waiting distribution counts it at once.
    await saveItems(code, [{ ...f, photos: [...f.photos, { id: "note-5", activity: "distribution", date: "2027-01-01", caption: "Signed distribution receipt", src: "data:image/png;base64,AA==", signedNote: true }] }]);
    expect((await row(id)).closeBlock).toBeNull();
    expect((await approveAs(code, id, nadia)).decision).toBe("approved");
  });
});
