import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));
// KoboToolbox is not called in tests: the project's account and its photo come from here.
const photo = vi.hoisted(() => ({ bytes: null as Buffer | null, calls: [] as string[] }));
vi.mock("@/server/kobo-link", async (orig) => ({ ...(await orig<typeof import("@/server/kobo-link")>()), credentials: async () => ({ server: "https://kf.example.org", token: "t" }) }));
vi.mock("@/server/kobo-client", async (orig) => ({
  ...(await orig<typeof import("@/server/kobo-client")>()),
  attachmentBytes: async (_s: string, _t: string, url: string) => {
    photo.calls.push(url);
    return photo.bytes ? { bytes: photo.bytes, type: "image/jpeg" } : null;
  },
}));

import { eq, like } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import { hasSignedNotePhoto, type Farmer } from "@/lib/field";
import { exifJpeg } from "@/lib/__tests__/exif-fixture";
import { seedDatabase } from "@/server/demo-seed";
import { addSignedNote, checkKoboDistribution, dayOf, decideDistribution, listDistributions, resubmitDistribution } from "@/server/distribution";
import { distributionFacts, koboPhoto } from "@/server/distribution-photo";
import { loadField } from "@/server/field-store";
import { saveKoboApproval } from "@/server/kobo-approval";
import { loadResults } from "@/server/results-store";
import { submissionPhoto, submissionProof } from "@/server/submission-proof";
import { ready } from "@/server/__tests__/test-db";

/**
 * The proof behind a KoboCollect distribution reaches the people who check and approve it, and
 * nothing about where or when it happened is typed: the place is the phone's, the day is the
 * form's, and the photo says for itself when and where it was taken.
 */
const code = "A-2027";
const nadia = userById("nadia")!;
const rahima = userById("rahima")!;
const bilal = userById("bilal")!;
const farida = userById("farida")!;
const refusal = async (f: () => Promise<unknown>) => f().then(() => "", (e: Error) => e.message);
const farmer = async (id: string) => (await loadField(code, nadia)).items.find((i) => i.id === id) as Farmer;
const base = "https://kf.example.org/api/v2/assets/aDist/data/1/attachments";
const attachments = [
  { download_url: `${base}/1/`, download_medium_url: `${base}/1/?size=medium`, mimetype: "image/jpeg", filename: "rop/attachments/aDist/u/note.jpg", question_xpath: "list_photo" },
  { download_url: `${base}/2/`, download_medium_url: `${base}/2/?size=medium`, mimetype: "image/jpeg", filename: "rop/attachments/aDist/u/hand.jpg", question_xpath: "handover_photo" },
];

let id = "";
let farmerId = "";

async function koboRow(uuid: string, farmerCode: string, payload: Record<string, unknown>) {
  const project = (await db.select().from(s.projects).where(eq(s.projects.code, code)))[0];
  const [row] = await db
    .insert(s.evidence)
    .values({ organizationId: project.organizationId, projectId: project.id, source: "kobo", form: "distribution", farmerCode, reviewStatus: "pending", completedBy: "bilal.kobo", completedAt: new Date("2026-11-27T18:00:00Z"), koboAssetUid: "aDist", koboSubmissionUuid: uuid, koboSubmissionId: 1, payload })
    .returning({ id: s.evidence.id });
  await listDistributions(code);
  return row.id;
}

beforeAll(async () => {
  await ready;
  await seedDatabase();
  // One named person checks KoboCollect data (the Director of MEL); the storekeeper's account is matched to him.
  await saveKoboApproval(code, { who: "named", person: "rahima", accounts: { "bilal.kobo": "bilal" } });
  farmerId = ((await loadField(code, nadia)).items.find((i) => i.kind === "farmer" && (i as Farmer).step === "distribute" && !(i as Farmer).awaiting) as Farmer).id;
  id = await koboRow("proof-1", farmerId, { farmer: farmerId, distribution_date: "2026-11-24", seed_kg: "10", npk_kg: "50", condition: "good", signed: "yes", list_photo: "note.jpg", handover_photo: "hand.jpg", start_geopoint: "34.562 69.21 1790 6", _attachments: attachments });
}, 120_000);

