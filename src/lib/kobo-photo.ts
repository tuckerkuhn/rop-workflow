import { pointOf, type Point } from "@/lib/exif";

/**
 * What a KoboCollect record already knows, so nobody is asked for it again:
 *
 * - Where it was filled in. Read from, in order: the GPS question when a person answered it
 *   (`location`: on the plot forms that is the plot; on the others it is asked only when the phone
 *   found no place by itself), the phone's own fix when the form was opened (`start_geopoint`, the
 *   XLSForm "start-geopoint" metadata question: nothing to tap), then KoboToolbox's `_geolocation`.
 * - Its photos, each already tagged by the question it was taken on. The person in the field never
 *   picks a tag: taking the photo on "Photo of the signed goods received note" is the tag.
 *
 * Pure: the same reading for the review queue, the approval page and the data set.
 */

export type PlaceSource = "device" | "question" | "photo";
export type Place = Point & { from: PlaceSource };

/** "34.56 69.21 1800 5" (KoboToolbox's geopoint text: latitude, longitude, altitude, accuracy). */
function fromText(raw: unknown): Point | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parts = raw.trim().split(/\s+/);
  return parts.length >= 2 ? pointOf(parts[0], parts[1]) : null;
}

/** Where a KoboCollect record was filled in, and how we know; null when the record holds no place. */
export function koboPlace(p: Record<string, unknown> | null | undefined): Place | null {
  if (!p) return null;
  // A GPS question somebody answered on purpose (standing at the plot) is the place the record is about.
  const asked = fromText(p.location);
  if (asked) return { ...asked, from: "question" };
  // Otherwise the phone's own fix when the form was opened: captured without a tap.
  const device = fromText(p.start_geopoint) ?? fromText(p["start-geopoint"]) ?? fromText(p["meta/start_geopoint"]);
  if (device) return { ...device, from: "device" };
  const g = p._geolocation;
  const kobo = Array.isArray(g) && g.length >= 2 ? pointOf(g[0], g[1]) : null;
  return kobo ? { ...kobo, from: "question" } : null;
}

export const placeSourceText: Record<PlaceSource, string> = {
  device: "the phone's GPS when the form was opened",
  question: "the GPS question on the form",
  photo: "the photo itself",
};

/* ---------- photos, tagged by the question they answer ---------- */

/**
 * The tags a photo can carry. A tag decides which record the photo belongs to, which approval it
 * starts and which rule applies (TAG_RULES). One list for KoboCollect photos and for photos added
 * in the app.
 */
export const PHOTO_TAGS = ["signed-note", "delivery", "training", "visit", "landprep", "planting", "receipt"] as const;
export type PhotoTag = (typeof PHOTO_TAGS)[number];

export const tagLabels: Record<PhotoTag, string> = {
  "signed-note": "Signed goods received note",
  delivery: "Handover of the goods",
  training: "Training",
  visit: "Farm visit",
  landprep: "Land preparation",
  planting: "Planting",
  receipt: "Receipt",
};

/** What a tag sets going, in one sentence each: shown at the moment of tagging, so the next step is never a surprise. */
export const TAG_RULES: Record<PhotoTag, { record: string; next: string }> = {
  "signed-note": {
    record: "the farmer's input distribution",
    next: "It is the proof the distribution needs. A distribution waiting only for this photo can be approved as soon as it is saved.",
  },
  delivery: { record: "the farmer's input distribution", next: "Kept with the distribution for the report. It starts no approval." },
  training: { record: "the farmer's training", next: "Kept on the farmer's record. Attendance itself comes from the training form." },
  visit: { record: "the farmer's plot", next: "Kept on the farmer's record with the place and day it was taken." },
  landprep: { record: "the farmer's plot", next: "Kept on the farmer's record as proof the plot was prepared." },
  planting: { record: "the farmer's plot", next: "Kept on the farmer's record as proof of planting." },
  receipt: { record: "an expense claim", next: "Opens an expense claim with this receipt attached and its date filled in. Your manager approves the claim." },
};

/**
 * The tag a KoboCollect photo carries, from the form it came on and the question it answers.
 * Unknown questions get the form's own tag, so a form somebody adds a photo question to still lands.
 */
export function koboPhotoTag(form: string | null, question: string): PhotoTag | null {
  const q = question.split("/").at(-1) ?? question;
  if (q === "list_photo" || /signed|grn|note/.test(q)) return "signed-note";
  if (q === "handover_photo" || /handover|delivery/.test(q)) return "delivery";
  if (form === "distribution") return "delivery";
  if (form === "training") return "training";
  if (form === "readiness" || form === "visit") return "visit";
  return null;
}

export type KoboAttachment = { question: string; tag: PhotoTag | null; url: string; type: string; name: string };

const text = (v: unknown) => (typeof v === "string" ? v : "");
/** KoboToolbox stores "IMG 12.jpg" as "IMG_12.jpg" and may prefix a path: compare on the bare, normalised name. */
const bare = (name: string) => (name.split("/").at(-1) ?? name).replace(/\s+/g, "_").toLowerCase();

/**
 * The image a submission holds for one question: the answer is the file's name, and the file is in
 * `_attachments`. Null when the question has no answer or its file is not there (still uploading).
 */
export function koboAttachment(p: Record<string, unknown> | null | undefined, question: string, form: string | null = null): KoboAttachment | null {
  const answer = text(p?.[question]);
  if (!p || !answer) return null;
  const list = Array.isArray(p._attachments) ? (p._attachments as Record<string, unknown>[]) : [];
  const want = bare(answer);
  const hit =
    list.find((a) => text(a.question_xpath) === question && !a.is_deleted) ??
    list.find((a) => [text(a.media_file_basename), text(a.filename)].some((n) => n && bare(n) === want) && !a.is_deleted);
  const url = hit ? text(hit.download_medium_url) || text(hit.download_large_url) || text(hit.download_url) : "";
  if (!hit || !url) return null;
  return { question, tag: koboPhotoTag(form, question), url, type: text(hit.mimetype) || "image/jpeg", name: (text(hit.media_file_basename) || bare(answer)).slice(0, 120) };
}

/** The original file's address for the same attachment: the EXIF data is only in the original, not in KoboToolbox's resized copies. */
export function koboOriginalUrl(p: Record<string, unknown> | null | undefined, question: string): string | null {
  const answer = text(p?.[question]);
  if (!p || !answer) return null;
  const list = Array.isArray(p._attachments) ? (p._attachments as Record<string, unknown>[]) : [];
  const want = bare(answer);
  const hit = list.find((a) => text(a.question_xpath) === question) ?? list.find((a) => [text(a.media_file_basename), text(a.filename)].some((n) => n && bare(n) === want));
  return hit ? text(hit.download_url) || null : null;
}

/** The image questions answered on a submission (its own top-level answers that name a file in `_attachments`). */
export function koboPhotos(p: Record<string, unknown> | null | undefined, form: string | null = null): KoboAttachment[] {
  if (!p) return [];
  return Object.keys(p)
    .filter((k) => !k.startsWith("_") && typeof p[k] === "string" && /\.(jpe?g|png|webp)$/i.test(p[k] as string))
    .map((k) => koboAttachment(p, k, form))
    .filter((a): a is KoboAttachment => !!a);
}
