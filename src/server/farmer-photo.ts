import { and, eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { today } from "@/lib/clock";
import type { AppUser } from "@/lib/demo";
import type { Farmer, Photo } from "@/lib/field";
import { stampHistory } from "@/lib/history";
import { FARMER_TAGS, filedAs, maySupplyProof, tagLabels, tagsFor, type FarmerTag } from "@/lib/kobo-photo";
import { onProject } from "@/server/auth";
import { mirrorFarmer } from "@/server/farmer-mirror";
import { projectByCode } from "@/server/field-store";
import { HttpError } from "@/server/guard";
import { keepPhoto } from "@/server/file-store";
import { requestWrote } from "@/server/request-memo";

/**
 * A photo added to a farmer's record by anyone who visits farmers: field staff, and also
 * management, communications or anyone else on the project who can open the farmer. A visitor's
 * photo is a picture of the work, not proof: it counts toward nothing and starts no approval.
 *
 * - Tags: everyone may use every tag except the signed distribution receipt. That photo lets a
 *   distribution be approved, so only the storekeeper and the extension agent may add it: whoever
 *   checks or approves must not be the one who supplies the proof.
 * - Every photo carries who added it. A visitor's is marked as such, so nobody later reads it as a
 *   field record.
 * - The day, time and place come from the photo itself (read before it was shrunk), or from the
 *   device with one tap. Nothing is typed.
 *
 * Added to the stored record in one locked step, so it cannot be lost to somebody else's save.
 */

export { FARMER_TAGS, maySupplyProof, tagsFor, type FarmerTag };

/** Records field activities on a project: holds a field role there (the same test the farmer page uses). */
export const recordsField = (u: AppUser) => u.kind === "employee" && u.field.length > 0;
/** May add a photo to a farmer here at all: staff on the project who can open Field activities. */
export const mayAddPhoto = (u: AppUser, code: string) => u.kind === "employee" && onProject(u, code) && (u.fieldAccess !== "none" || u.field.length > 0);
const filed = (tag: FarmerTag): Pick<Photo, "activity" | "signedNote"> => filedAs(tag);

export async function addFarmerPhoto(
  code: string,
  farmerId: string,
  by: AppUser,
  photo: { tag: FarmerTag; src: string; taken?: { date?: string | null; time?: string | null } | null; gps?: { lat: number; lon: number } | null },
): Promise<Photo> {
  if (!mayAddPhoto(by, code)) throw new HttpError(403, "Only staff on this project who can open Field activities can add a photo to a farmer.");
  if (!tagsFor(by).includes(photo.tag)) throw new HttpError(403, "The photo of the signed distribution receipt is added by the people who record the distribution, so that nobody who approves it also supplies its proof. Choose another tag, or ask the storekeeper to add it.");
  const project = await projectByCode(code);
  // Inside the record, or in file storage with its fingerprint (server/file-store).
  const kept = await keepPhoto(code, photo.src);
  const visitor = !recordsField(by);
  const day = photo.taken?.date && /^\d{4}-\d{2}-\d{2}$/.test(photo.taken.date) ? photo.taken.date : today();
  const entry: Photo = {
    id: `${farmerId}-${Date.now()}`,
    ...filed(photo.tag),
    tag: photo.tag,
    date: day,
    caption: `${tagLabels[photo.tag]} · ${farmerId}`,
    src: kept.src,
    ...(photo.taken?.date ? { taken: { date: photo.taken.date, time: photo.taken.time ?? null } } : {}),
    ...(photo.gps ? { gps: photo.gps } : {}),
    by: by.id,
    byName: by.name,
    ...(visitor ? { visitor: true } : {}),
  };
  await db.transaction(async (tx) => {
    // The row is locked while the photo is added, so a save by somebody else at the same moment waits.
    const [item] = await tx.select().from(s.fieldItems).where(and(eq(s.fieldItems.projectId, project.id), eq(s.fieldItems.itemKey, farmerId), eq(s.fieldItems.kind, "farmer"))).limit(1).for("update");
    if (!item) throw new HttpError(404, `${farmerId} has no record in Field activities on this project.`);
    const f = item.data as Farmer;
    if ((f.photos ?? []).length >= 200) throw new HttpError(409, `${farmerId} already holds 200 photos, the most a record keeps.`);
    const line = { date: today(), who: "system" as const, what: visitor ? `Photo added by ${by.name}, visiting: ${tagLabels[photo.tag]}` : `Photo added by ${by.name}: ${tagLabels[photo.tag]}` };
    const next: Farmer = { ...f, photos: [...(f.photos ?? []), entry], timeline: stampHistory(f.timeline, [...f.timeline, line] as Farmer["timeline"]) as Farmer["timeline"] };
    await tx.update(s.fieldItems).set({ data: next, updatedAt: sql`now()` }).where(eq(s.fieldItems.id, item.id));
    await mirrorFarmer(tx, project.id, next);
    await tx.insert(s.auditLog).values({ projectId: project.id, entity: "field", entityId: crypto.randomUUID(), action: "farmer_photo_added", detail: { by: by.id, farmer: farmerId, tag: photo.tag, visitor, taken: photo.taken?.date ?? null, hasPlace: !!photo.gps } });
  });
  requestWrote();
  return entry;
}