describe("a KoboCollect distribution carries its own proof", () => {
  it("is dated the day the goods were handed out, not the day the phone synced", async () => {
    const d = (await listDistributions(code)).find((x) => x.id === id)!;
    expect(d.date).toBe("2026-11-24");
    expect(dayOf({ payload: { date: "2026-11-19" }, completedAt: new Date("2026-11-25T03:00:00Z") })).toBe("2026-11-19");
    expect(dayOf({ payload: {}, completedAt: new Date("2026-11-25T03:00:00Z") })).toBe("2026-11-25");
  });

  it("tells the page which photos can be opened and that a place came with it, without the coordinates", async () => {
    const d = (await listDistributions(code)).find((x) => x.id === id)!;
    // The person, not the account name: bilal.kobo is matched to Bilal on this project.
    expect(d.recordedBy).toBe("Bilal Haidari");
    expect(d.unmatchedAccount).toBeNull();
    expect(d.koboPhotos).toEqual(["note", "handover"]);
    expect(d.hasPlace).toBe(true);
    expect(JSON.stringify(d)).not.toContain("34.562");
  });

  it("hands the signed note's photo to the page from the project's own KoboToolbox account", async () => {
    photo.bytes = Buffer.from(exifJpeg({ taken: "2026:11:24 09:58:11", gps: { lat: 34.5623, lon: 69.2101 } }));
    photo.calls.length = 0;
    const got = await koboPhoto(code, id, "note");
    expect(got.type).toBe("image/jpeg");
    expect(photo.calls[0]).toContain("/attachments/1/");
    photo.bytes = null;
    expect(await refusal(() => koboPhoto(code, id, "note"))).toMatch(/did not hand over the photo/);
  });

  it("says where and when from the phone and the photo, with coordinates only for people who may see them", async () => {
    photo.bytes = Buffer.from(exifJpeg({ taken: "2026:11:24 09:58:11", gps: { lat: 34.5623, lon: 69.2101 } }));
    const precise = await distributionFacts(code, id, true);
    expect(precise.place).toMatchObject({ lat: 34.562, lon: 69.21, from: "device" });
    expect(precise.photo).toEqual({ date: "2026-11-24", time: "09:58", hasPlace: true });
    expect(precise.apart!.metres).toBeGreaterThan(20);
    expect(precise.apart!.metres).toBeLessThan(50);
    expect(precise.apart!.far).toBe(false);
    expect(precise.dayDiffers).toBeNull();

    const plain = await distributionFacts(code, id, false);
    expect(plain.place).toEqual({ from: "device", fromText: "the phone's GPS when the form was opened" });
    expect(plain.apart!.text).toBe(precise.apart!.text);
  });

  it("flags a photo taken somewhere else or on another day, and never fails because a photo holds no place", async () => {
    photo.bytes = Buffer.from(exifJpeg({ taken: "2026:11:20 16:00:00", gps: { lat: 34.9, lon: 69.6 } }));
    const off = await distributionFacts(code, id, false);
    expect(off.apart!.far).toBe(true);
    expect(off.dayDiffers).toEqual({ form: "2026-11-24", photo: "2026-11-20" });

    photo.bytes = Buffer.from(exifJpeg({ taken: "2026:11:24 09:58:11", gps: null }));
    const bare = await distributionFacts(code, id, false);
    expect(bare.apart).toBeNull();
    expect(bare.place?.from).toBe("device");
    expect(bare.missing.join(" ")).toMatch(/holds no place of its own/);

    photo.bytes = null;
    const unread = await distributionFacts(code, id, false);
    expect(unread.photo).toBeNull();
    expect(unread.missing.join(" ")).toMatch(/could not be read from KoboToolbox/);
  });
});

