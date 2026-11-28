import { distanceText, metresBetween, type PhotoFacts } from "@/lib/exif";
import { placeSourceText, type Place } from "@/lib/kobo-photo";
import { HttpError } from "@/server/guard";

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

/** More than this between the form's point and the photo's is worth a look (a village is small; a district is not). */
export const FAR_METRES = 2000;
export const PHOTO_UNREAD = "The photo stayed in KoboToolbox, which the app no longer connects to, so its own date and place are not shown.";
export const NO_FORM_POINT = "No GPS point came with this record. The phone may have had location switched off, or the form is an older version.";

/**
 * A photo kept in KoboToolbox. The app no longer connects to KoboToolbox (removed 28 Nov 2026), so
 * a photo that stayed there is not fetched: the person is told where it is.
 */
export async function fetchKoboPhoto(_code: string, _att: { url: string; type: string } | null): Promise<{ bytes: Buffer; type: string }> {
  void _code;
  if (!_att) throw new HttpError(404, "The record has no photo for this question.");
  throw new HttpError(410, KOBO_PHOTO_GONE);
}
export const KOBO_PHOTO_GONE = "This photo was kept in KoboToolbox, which the app no longer connects to. Open the record in the project's KoboToolbox account to see it.";

/** The photo's own date and place: not readable for a photo left in KoboToolbox (see fetchKoboPhoto). */
export async function koboPhotoFacts(_code: string, _originalUrl: string, missing: string[]): Promise<PhotoFacts | null> {
  void [_code, _originalUrl];
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
