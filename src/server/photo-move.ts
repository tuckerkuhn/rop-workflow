import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { FieldItem } from "@/lib/field";
import { keepPhoto, storeMode } from "@/server/file-store";

/**
 * Moves the proof photos already inside the records into file storage (Part 2 step 4), once file
 * storage is switched on. Each photo keeps its fingerprint, so the photo library, consent and the
 * audit trail, which all name a photo by fingerprint, are unchanged. Without `apply` it only counts
 * what would move. Run by an administrator: `npm run photos:move` (count), then with `--apply`.
 */
export async function movePhotos(apply: boolean) {
  if (apply && storeMode() !== "supabase") throw new Error("File storage is not switched on (PROOF_FILE_STORE=supabase), so there is nowhere to move the photos to.");
  const projects = new Map((await db.select({ id: s.projects.id, code: s.projects.code }).from(s.projects)).map((p) => [p.id, p.code]));
  const out = { farmerPhotos: 0, formPhotos: 0, bytes: 0, records: 0 };
  // A photo taken on a phone (JPEG, PNG or WebP); a drawn stand-in (the demo's SVG notes) stays where it is.
  const isData = (src: unknown): src is string => typeof src === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(src);

  for (const row of await db.select().from(s.fieldItems)) {
    const item = row.data as FieldItem;
    if (item.kind !== "farmer" || !item.photos?.some((p) => isData(p.src))) continue;
    const code = projects.get(row.projectId) ?? row.projectId;
    const photos = [];
    for (const p of item.photos) {
      if (!isData(p.src)) {
        photos.push(p);
        continue;
      }
      out.farmerPhotos++;
      out.bytes += p.src.length;
      photos.push(apply ? { ...p, src: (await keepPhoto(code, p.src)).src } : p);
    }
    out.records++;
    if (apply) await db.update(s.fieldItems).set({ data: { ...item, photos } }).where(eq(s.fieldItems.id, row.id));
  }

  for (const row of await db.select({ id: s.evidence.id, projectId: s.evidence.projectId, payload: s.evidence.payload }).from(s.evidence)) {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const kept = p._rop_photos as Record<string, { src: string; sha256: string }> | undefined;
    if (!kept || !Object.values(kept).some((x) => isData(x.src))) continue;
    const code = projects.get(row.projectId ?? "") ?? row.projectId ?? "";
    const next: Record<string, { src: string; sha256: string }> = {};
    for (const [q, x] of Object.entries(kept)) {
      if (isData(x.src)) {
        out.formPhotos++;
        out.bytes += x.src.length;
      }
      next[q] = apply && isData(x.src) ? await keepPhoto(code, x.src) : x;
    }
    out.records++;
    if (apply) await db.update(s.evidence).set({ payload: { ...p, _rop_photos: next } }).where(eq(s.evidence.id, row.id));
  }
  return { ...out, applied: apply };
}