describe("whoever checks a KoboCollect record can return it to the person who collected it", () => {
  it("the Director of MEL sends it back; the task goes to the collector, not to the first storekeeper found", async () => {
    // Nobody else may: the extension agent neither checks KoboCollect data nor manages the project.
    expect(await refusal(() => decideDistribution(code, id, "sent_back", farida, "wrong"))).toMatch(/Only .* can approve this distribution or send it back/);
    const back = await decideDistribution(code, id, "sent_back", rahima, "The photo is of another farmer's note");
    expect(back.fixer).toBe("bilal");
    expect(back.fixerName).toBe("Bilal Haidari");
    const [task] = await db.select().from(s.workItems).where(like(s.workItems.sourceKey, `dist-fix:${id}`));
    expect(task.assignee).toBe("bilal");
    // The checker still cannot approve.
    const again = await koboRow("proof-2", farmerId, { farmer: farmerId, distribution_date: "2026-11-24", seed_kg: "10", npk_kg: "50", condition: "good", signed: "yes", list_photo: "note.jpg", _attachments: attachments });
    expect(await refusal(() => decideDistribution(code, again, "approved", rahima))).toMatch(/KoboCollect/);
    await db.delete(s.evidence).where(eq(s.evidence.id, again));
  });

  it("a tick is not a photo: the fix counts the photo only when one is on file", async () => {
    // A second record that arrived with no photo at all, sent back for it.
    const bare = await koboRow("proof-3", farmerId, { farmer: farmerId, distribution_date: "2026-11-24", seed_kg: "10", npk_kg: "50", condition: "good", signed: "yes" });
    await decideDistribution(code, bare, "sent_back", rahima, "No photo of the signed note");
    await resubmitDistribution(code, bare, bilal, { photo: true }, "Will add the photo", "http://test");
    expect((await listDistributions(code)).find((x) => x.id === bare)!.closeBlock).toMatch(/no photo of the signed goods received note/);
    await decideDistribution(code, bare, "sent_back", rahima, "Still no photo");

    // The collector adds it on the distribution's own page: filed on the farmer's record with what the photo says of itself.
    expect(await refusal(() => addSignedNote(code, "00000000-0000-0000-0000-000000000000", bilal, { src: "data:image/jpeg;base64,AA==" }))).toMatch(/not on this project/);
    const added = await addSignedNote(code, bare, bilal, { src: "data:image/jpeg;base64,AA==", taken: { date: "2026-11-24", time: "10:05" }, gps: { lat: 34.5621, lon: 69.2102 } });
    expect(added.date).toBe("2026-11-24");
    const f = await farmer(farmerId);
    expect(hasSignedNotePhoto(f)).toBe(true);
    expect(f.photos.at(-1)).toMatchObject({ activity: "distribution", signedNote: true, tag: "signed-note", date: "2026-11-24", taken: { date: "2026-11-24", time: "10:05" }, gps: { lat: 34.5621, lon: 69.2102 } });

    await resubmitDistribution(code, bare, bilal, {}, "Photo of the signed note added", "http://test");
    const d = (await listDistributions(code)).find((x) => x.id === bare)!;
    expect(d.photo).toBe(true);
    expect(d.closeBlock).toBeNull();

    // Where and when, for a record whose photo is in the app: read from what was kept with the photo.
    const facts = await distributionFacts(code, bare, true);
    expect(facts.photo).toEqual({ date: "2026-11-24", time: "10:05", hasPlace: true });
    expect(facts.place).toMatchObject({ lat: 34.5621, lon: 69.2102, from: "photo" });
  });

  it("once checked and approved, the result is counted on the day the goods were handed out", async () => {
    const bare = (await listDistributions(code)).find((x) => x.status === "pending" && x.source === "kobo")!;
    await checkKoboDistribution(code, bare.id, { id: rahima.id, name: rahima.name }, "http://test");
    const res = await decideDistribution(code, bare.id, "approved", nadia);
    expect(res.target).toBeTruthy();
    // What finance was asked is said exactly: a task per purchase with a payment waiting, or none.
    expect(Array.isArray(res.payments)).toBe(true);
    for (const pay of res.payments) expect(pay).toMatchObject({ purchase: expect.stringMatching(/^PR-/), supplier: expect.any(String) });
    const made = (await loadResults(code)).filter((r) => r.distribution === bare.id);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ date: "2026-11-24", by: "bilal" });
  });
});

