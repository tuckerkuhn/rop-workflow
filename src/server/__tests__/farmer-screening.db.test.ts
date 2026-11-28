import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { realToday } from "@/lib/clock";
import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { formFor, saveForm } from "@/server/app-forms";
import { decideDistribution, listDistributions } from "@/server/distribution";
import { screenFarmer } from "@/server/farmer-screening";
import { loadField } from "@/server/field-store";

/** MF-04: the demo package is worth about $207, so its farmer is screened before approval. */
const code = "A-2027";
const [nadia, bilal, omar, hamid] = ["nadia", "bilal", "omar", "hamid"].map((id) => userById(id)!);
const PIC = `data:image/jpeg;base64,${Buffer.from("fictional receipt").toString("base64")}`;

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("farmer screening before a package above $50", { timeout: 60_000 }, () => {
  it("holds the approval until a clear screening; a possible match waits for a person's review", async () => {
    const f = (await loadField(code, nadia)).items.find((i): i is Farmer => i.kind === "farmer" && i.step === "distribute" && !i.screenings?.length)!;
    const { form } = await formFor(code, "distribution", bilal);
    const given = Object.fromEntries(form.questions.filter((q) => q.name.endsWith("_given")).map((q) => [q.name, "yes"]));
    const { id } = (await saveForm(code, "distribution", { entryId: "screen-1", answers: { start_geopoint: "34.5 69.1", farmer: f.id, ...given, condition: "good", signed: "yes", list_photo: "x" }, photos: { list_photo: PIC } }, bilal)) as { id: string };
    const d = () => listDistributions(code).then((l) => l.find((x) => x.id === id)!);
    const receipt = async () => ({ date: (await d()).date, farmer: true, qty: Object.fromEntries((await d()).items.map((i) => [i.key, i.qty])) });
    expect((await d()).screeningHold).toMatch(/above the \$50 limit: screen them/);
    await expect(decideDistribution(code, id, "approved", nadia, undefined, await receipt())).rejects.toThrow(/^Not approved yet: .*screen them against the sanctions lists/);

    // Only someone who may see names screens.
    await expect(screenFarmer(code, { farmer: f.id, date: realToday(), lists: "OFAC SDN list", result: "clear" }, hamid)).rejects.toThrow(/may see farmers' names/);
    await screenFarmer(code, { farmer: f.id, date: realToday(), lists: "OFAC SDN list", result: "possible_match" }, omar);
    expect((await d()).screeningHold).toMatch(/possible match/);
    await screenFarmer(code, { farmer: f.id, date: realToday(), lists: "OFAC SDN list", result: "clear", note: "Reviewed: a different person of the same name." }, omar);
    expect((await d()).screeningHold).toBeNull();
    await decideDistribution(code, id, "approved", nadia, undefined, await receipt());
    const after = (await loadField(code, nadia)).items.find((i): i is Farmer => i.kind === "farmer" && i.id === f.id)!;
    expect(after.screenings?.map((s) => s.result)).toEqual(["possible_match", "clear"]);
  });
});
