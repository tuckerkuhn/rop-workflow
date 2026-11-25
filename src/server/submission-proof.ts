import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { distanceText, metresBetween, photoFacts } from "@/lib/exif";
import { koboAttachment, koboOriginalUrl, koboPhotos, koboPlace, placeSourceText, tagLabels, type PhotoTag } from "@/lib/kobo-photo";
import type { DistFacts } from "@/server/distribution-photo";
import { projectByCode } from "@/server/field-store";
import { HttpError } from "@/server/guard";
import { attachmentBytes } from "@/server/kobo-client";
import { credentials } from "@/server/kobo-link";

/**
 * The proof behind any field form from KoboCollect (readiness visit, training attendance, farm
 * visit, input distribution), for whoever checks it: its photos, fetched from the project's own
 * KoboToolbox account when asked for, and where and when it was filled in, read from the phone and
 * the photo. The same reading as an input distribution's approval page (server/distribution-photo),
 * for every form in the review queue. Nothing here is typed by anyone.
 */

const IMAGE = /^image\/(jpeg|png|webp)$/;
const FAR_METRES = 2000;

async function rowOf(code: string, id: string) {
  const project = await projectByCode(code);
  const [row] = await db.select().from(s.evidence).where(and(eq(s.evidence.id, id), eq(s.evidence.projectId, project.id))).limit(1);
  if (!row || row.source !== "kobo") throw new HttpError(404, "That KoboCollect record is not on this project.");
  return { row, payload: (row.payload ?? {}) as Record<string, unknown> };
}

export type ProofPhoto = { question: string; tag: PhotoTag | null; label: string };

/** What a photo shows, in the words of the form it came on: a readiness visit's photo is of the plot, a training's of the signed register. */
const photoLabel = (form: string | null, tag: PhotoTag | null) =>
  tag === "signed-note" || tag === "delivery" ? tagLabels[tag] : form === "training" ? "Signed attendance register" : form === "readiness" || form === "visit" ? "Photo of the plot" : tag ? tagLabels[tag] : "Photo";

/** The day the form itself says the work happened. */
const formDay = (p: Record<string, unknown>) => [p.distribution_date, p.visit_date, p.training_date].find((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d))?.slice(0, 10) ?? null;

/** Which photos a KoboCollect record holds and where and when it was made. One call to KoboToolbox, for the first photo's own date and place. */
export async function submissionProof(code: string, id: string, precise: boolean): Promise<{ photos: ProofPhoto[]; facts: DistFacts }> {
  const { row, payload } = await rowOf(code, id);
  const found = koboPhotos(payload, row.form);
  const photos = found.map((a) => ({ question: a.question, tag: a.tag, label: photoLabel(row.form, a.tag) }));
  const missing: string[] = [];
  const place = koboPlace(payload);
  let facts: ReturnType<typeof photoFacts> | null = null;
  const original = found.length ? koboOriginalUrl(payload, found[0].question) : null;
  if (original) {
    try {
      const c = await credentials(code);
      const got = await attachmentBytes(c.server, c.token, original, 12_000_000);
      if (got) facts = photoFacts(got.bytes);
      else missing.push("The photo could not be read from KoboToolbox just now, so its own date and place are not shown.");
    } catch {
      missing.push("The photo could not be read from KoboToolbox just now, so its own date and place are not shown.");
    }
  }
  const at = place ?? (facts?.gps ? { ...facts.gps, from: "photo" as const } : null);
  if (!at) missing.push("No GPS point came with this record. The phone may have had location switched off, or the form is an older version.");
  else if (facts && !facts.gps && at.from !== "photo") missing.push("The photo holds no place of its own. Many phones remove it, so the form's GPS point is the one to go by.");
  const metres = place && facts?.gps ? metresBetween(place, facts.gps) : null;
  const day = formDay(payload);
  return {
    photos,
    facts: {
      place: at ? { ...(precise ? { lat: at.lat, lon: at.lon } : {}), from: at.from, fromText: placeSourceText[at.from] } : null,
      photo: facts ? { date: facts.date, time: facts.time, hasPlace: !!facts.gps } : null,
      apart: metres === null ? null : { metres, text: distanceText(metres), far: metres > FAR_METRES },
      dayDiffers: day && facts?.date && facts.date !== day ? { form: day, photo: facts.date } : null,
      missing,
      ...(typeof payload.notes === "string" && payload.notes.trim() ? { note: payload.notes.trim().slice(0, 1000) } : {}),
    },
  };
}

/** One photo of a KoboCollect record, as bytes, by the question it was taken on. */
export async function submissionPhoto(code: string, id: string, question: string): Promise<{ bytes: Buffer; type: string }> {
  const { row, payload } = await rowOf(code, id);
  const att = koboAttachment(payload, question, row.form);
  if (!att) throw new HttpError(404, "KoboToolbox has no photo for this question yet. If the phone is still uploading, sync again in a few minutes.");
  const c = await credentials(code);
  const got = await attachmentBytes(c.server, c.token, att.url);
  const type = got?.type && IMAGE.test(got.type) ? got.type : att.type;
  if (!got || !IMAGE.test(type)) throw new HttpError(502, "KoboToolbox did not hand over the photo. Open the record in KoboToolbox to see it, or try again.");
  return { bytes: got.bytes, type };
}
