import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { seedDatabase } from "@/server/demo-seed";
import { loadField, saveItems } from "@/server/field-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * A donor's account may open a farmer's page. It is sent no picture of the signed goods received
 * note, which has the farmer's name and signature on it, and no photo's place. Staff are sent
 * the record as before.
 */
const code = "A-2027";
const elena = userById("elena")!;
const nadia = userById("nadia")!;
const NOTE = "data:image/png;base64,Tk9URQ==";
const PLOT = "data:image/png;base64,UExPVA==";
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
      ],
    },
  ]);
}, 120_000);

describe("a farmer's photos, for a donor's account", { timeout: 60_000 }, () => {
  it("lists the signed note with no picture, and gives no photo's place", async () => {
    const f = await farmer(elena);
    const note = f.photos.find((p) => p.id === "F-0007-note-t")!;
    expect(note).toMatchObject({ signedNote: true, caption: "Signed goods received note · F-0007" });
    expect(note.src).toBeUndefined();
    expect(f.photos.find((p) => p.id === "F-0007-plot-t")!.src).toBe(PLOT);
    for (const p of f.photos) expect(p.gps).toBeUndefined();
    for (const p of f.photos.filter((x) => x.signedNote)) expect(p.src).toBeUndefined();
    const sent = JSON.stringify((await loadField(code, elena)).items);
    expect(sent).not.toContain(NOTE);
    expect(sent).not.toContain("34.56");
    expect(sent).not.toContain('"gps"');
  });

  it("is as stored for staff who may see participant names, and for the server itself", async () => {
    for (const f of [await farmer(nadia), await farmer()]) {
      expect(f.photos.find((p) => p.id === "F-0007-note-t")).toMatchObject({ src: NOTE, gps: { lat: 34.5621, lon: 69.2102 } });
      expect(f.photos.find((p) => p.id === "F-0007-plot-t")).toMatchObject({ src: PLOT, gps: { lat: 34.5623, lon: 69.2101 } });
    }
  });
});
