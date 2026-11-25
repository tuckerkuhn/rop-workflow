import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { createHash } from "node:crypto";
import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { seedDatabase } from "@/server/demo-seed";
import { loadField, photoFingerprint, projectByCode, saveItems } from "@/server/field-store";
import { saveProjectState } from "@/server/project-state";
import { ready } from "@/server/__tests__/test-db";

/**
 * A donor's account may open a farmer's page. It is sent no picture of the signed goods received
 * note, which has the farmer's name and signature on it, and no photo's place. Of the other photos
 * it is sent only those cleared for donors by the consent rule a report's photos pass (decision
 * AB, 25 Nov 2026). Staff are sent the record as before.
 */
const code = "A-2027";
const elena = userById("elena")!;
const nadia = userById("nadia")!;
const NOTE = "data:image/png;base64,Tk9URQ==";
const PLOT = "data:image/png;base64,UExPVA==";
// A picture with nobody in it, checked in the photo library: the only kind a donor's account is sent.
const CROP = "data:image/png;base64,Q1JPUA==";
const cropHash = createHash("sha256").update(Buffer.from("Q1JPUA==", "base64")).digest("hex");
// A picture checked and found to show a person who can be recognised, with no consent recorded.
const FACE = "data:image/png;base64,RkFDRQ==";
const faceHash = createHash("sha256").update(Buffer.from("RkFDRQ==", "base64")).digest("hex");
const farmer = async (as?: typeof elena) => (await loadField(code, as)).items.find((i): i is Farmer => i.kind === "farmer" && i.id === "F-0007")!;

beforeAll(async () => {
  await ready;
  await seedDatabase();
  const f = await farmer();
  await saveItems(code, [
    {
      ...f,
      photos: [
        ...f.photos,
        { id: "F-0007-note-t", activity: "distribution", date: "2026-11-24", caption: "Signed goods received note · F-0007", src: NOTE, signedNote: true, gps: { lat: 34.5621, lon: 69.2102 } },
        { id: "F-0007-plot-t", activity: "landprep", date: "2026-11-24", caption: "The plot after ridging", src: PLOT, gps: { lat: 34.5623, lon: 69.2101 } },
        { id: "F-0007-crop-t", activity: "landprep", date: "2026-11-24", caption: "Maize at knee height", src: CROP, gps: { lat: 34.5624, lon: 69.2103 } },
        { id: "F-0007-face-t", activity: "landprep", date: "2026-11-24", caption: "Gul Ahmad beside his plot", src: FACE },
      ],
    },
  ]);
  const coach = { isPhoto: true, label: "report", tips: [], shows: "A maize plot", womenIdentifiable: false, model: "test", at: "2026-11-24T00:00:00.000Z" };
  await saveProjectState((await projectByCode(code)).id, "photos", { photos: { [cropHash]: { coach: { ...coach, people: "none" } }, [faceHash]: { coach: { ...coach, people: "identifiable" } } }, posts: [] });
}, 120_000);

describe("a farmer's photos, for a donor's account", { timeout: 60_000 }, () => {
  it("lists the signed note with no picture, and gives no photo's place", async () => {
    const f = await farmer(elena);
    const note = f.photos.find((p) => p.id === "F-0007-note-t")!;
    expect(note).toMatchObject({ signedNote: true, caption: "Signed goods received note · F-0007" });
    expect(note.src).toBeUndefined();
    // Cleared for donors by the consent rule: sent, with its picture and no place.
    expect(photoFingerprint(CROP)).toBe(cropHash);
    expect(f.photos.find((p) => p.id === "F-0007-crop-t")).toMatchObject({ src: CROP, caption: "Maize at knee height" });
    for (const p of f.photos) expect(p.gps).toBeUndefined();
    for (const p of f.photos.filter((x) => x.signedNote)) expect(p.src).toBeUndefined();
    const sent = JSON.stringify((await loadField(code, elena)).items);
    expect(sent).not.toContain(NOTE);
    expect(sent).not.toContain("34.56");
    expect(sent).not.toContain('"gps"');
  });

  it("is sent no photo that is not cleared for donors: not the picture and not its caption", async () => {
    const f = await farmer(elena);
    // Never checked in the photo library.
    expect(f.photos.find((p) => p.id === "F-0007-plot-t")).toBeUndefined();
    // Checked, and it shows a person who can be recognised with no consent recorded.
    expect(f.photos.find((p) => p.id === "F-0007-face-t")).toBeUndefined();
    // The demo's own photos have no picture and were never checked: none goes.
    expect(f.photos.filter((p) => !p.signedNote).map((p) => p.id)).toEqual(["F-0007-crop-t"]);
    const sent = JSON.stringify((await loadField(code, elena)).items);
    expect(sent).not.toContain(PLOT);
    expect(sent).not.toContain(FACE);
    expect(sent).not.toContain("Gul Ahmad");
    expect(sent).not.toContain("The plot after ridging");
  });

  it("is as stored for staff who may see participant names, and for the server itself", async () => {
    for (const f of [await farmer(nadia), await farmer()]) {
      expect(f.photos.find((p) => p.id === "F-0007-note-t")).toMatchObject({ src: NOTE, gps: { lat: 34.5621, lon: 69.2102 } });
      expect(f.photos.find((p) => p.id === "F-0007-plot-t")).toMatchObject({ src: PLOT, gps: { lat: 34.5623, lon: 69.2101 } });
      expect(f.photos.find((p) => p.id === "F-0007-face-t")).toMatchObject({ src: FACE, caption: "Gul Ahmad beside his plot" });
    }
  });
});
