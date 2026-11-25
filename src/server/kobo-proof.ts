import { distanceText, metresBetween, photoFacts, type PhotoFacts } from "@/lib/exif";
import { placeSourceText, type Place } from "@/lib/kobo-photo";
import { HttpError } from "@/server/guard";
import { attachmentBytes, attachmentHead } from "@/server/kobo-client";
import { credentials } from "@/server/kobo-link";

/**
 * What every field record's proof shares (server/distribution-photo for an input distribution's
 * approval page, server/submission-proof for any KoboCollect record in the review queue): fetching
 * one photo, reading the photo's own date and place, and putting where and when together.
 */

export type DistFacts = {
  /** Where the record was made and how we know. Coordinates only for viewers who may see them. */
  place: (Partial<{ lat: number; lon: number }> & { from: Place["from"]; fromText: string }) | null;
  /** What the photo says about itself. */
  photo: { date: string | null; time: string | null; hasPlace: boolean } | null;
  /** How far the photo was taken from where the form was filled in; null when either is unknown. */
  apart: { metres: number; text: string; far: boolean } | null;
  /** The photo's day when it differs from the day recorded on the form. */
  dayDiffers: { form: string; photo: string } | null;
  /** In words, what could not be read and why that is not a fault. */
  missing: string[];
  /** What the person in the field wrote under "Anything else to note". Signed-in staff only: it may hold a name. */
  note?: string;
};

const IMAGE = /^image\/(jpeg|png|webp)$/;
/** More than this between the form's point and the photo's is worth a look (a village is small; a district is not). */
export const FAR_METRES = 2000;
export const PHOTO_UNREAD = "The photo could not be read from KoboToolbox just now, so its own date and place are not shown.";
export const NO_FORM_POINT = "No GPS point came with this record. The phone may have had location switched off, or the form is an older version.";

/** One photo from the project's KoboToolbox account, as bytes. `att`: the attachment the record names. */
export async function fetchKoboPhoto(code: string, att: { url: string; type: string } | null): Promise<{ bytes: Buffer; type: string }> {
  if (!att) throw new HttpError(404, "KoboToolbox has no photo for this question yet. If the phone is still uploading, sync again in a few minutes.");
  const c = await credentials(code);
  const got = await attachmentBytes(c.server, c.token, att.url);
  const type = got?.type && IMAGE.test(got.type) ? got.type : att.type;
  if (!got || !IMAGE.test(type)) throw new HttpError(502, "KoboToolbox did not hand over the photo. Open the record in KoboToolbox to see it, or try again.");
  return { bytes: got.bytes, type };
}

/**
 * The photo's own date, time and place, from the start of the original file only (EXIF is not in
 * KoboToolbox's resized copies, and sits in the first few kilobytes). Null, with the reason in
 * `missing`, when it cannot be read.
 */
export async function koboPhotoFacts(code: string, originalUrl: string, missing: string[]): Promise<PhotoFacts | null> {
  try {
    const c = await credentials(code);
    const head = await attachmentHead(c.server, c.token, originalUrl);
    if (head) return photoFacts(head);
  } catch {
    /* reported below */
  }
  missing.push(PHOTO_UNREAD);
  return null;
}

/**
 * Where and when, put together. `place`: the form's point (or one taken from a photo already); the
 * photo's own place stands in when there is none. `noPlace`: what to say when neither has one.
 */
export function factsFrom(o: { place: Place | null; facts: PhotoFacts | null; formDay: string | null; precise: boolean; missing: string[]; noPlace: string; note?: unknown }): DistFacts {
  const { facts, missing } = o;
  const at = o.place ?? (facts?.gps ? { ...facts.gps, from: "photo" as const } : null);
  if (!at) missing.push(o.noPlace);
  else if (facts && !facts.gps && at.from !== "photo") missing.push("The photo holds no place of its own. Many phones remove it, so the form's GPS point is the one to go by.");
  const metres = at && at.from !== "photo" && facts?.gps ? metresBetween(at, facts.gps) : null;
  return {
    place: at ? { ...(o.precise ? { lat: at.lat, lon: at.lon } : {}), from: at.from, fromText: placeSourceText[at.from] } : null,
    photo: facts ? { date: facts.date, time: facts.time, hasPlace: !!facts.gps } : null,
    apart: metres === null ? null : { metres, text: distanceText(metres), far: metres > FAR_METRES },
    dayDiffers: o.formDay && facts?.date && facts.date !== o.formDay ? { form: o.formDay, photo: facts.date } : null,
    missing,
    ...(typeof o.note === "string" && o.note.trim() ? { note: o.note.trim().slice(0, 1000) } : {}),
  };
}
