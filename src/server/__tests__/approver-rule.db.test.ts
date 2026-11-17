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
    own = await recordFromApp(code, { ...f, checks: { ...f.checks, "distribute.recipient": true }, step: "plant" }, nadia, "http://test");
    const d = await row(own);
    expect(d.approvers).toEqual(["karim"]);
    expect(d.approverNames).toBe("Karim Ahmadi");
    // The notice went to him, not to her.
    expect(d.notified?.to).toEqual(["karim"]);
  });

  it("refuses her approval and her send-back, with who decides instead", async () => {
    expect(await refusal(() => decideDistribution(code, own, "approved", nadia))).toBe("You recorded this distribution, so someone else approves it: Karim Ahmadi.");
    expect(await refusal(() => decideDistribution(code, own, "sent_back", nadia, "Wrong amount"))).toMatch(/^You recorded this distribution/);
    expect(await refusal(() => decideDistribution(code, own, "approved", bilal))).toBe("Only Karim Ahmadi can approve this distribution or send it back.");
  });

  it("puts it on his Home, not hers, and lets him approve", async () => {
    // Hers still lists the demo's own waiting distribution (recorded by the storekeeper), not this one.
    expect(await homeRow(nadia)).toBe("Approve the input distribution to F-0002");
    expect(await homeRow(karim)).toBe("Approve the input distribution to F-0007");
    const res = await decideDistribution(code, own, "approved", karim);
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
    expect(await refusal(() => decideDistribution(code, r.id, "approved", nadia))).toMatch(/^You recorded this distribution/);
    expect((await decideDistribution(code, r.id, "approved", karim)).decision).toBe("approved");
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
    expect(await refusal(() => decideDistribution(code, unsigned, "approved", nadia))).toMatch(/^Not approved: The recipient's signature or thumbprint on the goods received note is not confirmed/);
    expect((await row(unsigned)).status).toBe("pending");
  });

  it("approves it once it is sent back and the signed note is confirmed", async () => {
    await decideDistribution(code, unsigned, "sent_back", nadia, "The note is not signed. Get the thumbprint.");
    await resubmitDistribution(code, unsigned, { id: bilal.id, name: bilal.name }, { signed: true }, "Thumbprint taken on the note", "http://test");
    const d = await row(unsigned);
    expect(d.closeBlock).toBeNull();
    expect((await decideDistribution(code, unsigned, "approved", nadia)).decision).toBe("approved");
  });
});
