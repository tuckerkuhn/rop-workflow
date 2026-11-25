import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import { hasSignedNotePhoto, type Farmer } from "@/lib/field";
import { seedDatabase } from "@/server/demo-seed";
import { addFarmerPhoto, mayAddPhoto, maySupplyProof, tagsFor } from "@/server/farmer-photo";
import { loadField } from "@/server/field-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * Anyone on the project who visits farmers can add a photo: field staff, management, the Director
 * of MEL. A visitor's photo is a picture of the work, carries their name and is never proof.
 */
const code = "A-2027";
const marcus = userById("marcus")!; // Vice President, Programs: sees Field activities, records nothing
const nadia = userById("nadia")!; // project manager: approves distributions
const bilal = userById("bilal")!; // storekeeper: hands goods out
const zahra = userById("zahra")!; // procurement officer
const src = "data:image/jpeg;base64,AA==";
const refusal = async (f: () => Promise<unknown>) => f().then(() => "", (e: Error) => e.message);
const farmer = async (id: string) => (await loadField(code, nadia)).items.find((i) => i.id === id) as Farmer;
let id = "";

beforeAll(async () => {
  await ready;
  await seedDatabase();
  id = ((await loadField(code, nadia)).items.find((i) => i.kind === "farmer") as Farmer).id;
}, 120_000);

describe("photos from anyone who visits farmers", () => {
  it("management may add a photo; the signed note stays with the people who hand goods out", () => {
    expect(mayAddPhoto(marcus, code)).toBe(true);
    expect(tagsFor(marcus)).toEqual(["delivery", "training", "visit", "landprep", "planting"]);
    // The project manager approves distributions, so she never supplies their proof either.
    expect(maySupplyProof(nadia)).toBe(false);
    expect(tagsFor(nadia)).not.toContain("signed-note");
    expect(tagsFor(bilal)).toContain("signed-note");
  });

  it("files a visitor's photo with their name, the day and place the photo holds, and marks it as a visit", async () => {
    const before = (await farmer(id)).photos.length;
    const p = await addFarmerPhoto(code, id, marcus, { tag: "visit", src, taken: { date: "2026-11-20", time: "15:42" }, gps: { lat: 34.5621, lon: 69.2102 } });
    expect(p).toMatchObject({ activity: "visit", tag: "visit", date: "2026-11-20", by: "marcus", byName: "Marcus Bell", visitor: true, taken: { date: "2026-11-20", time: "15:42" }, gps: { lat: 34.5621, lon: 69.2102 } });
    const f = await farmer(id);
    expect(f.photos).toHaveLength(before + 1);
    expect(f.timeline.at(-1)!.what).toBe("Photo added by Marcus Bell, visiting: Farm visit");
    const [log] = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "farmer_photo_added"));
    expect(log.detail).toMatchObject({ by: "marcus", tag: "visit", visitor: true, hasPlace: true });
  });

  it("a visitor's photo is never proof: the signed note tag is refused, and nothing a visitor adds clears a distribution", async () => {
    expect(await refusal(() => addFarmerPhoto(code, id, marcus, { tag: "signed-note", src }))).toMatch(/nobody who approves it also supplies its proof/);
    expect(await refusal(() => addFarmerPhoto(code, id, nadia, { tag: "signed-note", src }))).toMatch(/nobody who approves it also supplies its proof/);
    await addFarmerPhoto(code, id, marcus, { tag: "delivery", src });
    const visitorOnly = { photos: (await farmer(id)).photos.filter((p) => p.visitor) };
    expect(hasSignedNotePhoto(visitorOnly)).toBe(false);
  });

  it("the storekeeper's signed note is filed as proof, with no visitor mark", async () => {
    const p = await addFarmerPhoto(code, id, bilal, { tag: "signed-note", src });
    expect(p).toMatchObject({ activity: "distribution", signedNote: true, byName: "Bilal Haidari" });
    expect(p.visitor).toBeUndefined();
  });

  it("refuses someone who cannot open Field activities, and a farmer who is not on the project", async () => {
    expect(zahra.fieldAccess === "none" ? mayAddPhoto(zahra, code) : true).toBe(zahra.fieldAccess !== "none");
    expect(await refusal(() => addFarmerPhoto(code, "F-9999", marcus, { tag: "visit", src }))).toMatch(/no record in Field activities/);
  });
});
