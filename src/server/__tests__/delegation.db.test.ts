import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { realToday } from "@/lib/clock";
import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { ready } from "@/server/__tests__/test-db";
import { matchingReceipt } from "@/server/__tests__/receipt-helper";
import { seedDatabase } from "@/server/demo-seed";
import { saveForm, formFor } from "@/server/app-forms";
import { people } from "@/server/auth";
import { recordAway, removeAway } from "@/server/away-store";
import { decideDistribution, listDistributions } from "@/server/distribution";
import { loadField } from "@/server/field-store";

/** MF-01: while the project manager is away, the person she names approves in her place, on her behalf. */
const code = "A-2027";
const [nadia, omar, bilal, karim] = ["nadia", "omar", "bilal", "karim"].map((id) => userById(id)!);
const PIC = `data:image/jpeg;base64,${Buffer.from("fictional receipt").toString("base64")}`;
const plus = (n: number) => new Date(Date.parse(`${realToday()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("backup approvers", { timeout: 60_000 }, () => {
  it("a distribution waiting on the away manager is approved by her delegate, on her behalf", async () => {
    const f = (await loadField(code, nadia)).items.find((i): i is Farmer => i.kind === "farmer" && i.step === "distribute")!;
    const { form } = await formFor(code, "distribution", bilal);
    const given = Object.fromEntries(form.questions.filter((q) => q.name.endsWith("_given")).map((q) => [q.name, "yes"]));
    const { id } = (await saveForm(code, "distribution", { entryId: "delegation-1", answers: { start_geopoint: "34.5 69.1", farmer: f.id, ...given, condition: "good", signed: "yes", list_photo: "x" }, photos: { list_photo: PIC } }, bilal)) as { id: string };

    // R2-21: a delegate is the line manager or someone trusted with the same work, not MEL, who checks it.
    await expect(recordAway({ person: "nadia", from: realToday(), to: plus(5), delegate: "omar" }, nadia, await people())).rejects.toThrow(/line manager or someone who holds the same role/);
    // Not his to approve while the manager is here.
    await expect(decideDistribution(code, id, "approved", karim, undefined, await matchingReceipt(code, id))).rejects.toThrow();
    const away = await recordAway({ person: "nadia", from: realToday(), to: plus(5), delegate: "karim" }, nadia, await people());
    expect((await people()).find((p) => p.id === "karim")!.field).toContain("manager");

    await decideDistribution(code, id, "approved", karim, undefined, await matchingReceipt(code, id));
    expect((await listDistributions(code)).find((d) => d.id === id)!.decided).toMatchObject({ by: "karim", byName: "Karim Ahmadi on behalf of Nadia Rahimi" });

    // Back from leave: the delegate holds nothing of hers any more.
    await removeAway(away.id, nadia);
    expect((await people()).find((p) => p.id === "karim")!.field).not.toContain("manager");
  });

  it("only the person or an administrator records time away, and two stretches never overlap", async () => {
    await expect(recordAway({ person: "nadia", from: realToday(), to: plus(2) }, omar, await people())).rejects.toThrow(/record your own/);
    await recordAway({ person: "omar", from: plus(1), to: plus(3) }, omar, await people());
    await expect(recordAway({ person: "omar", from: plus(2), to: plus(4) }, omar, await people())).rejects.toThrow(/overlaps/);
  });
});

describe("backup approvers in procurement and HR (review round 2, R2-13, R2-16)", { timeout: 60_000 }, () => {
  it("while the approver is away, their delegate's signature is accepted by the server's check", async () => {
    const { loadProcurementContext, applyProcurementContext } = await import("@/server/procurement-guard");
    const { maySign, seedProcurements } = await import("@/lib/procurement");
    const p = { ...seedProcurements()[0], step: "approveReq", qty: 1, unitPrice: 300, route: "rfq" } as never;
    const tucker = () => people().then((l) => l.find((u) => u.id === "tucker")!);
    applyProcurementContext(await loadProcurementContext(code, null, []));
    expect(maySign(await tucker(), p, "approver")).toBe(false);
    const away = await recordAway({ person: "karim", from: realToday(), to: plus(3), delegate: "tucker" }, karim, await people());
    applyProcurementContext(await loadProcurementContext(code, null, []));
    expect(maySign(await tucker(), p, "approver")).toBe(true);
    await removeAway(away.id, karim);
  });

  it("an advance waiting on an away supervisor is approved by their delegate", async () => {
    const { foldAdvances } = await import("@/lib/advance");
    const hr = { rules: { holders: { finance: ["yusuf"], hr: ["sima"] } }, people: { yusuf: { id: "yusuf", current: { supervisor: "karim" } } }, relations: [] } as never;
    const ask = { amount: 200, currency: "USD", purpose: "Field trip to Balkh", source: "A-2027", neededBy: "2026-12-01" };
    const entries = [
      { n: 1, at: "2026-11-28T09:00:00Z", actor: "yusuf", kind: "adv-request", subject: "yusuf", data: ask, hash: "", prevHash: "" },
      { n: 2, at: "2026-11-28T10:00:00Z", actor: "tucker", kind: "adv-approve", subject: "yusuf", data: { advance: 1 }, hash: "", prevHash: "" },
    ] as never;
    expect(foldAdvances(entries, hr).advances[0].status).toBe("requested");
    const away = { entries: [{ id: "a", person: "karim", from: "2026-11-27", to: "2026-11-30", delegate: "tucker", by: "karim", at: "" }] };
    expect(foldAdvances(entries, hr, away).advances[0].status).toBe("approved");
    // Written with whom it was for, it stands whatever the time-away list says later (code review).
    const stamped = [(entries as object[])[0], { ...(entries as Record<string, unknown>[])[1], data: { advance: 1, onBehalfOf: "karim" } }] as never;
    expect(foldAdvances(stamped, hr, null).advances[0].status).toBe("approved");
  });
});
