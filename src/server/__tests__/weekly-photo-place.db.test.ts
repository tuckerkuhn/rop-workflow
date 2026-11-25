import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById, type AppUser } from "@/lib/demo";
import { updateSchema, type UpdateInput } from "@/lib/results";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { addUpdate, editUpdate, loadUpdates, updatePlaces } from "@/server/results-store";
import { koboApprovalFor, saveKoboApproval } from "@/server/kobo-approval";
import { loadWeekly, weeklyView } from "@/server/weekly-store";
import { POST as weeklyPost } from "@/app/api/projects/[code]/weekly/route";

/**
 * Where a weekly update's photo was taken. The phone that adds the photo reads the place from it.
 * The server keeps it with the item and gives it only to people who may see participant names:
 * a point can be where a farmer lives. Fictional points and people only.
 */
const CODE = "A-2027";
const nadia = userById("nadia")!; // project manager, may see names
const omar = userById("omar")!; // MEL officer, may see names, writes the weekly update
const rahima = userById("rahima")!; // Director of MEL, may not see names
const marcus = userById("marcus")!; // vice president, may not see names
/** A person who writes the weekly update and may not see names: no demo person is both, a real one can be. */
const writerNoNames: AppUser = { ...omar, id: "writer-no-names", pii: false };

const h = (c: string) => c.repeat(64);
const A = h("a");
const B = h("b");
const C = h("c");
const file = (hash: string) => ({ hash, name: `${hash.slice(0, 4)}.jpg`, type: "image/jpeg", size: 1000 });
const at = { [A]: { lat: 31.612345, lon: 65.712345 }, [B]: { lat: 31.598765, lon: 65.698765 } };
const item = (o: Partial<UpdateInput> = {}): UpdateInput => ({ activity: "1.1.1", date: "2026-11-16", title: "Trellis installation", note: "Trellis posts were set on six plots in Village B.", files: [file(A), file(B)], captions: { [A]: "Posts, Village B", [B]: "Wire, Village B" }, taken: { [A]: "2026-11-16", [B]: "2026-11-16" }, places: at, ...o });
/** Every coordinate used here, as it would show in anything sent to a screen. */
const holdsAPoint = (x: unknown) => /31\.6123|65\.7123|31\.5987|65\.6987|31\.7777|65\.7777/.test(JSON.stringify(x));
const idOf = async (title: string) => (await loadUpdates(CODE)).find((u) => u.title === title)!.id;

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  await addUpdate(CODE, item(), omar.id);
}, 120_000);