describe("every KoboCollect form in the review queue carries its proof", () => {
  let visit = "";
  it("a readiness visit: the plot's photo by the question it was taken on, the plot's GPS, and the storekeeper's note", async () => {
    const project = (await db.select().from(s.projects).where(eq(s.projects.code, code)))[0];
    const [row] = await db
      .insert(s.evidence)
      .values({ organizationId: project.organizationId, projectId: project.id, source: "kobo", form: "readiness", farmerCode: farmerId, reviewStatus: "pending", completedBy: "farida.kobo", completedAt: new Date(), koboAssetUid: "aReady", koboSubmissionUuid: "proof-ready", koboSubmissionId: 7, payload: { farmer: farmerId, visit_date: "2026-11-24", ready: "yes", photo: "plot.jpg", location: "34.5621 69.2103 1790 5", start_geopoint: "34.5 69.1 0 9", notes: "Ridges redone since the first visit", _attachments: [{ download_url: `${base}/9/`, mimetype: "image/jpeg", filename: "rop/attachments/aReady/u/plot.jpg" }] } })
      .returning({ id: s.evidence.id });
    visit = row.id;
    photo.bytes = Buffer.from(exifJpeg({ taken: "2026:11:24 11:20:00", gps: { lat: 34.5622, lon: 69.2104 } }));
    const proof = await submissionProof(code, visit, true);
    expect(proof.photos).toEqual([{ question: "photo", tag: "visit", label: "Photo of the plot" }]);
    // Standing at the plot: the GPS question the agent answered is the place, not where the form was opened.
    expect(proof.facts.place).toMatchObject({ lat: 34.5621, lon: 69.2103, from: "question" });
    expect(proof.facts.photo).toEqual({ date: "2026-11-24", time: "11:20", hasPlace: true });
    expect(proof.facts.apart!.far).toBe(false);
    expect(proof.facts.note).toBe("Ridges redone since the first visit");
    expect((await submissionProof(code, visit, false)).facts.place).toEqual({ from: "question", fromText: "the GPS question on the form" });
  });

  it("hands over the photo by its question, and refuses a question with no photo or a record typed in the app", async () => {
    expect((await submissionPhoto(code, visit, "photo")).type).toBe("image/jpeg");
    expect(await refusal(() => submissionPhoto(code, visit, "list_photo"))).toMatch(/no photo for this question/);
    const typed = (await db.select().from(s.evidence).where(eq(s.evidence.source, "manual")))[0];
    expect(await refusal(() => submissionProof(code, typed.id, true))).toMatch(/not on this project/);
  });
});

describe("the form the app makes from the package", () => {
  it("one tap for the planned amount, a typed amount only when it differed, and an item not given left out", async () => {
    const answered = await koboRow("proof-gen", farmerId, { farmer: farmerId, distribution_date: "2026-11-26", seed_given: "yes", npk_given: "other", npk_qty: "40", condition: "good", signed: "yes", list_photo: "note.jpg", _attachments: attachments });
    const d = (await listDistributions(code)).find((x) => x.id === answered)!;
    const planned = Object.fromEntries(d.planned.map((i) => [i.key, i.qty]));
    expect(Object.fromEntries(d.items.map((i) => [i.key, i.qty]))).toEqual({ seed: planned.seed, npk: 40 });

    const partial = await koboRow("proof-gen-2", farmerId, { farmer: farmerId, distribution_date: "2026-11-26", seed_given: "yes", npk_given: "no", condition: "good", signed: "yes", list_photo: "note.jpg", _attachments: attachments });
    expect((await listDistributions(code)).find((x) => x.id === partial)!.items.map((i) => i.key)).toEqual(["seed"]);
  });
});
