import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { GET as fieldGet } from "@/app/api/projects/[code]/field/route";
import { userById, type AppUser } from "@/lib/demo";
import type { Farmer, FieldItem } from "@/lib/field";
import { seedDatabase } from "@/server/demo-seed";
import { keepHidden, loadField, saveEdited, saveItems } from "@/server/field-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * Where a farmer's photo was taken shows where a named person lives. Staff who may not see
 * participant names are told that a place is kept and are never sent it, and a save from their
 * page keeps it as stored.
 */
const code = "A-2027";
const ID = "F-0007";
const nadia = userById("nadia")!; // project manager: sees names
const omar = userById("omar")!; // MEL officer: sees names, saves farmers
/** Nobody in the demo both saves a farmer and is kept from names: this test makes one. */
const editor: AppUser = { ...omar, id: "editor-no-names", pii: false };
const NOTE = { id: "F-0007-note-p", activity: "distribution" as const, date: "2026-11-24", caption: "Signed goods received note · F-0007", src: "data:image/png;base64,Tk9URQ==", signedNote: true, gps: { lat: 34.5621, lon: 69.2102 } };
const PLOT = { id: "F-0007-plot-p", activity: "landprep" as const, date: "2026-11-24", caption: "The plot after ridging", src: "data:image/png;base64,UExPVA==", gps: { lat: 34.5623, lon: 69.2101 } };
const BARE = { id: "F-0007-bare-p", activity: "visit" as const, date: "2026-11-24", caption: "A photo with no place", src: "data:image/png;base64,QkFSRQ==" };
const farmer = async (as?: AppUser) => (await loadField(code, as)).items.find((i): i is Farmer => i.kind === "farmer" && i.id === ID)!;
const photo = (f: Farmer, id: string) => f.photos.find((p) => p.id === id);
const rawMap = async () => new Map((await loadField(code)).items.map((i) => [i.id, i]));
/** A save as the field route does it: what was hidden is put back, then the record is stored. */
const saveAs = async (u: AppUser, f: Farmer) => saveEdited(code, await keepHidden(code, u, [f as FieldItem], await rawMap()));

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  const f = await farmer();
  await saveItems(code, [{ ...f, photos: [...f.photos, NOTE, PLOT, BARE] }]);
}, 120_000);

describe("where a farmer's photo was taken, for staff who may not see participant names", { timeout: 60_000 }, () => {
  // Decision AH, 25 Nov 2026: they are told nothing about a photo's place, not even that one is kept.
  it("is not sent to them, and nothing says a place is kept", async () => {
    for (const id of ["rahima", "marcus", "karim", "yusuf"]) {
      const f = await farmer(userById(id)!);
      expect(photo(f, NOTE.id)).toMatchObject({ src: NOTE.src });
      expect(photo(f, PLOT.id)).toMatchObject({ src: PLOT.src });
      for (const p of f.photos) expect("hasPlace" in p).toBe(false);
      // A photo with a place and a photo with none read the same to them.
      expect(Object.keys(photo(f, PLOT.id)!).sort()).toEqual(Object.keys(photo(f, BARE.id)!).sort());
      for (const p of f.photos) expect(p.gps).toBeUndefined();
      const sent = JSON.stringify((await loadField(code, userById(id)!)).items);
      expect(sent).not.toContain("34.56");
      expect(sent).not.toContain('"gps"');
      expect(sent).not.toContain("hasPlace");
    }
  });

  it("is not in what the field request answers them, and is in what it answers the project manager", async () => {
    const answer = async (id: string) => (await fieldGet(new Request(`http://test/api/projects/${code}/field`, { headers: { "x-demo-user": id } }), { params: Promise.resolve({ code }) })).text();
    const rahima = await answer("rahima");
    expect(rahima).toContain(PLOT.id);
    expect(rahima).not.toContain("34.56");
    expect(rahima).not.toContain('"gps"');
    expect(await answer("nadia")).toContain('"gps":{"lat":34.5623,"lon":69.2101}');
  });

  it("is sent as stored to people who may see names, and the mark is never stored", async () => {
    for (const f of [await farmer(nadia), await farmer(omar), await farmer()]) {
      expect(photo(f, NOTE.id)).toMatchObject({ gps: NOTE.gps });
      expect(photo(f, PLOT.id)).toMatchObject({ gps: PLOT.gps });
      for (const p of f.photos) expect(p.hasPlace).toBeUndefined();
    }
  });

  it("is kept when they save the record from a page that never held it", async () => {
    const shown = await farmer(editor);
    expect(photo(shown, PLOT.id)!.gps).toBeUndefined();
    await saveAs(editor, { ...shown, correction: "Plot size checked." });
    const stored = await farmer();
    expect(stored.correction).toBe("Plot size checked.");
    expect(photo(stored, NOTE.id)!.gps).toEqual(NOTE.gps);
    expect(photo(stored, PLOT.id)!.gps).toEqual(PLOT.gps);
    expect(photo(stored, BARE.id)!.gps).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain("hasPlace");
  });

  it("takes a photo they add with its place, drops one they take off and never takes a place for a photo already stored", async () => {
    const shown = await farmer(editor);
    const added = { id: "F-0007-new-p", activity: "visit" as const, date: "2026-11-25", caption: "Farm visit · F-0007", src: "data:image/png;base64,TkVX", gps: { lat: 34.5, lon: 69.3 } };
    const moved = { lat: 1, lon: 2 };
    await saveAs(editor, {
      ...shown,
      photos: [...shown.photos.filter((p) => p.id !== NOTE.id).map((p) => (p.id === PLOT.id || p.id === BARE.id ? { ...p, gps: moved } : p)), added],
    });
    const stored = await farmer();
    expect(photo(stored, NOTE.id)).toBeUndefined();
    expect(photo(stored, PLOT.id)!.gps).toEqual(PLOT.gps);
    expect(photo(stored, BARE.id)!.gps).toBeUndefined();
    expect(photo(stored, added.id)!.gps).toEqual(added.gps);
    // Their own next read no longer sends the place of the photo they added, and says nothing of it.
    expect("hasPlace" in photo(await farmer(editor), added.id)!).toBe(false);
    expect(photo(await farmer(editor), added.id)!.gps).toBeUndefined();
  });

  it("leaves a save by someone who may see names as they sent it", async () => {
    const shown = await farmer(omar);
    const back = (await keepHidden(code, omar, [shown as FieldItem], await rawMap())) as Farmer[];
    expect(back[0]).toBe(shown);
  });
});
