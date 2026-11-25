import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { koboAttachment, koboOriginalUrl, koboPhotos, koboPlace, tagLabels, type PhotoTag } from "@/lib/kobo-photo";
import { projectByCode } from "@/server/field-store";
import { HttpError } from "@/server/guard";
import { factsFrom, fetchKoboPhoto, koboPhotoFacts, NO_FORM_POINT, type DistFacts } from "@/server/kobo-proof";

/**
 * The proof behind any field form from KoboCollect (readiness visit, training attendance, farm
 * visit, input distribution), for whoever checks it: its photos, fetched from the project's own
 * KoboToolbox account when asked for, and where and when it was filled in, read from the phone and
 * the photo. The same reading as an input distribution's approval page (server/distribution-photo),
 * for every form in the review queue. Nothing here is typed by anyone.
 */


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
  const original = found.length ? koboOriginalUrl(payload, found[0].question) : null;
  const facts = original ? await koboPhotoFacts(code, original, missing) : null;
  return { photos, facts: factsFrom({ place: koboPlace(payload), facts, formDay: formDay(payload), precise, missing, noPlace: NO_FORM_POINT, note: payload.notes }) };
}

/** One photo of a KoboCollect record, as bytes, by the question it was taken on. */
export async function submissionPhoto(code: string, id: string, question: string): Promise<{ bytes: Buffer; type: string }> {
  const { row, payload } = await rowOf(code, id);
  return fetchKoboPhoto(code, koboAttachment(payload, question, row.form));
}
