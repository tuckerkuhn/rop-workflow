import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import type { PhotosState } from "@/lib/photos";
import { seedDatabase } from "@/server/demo-seed";
import { projectByCode } from "@/server/field-store";
import { loadProjectState, saveProjectState } from "@/server/project-state";
import { packIndex } from "@/server/proof";
import { addProof, loadResults } from "@/server/results-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * The donor evidence pack leaves Roots of Peace. A file's name, a caption on a held file, a link's
 * title and a link's address are typed by staff and can hold a participant's name: the donor
 * pack's index gives none of them. The audit pack gives all of them.
 */
const code = "A-2027";
const cleared = "a".repeat(64);
const unchecked = "b".repeat(64);
const sheet = "c".repeat(64);
const link = { url: "https://example.org/sites/rop/Gul-Bibi-signature-list.pdf", title: "Signature list, Gul Bibi and Ahmad Karimi" };
let quarter = "";
let id = "";
let names: string[] = [];

beforeAll(async () => {
  await ready;
  await seedDatabase();
  const p = await projectByCode(code);
  const r = (await loadResults(code)).find((x) => x.status === "accepted" && x.value > 0 && x.files.length > 0)!;
  quarter = r.quarter;
  id = r.id;
  await addProof(code, id, {
    files: [
      { hash: cleared, name: "Ahmad Karimi at his plot.jpg", type: "image/jpeg", size: 1000 },
      { hash: unchecked, name: "Gul Bibi signing.jpg", type: "image/jpeg", size: 1000 },
      { hash: sheet, name: "Attendance Ahmad Karimi.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 1000 },
    ],
    links: [link],
    captions: { [cleared]: "A prepared plot before planting", [unchecked]: "Gul Bibi signs for her inputs" },
    by: "omar",
  });
  // One photo is checked and shows no people: it may go to a donor. The other has not been looked at.
  const photos = await loadProjectState<PhotosState>(p.id, "photos", { photos: {}, posts: [] });
  const coach = { isPhoto: true, people: "none" } as unknown as NonNullable<PhotosState["photos"][string]["coach"]>;
  await saveProjectState(p.id, "photos", { ...photos, photos: { ...photos.photos, [cleared]: { coach } } });
  const kept = (await loadResults(code)).filter((x) => x.status === "accepted" && x.quarter === quarter);
  names = kept.flatMap((x) => [...x.files.map((f) => f.name), ...(x.links ?? []).map((l) => l.title)]);
}, 120_000);

describe("the evidence pack's index", { timeout: 60_000 }, () => {
  it("gives a donor a cleared photo under a plain name and a count of what is held, with no name typed by staff", async () => {
    const idx = await packIndex(code, { kind: "qpr", quarter }, "donor");
    const mine = idx.entries.flatMap((e) => e.results).filter((r) => r.id === id);
    expect(mine.length).toBeGreaterThan(0);
    for (const r of mine) {
      expect(r.files).toEqual([{ hash: cleared, type: "image/jpeg", caption: "A prepared plot before planting", name: "Photo 1.jpg" }]);
      expect(r.links).toEqual([]);
      const held = r.held.map((h) => h.what);
      expect(held).toContain("1 photo");
      expect(held).toContain("1 spreadsheet");
      expect(held).toContain("1 linked document");
      expect(r.held.find((h) => h.what === "1 photo")!.why).toMatch(/^Held by Roots of Peace: /);
      for (const h of r.held) expect(h.why).toMatch(/^Held by Roots of Peace/);
    }
    // Decision AD, 25 Nov 2026: the donor pack gives no free-text note. Counts and dates only.
    const all = idx.entries.flatMap((e) => e.results);
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) {
      expect(r.note).toBe("");
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof r.value).toBe("number");
      if (r.noFile) expect(r.noFile).toBe("the reason is kept by Roots of Peace");
    }
    expect(names.length).toBeGreaterThan(4);
    const sent = JSON.stringify(idx);
    for (const name of names) expect(sent).not.toContain(name);
    expect(sent).not.toMatch(/Ahmad|Karimi|Gul|Bibi|example\.org|\.pdf|\.xlsx/);
    // A held file is not in the pack, so nothing in the index points at it.
    expect(sent).not.toContain(unchecked);
    expect(sent).not.toContain(sheet);
  });

  it("gives an auditor every file by its name and every link", async () => {
    const idx = await packIndex(code, { kind: "qpr", quarter }, "audit");
    const mine = idx.entries.flatMap((e) => e.results).find((r) => r.id === id)!;
    expect(mine.held).toEqual([]);
    // An auditor still reads what was done, as staff wrote it.
    expect(idx.entries.flatMap((e) => e.results).some((r) => r.note.length > 0)).toBe(true);
    expect(mine.files.map((f) => f.name)).toEqual(expect.arrayContaining(["Ahmad Karimi at his plot.jpg", "Gul Bibi signing.jpg", "Attendance Ahmad Karimi.xlsx"]));
    expect(mine.links).toEqual([link]);
  });
});