describe("the place a weekly photo was taken", { timeout: 90_000 }, () => {
  it("is accepted with the item, by file, as a point on the earth", () => {
    expect(updateSchema.safeParse(item()).success).toBe(true);
    expect(updateSchema.safeParse(item({ places: { [A]: { lat: 131, lon: 65 } } })).success).toBe(false);
    expect(updateSchema.safeParse(item({ places: { "not-a-file": { lat: 31, lon: 65 } } })).success).toBe(false);
  });

  it("is on no update that screens and reports read", async () => {
    const all = await loadUpdates(CODE);
    expect(all.some((u) => u.title === "Trellis installation")).toBe(true);
    expect(all.some((u) => "places" in u)).toBe(false);
    expect(holdsAPoint(all)).toBe(false);
  });

  it("is given to people who may see participant names, to the Director of MEL and to nobody else", async () => {
    const id = await idOf("Trellis installation");
    expect((await updatePlaces(CODE, nadia)).get(id)).toEqual(at);
    expect((await updatePlaces(CODE, omar)).get(id)).toEqual(at);
    // Decision V, 25 Nov 2026: the one person the project names to approve KoboCollect data vouches for field data.
    expect((await koboApprovalFor(CODE)).person).toBe("rahima");
    expect((await updatePlaces(CODE, rahima)).get(id)).toEqual(at);
    for (const who of [marcus, writerNoNames, null, undefined]) expect((await updatePlaces(CODE, who)).size).toBe(0);
  });

  it("is hers while the project names her, as approver or stand-in (AT): not by her title, and not for a role group", async () => {
    const rule = await koboApprovalFor(CODE);
    await saveKoboApproval(CODE, { who: "mel" });
    expect((await updatePlaces(CODE, rahima)).size).toBe(0);
    await saveKoboApproval(CODE, { ...rule, person: "omar", standIn: "rahima" });
    expect((await updatePlaces(CODE, rahima)).size).toBeGreaterThan(0);
    await saveKoboApproval(CODE, { ...rule, person: "omar", standIn: undefined });
    expect((await updatePlaces(CODE, rahima)).size).toBe(0);
    await saveKoboApproval(CODE, rule);
    expect((await updatePlaces(CODE, rahima)).size).toBeGreaterThan(0);
  });

  it("shows on the weekly page for those people only", async () => {
    const mine = await weeklyView(CODE, nadia, "2026-11-15");
    expect(mine.items.find((i) => i.title === "Trellis installation")?.places).toEqual(at);
    expect((await weeklyView(CODE, rahima, "2026-11-15")).items.find((i) => i.title === "Trellis installation")?.places).toEqual(at);
    for (const who of [marcus, writerNoNames]) {
      const theirs = await weeklyView(CODE, who, "2026-11-15");
      expect(theirs.items.find((i) => i.title === "Trellis installation")?.places).toEqual({});
      expect(holdsAPoint(theirs)).toBe(false);
    }
  });

  it("stays with a photo through an edit by someone whose screen never held it", async () => {
    const id = await idOf("Trellis installation");
    // What that person's screen sends back: the text changed, both photos kept, no places at all.
    const { places: _none, ...sent } = item({ note: "Trellis posts were set on seven plots in Village B." });
    void _none;
    expect(await editUpdate(CODE, id, sent, writerNoNames.id)).toBe(true);
    expect((await loadUpdates(CODE)).find((u) => u.id === id)?.note).toMatch(/seven plots/);
    expect((await updatePlaces(CODE, nadia)).get(id)).toEqual(at);
  });

  it("leaves with a photo taken off the item, comes with a photo added, and is not changed for a photo that stays", async () => {
    const id = await idOf("Trellis installation");
    const moved = { lat: 31.777777, lon: 65.777777 };
    // Photo B is removed, photo C is added with its own place, and a different place is sent for photo A.
    expect(await editUpdate(CODE, id, item({ files: [file(A), file(C)], captions: { [A]: "Posts, Village B", [C]: "Gate, Village B" }, taken: { [A]: "2026-11-16", [C]: "2026-11-17" }, places: { [A]: moved, [C]: at[B] } }), omar.id)).toBe(true);
    expect((await updatePlaces(CODE, nadia)).get(id)).toEqual({ [A]: at[A], [C]: at[B] });
  });

  it("is kept only for files that are on the item", async () => {
    await addUpdate(CODE, item({ title: "One photo", files: [file(A)], captions: { [A]: "Posts" }, taken: { [A]: "2026-11-16" } }), omar.id);
    expect((await updatePlaces(CODE, nadia)).get(await idOf("One photo"))).toEqual({ [A]: at[A] });
    await addUpdate(CODE, item({ title: "No place", places: undefined }), omar.id);
    expect((await updatePlaces(CODE, nadia)).has(await idOf("No place"))).toBe(false);
  });

  it("is not in the copy kept when the week is sent", async () => {
    const post = async (body: unknown) => {
      const res = await weeklyPost(new Request(`http://test/api/projects/${CODE}/weekly`, { method: "POST", headers: { "x-demo-user": omar.id, "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ code: CODE }) });
      return { status: res.status, body: await res.json() };
    };
    expect((await post({ action: "week", n: 7, from: "2026-11-15", to: "2026-11-19" })).status).toBe(200);
    const sent = await post({ action: "send", from: "2026-11-15" });
    expect(sent.status).toBe(200);
    const state = await loadWeekly(CODE);
    const week = state.weeks.find((w) => w.from === "2026-11-15")!;
    expect(week.sent?.items.flatMap((i) => i.photos.map((p) => p.hash))).toContain(A);
    expect(holdsAPoint(state)).toBe(false);
    // The person who sent it may see names, so their own page still has the places beside the items.
    expect(holdsAPoint(sent.body)).toBe(true);
    expect(holdsAPoint(sent.body.week)).toBe(false);
  });
});
