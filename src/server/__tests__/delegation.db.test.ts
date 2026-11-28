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
const [nadia, omar, bilal] = ["nadia", "omar", "bilal"].map((id) => userById(id)!);
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

    // Not hers to approve while the manager is here.
    await expect(decideDistribution(code, id, "approved", omar, undefined, await matchingReceipt(code, id))).rejects.toThrow();
    const away = await recordAway({ person: "nadia", from: realToday(), to: plus(5), delegate: "omar" }, nadia, await people());
    expect((await people()).find((p) => p.id === "omar")!.field).toContain("manager");

    await decideDistribution(code, id, "approved", omar, undefined, await matchingReceipt(code, id));
    expect((await listDistributions(code)).find((d) => d.id === id)!.decided).toMatchObject({ by: "omar", byName: "Omar Sadiq on behalf of Nadia Rahimi" });

    // Back from leave: the delegate holds nothing of hers any more.
    await removeAway(away.id, nadia);
    expect((await people()).find((p) => p.id === "omar")!.field).not.toContain("manager");
  });

  it("only the person or an administrator records time away, and two stretches never overlap", async () => {
    await expect(recordAway({ person: "nadia", from: realToday(), to: plus(2) }, omar, await people())).rejects.toThrow(/record your own/);
    await recordAway({ person: "omar", from: plus(1), to: plus(3) }, omar, await people());
    await expect(recordAway({ person: "omar", from: plus(2), to: plus(4) }, omar, await people())).rejects.toThrow(/overlaps/);
  });
});
