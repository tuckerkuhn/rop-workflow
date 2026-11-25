import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { distanceText, metresBetween, photoFacts, type Point } from "@/lib/exif";
import type { Farmer } from "@/lib/field";
import { koboAttachment, koboOriginalUrl, koboPlace, placeSourceText, type Place } from "@/lib/kobo-photo";
import { projectByCode } from "@/server/field-store";
import { HttpError } from "@/server/guard";
import { attachmentBytes } from "@/server/kobo-client";
import { credentials } from "@/server/kobo-link";

/**
 * The proof behind one input distribution, for the people who check and approve it:
 *
 * - The photos. A record from KoboCollect keeps its photos in KoboToolbox; they are fetched from the
 *   project's own account when somebody opens the record, so the Director of MEL and the project
 *   manager look at the signed note itself and not at a line saying one exists.
 * - Where and when. Taken from the phone and the photo, never typed: the form's GPS point, the
 *   photo's own date, time and place (EXIF), and how far apart the two are.
 *
 * Photos can show farmers' names and a GPS point is where a farmer lives: both go only to signed-in
 * staff, and the coordinates only to people who may see participant names (the route decides).
 */

export type PhotoWhich = "note" | "handover";
const QUESTION: Record<PhotoWhich, string> = { note: "list_photo", handover: "handover_photo" };
const IMAGE = /^image\/(jpeg|png|webp)$/;

async function rowOf(code: string, id: string) {
  const project = await projectByCode(code);
  const [row] = await db.select().from(s.evidence).where(and(eq(s.evidence.id, id), eq(s.evidence.projectId, project.id), eq(s.evidence.form, "distribution"))).limit(1);
  if (!row) throw new HttpError(404, "That distribution is not on this project.");
  return { project, row, payload: (row.payload ?? {}) as Record<string, unknown> };
}

/** Which KoboCollect photos a distribution holds. Read from the stored record: no call to KoboToolbox. */
export function koboPhotosOf(row: { source: string; payload: unknown }): PhotoWhich[] {
  if (row.source !== "kobo") return [];
  const p = (row.payload ?? {}) as Record<string, unknown>;
  return (Object.keys(QUESTION) as PhotoWhich[]).filter((w) => !!koboAttachment(p, QUESTION[w], "distribution"));
}

/** One photo of a KoboCollect distribution, as bytes, from the project's KoboToolbox account. */
export async function koboPhoto(code: string, id: string, which: PhotoWhich): Promise<{ bytes: Buffer; type: string }> {
  const { row, payload } = await rowOf(code, id);
  if (row.source !== "kobo") throw new HttpError(404, "This distribution was recorded in the app: its photo is on the farmer's record.");
  const att = koboAttachment(payload, QUESTION[which], "distribution");
  if (!att) throw new HttpError(404, "KoboToolbox has no photo for this question yet. If the phone is still uploading, sync again in a few minutes.");
  const c = await credentials(code);
  const got = await attachmentBytes(c.server, c.token, att.url);
  const type = got?.type && IMAGE.test(got.type) ? got.type : att.type;
  if (!got || !IMAGE.test(type)) throw new HttpError(502, "KoboToolbox did not hand over the photo. Open the record in KoboToolbox to see it, or try again.");
  return { bytes: got.bytes, type };
}

export type DistFacts = {
  /** Where the record was made and how we know. Coordinates only for viewers who may see them. */
  place: (Partial<Point> & { from: Place["from"]; fromText: string }) | null;
  /** What the signed note's photo says about itself. */
  photo: { date: string | null; time: string | null; hasPlace: boolean } | null;
  /** How far the photo was taken from where the form was filled in; null when either is unknown. */
  apart: { metres: number; text: string; far: boolean } | null;
  /** The photo's day when it differs from the day recorded on the form. */
  dayDiffers: { form: string; photo: string } | null;
  /** In words, what could not be read and why that is not a fault. */
  missing: string[];
};

/** More than this between the form's point and the photo's is worth a look (a village is small; a district is not). */
const FAR_METRES = 2000;

/**
 * Where and when a distribution happened, from the phone and the photo. `precise` says whether the
 * viewer may see coordinates; without it they still learn that a place was captured, from what, and
 * whether the photo was taken at the same spot. Reads the original photo once (EXIF is not in
 * KoboToolbox's resized copies); a photo that cannot be fetched is reported, not thrown.
 */
export async function distributionFacts(code: string, id: string, precise: boolean): Promise<DistFacts> {
  const { project, row, payload } = await rowOf(code, id);
  const missing: string[] = [];
  let place: Place | null = null;
  let facts: ReturnType<typeof photoFacts> | null = null;
  const formDay = typeof payload.distribution_date === "string" ? payload.distribution_date.slice(0, 10) : typeof payload.date === "string" ? payload.date.slice(0, 10) : null;

  let fromKobo = false;
  if (row.source === "kobo") {
    place = koboPlace(payload);
    const original = koboOriginalUrl(payload, QUESTION.note);
    if (original) {
      fromKobo = true;
      try {
        const c = await credentials(code);
        const got = await attachmentBytes(c.server, c.token, original, 12_000_000);
        if (got) facts = photoFacts(got.bytes);
        else missing.push("The photo could not be read from KoboToolbox just now, so its own date and place are not shown.");
      } catch {
        missing.push("The photo could not be read from KoboToolbox just now, so its own date and place are not shown.");
      }
    }
  }
  if (!fromKobo && row.farmerCode) {
    // The photo is in the app (recorded here, or added to a KoboCollect record that came without
    // one): it carries what was read from it when it was added.
    const [item] = await db.select({ data: s.fieldItems.data }).from(s.fieldItems).where(and(eq(s.fieldItems.projectId, project.id), eq(s.fieldItems.itemKey, row.farmerCode))).limit(1);
    const note = [...((item?.data as Farmer | undefined)?.photos ?? [])].reverse().find((p) => p.activity === "distribution" && p.signedNote && p.src);
    if (note) {
      facts = { date: note.taken?.date ?? null, time: note.taken?.time ?? null, gps: note.gps ?? null };
      if (!place && note.gps) place = { ...note.gps, from: "photo" };
    }
  }

  // No form point but the photo has one: the photo is where it happened.
  if (!place && facts?.gps) place = { ...facts.gps, from: "photo" };
  if (!place) missing.push(row.source === "kobo" ? "No GPS point came with this record. The phone may have had location switched off, or the form is an older version." : "No place was found in the photo. Many phones and apps remove it; that is not a fault of the record.");
  else if (facts && !facts.gps && place.from !== "photo") missing.push("The photo holds no place of its own. Many phones remove it, so the form's GPS point is the one to go by.");

  const metres = place && place.from !== "photo" && facts?.gps ? metresBetween(place, facts.gps) : null;
  return {
    place: place ? { ...(precise ? { lat: place.lat, lon: place.lon } : {}), from: place.from, fromText: placeSourceText[place.from] } : null,
    photo: facts ? { date: facts.date, time: facts.time, hasPlace: !!facts.gps } : null,
    apart: metres === null ? null : { metres, text: distanceText(metres), far: metres > FAR_METRES },
    dayDiffers: formDay && facts?.date && facts.date !== formDay ? { form: formDay, photo: facts.date } : null,
    missing,
  };
}
