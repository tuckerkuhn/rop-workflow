import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { PhotoFacts } from "@/lib/exif";
import type { Farmer } from "@/lib/field";
import { koboAttachment, koboOriginalUrl, koboPlace, type Place } from "@/lib/kobo-photo";
import { projectByCode } from "@/server/field-store";
import { HttpError } from "@/server/guard";
import { factsFrom, fetchKoboPhoto, koboPhotoFacts, NO_FORM_POINT, type DistFacts } from "@/server/kobo-proof";

export type { DistFacts };

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
  return fetchKoboPhoto(code, koboAttachment(payload, QUESTION[which], "distribution"));
}

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
  let facts: PhotoFacts | null = null;
  const formDay = typeof payload.distribution_date === "string" ? payload.distribution_date.slice(0, 10) : typeof payload.date === "string" ? payload.date.slice(0, 10) : null;

  let fromKobo = false;
  if (row.source === "kobo") {
    place = koboPlace(payload);
    const original = koboOriginalUrl(payload, QUESTION.note);
    if (original) {
      fromKobo = true;
      facts = await koboPhotoFacts(code, original, missing);
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
  const noPlace = row.source === "kobo" ? NO_FORM_POINT : "No place was found in the photo. Many phones and apps remove it; that is not a fault of the record.";
  return factsFrom({ place, facts, formDay, precise, missing, noPlace, note: row.source === "kobo" ? payload.notes : undefined });
}
