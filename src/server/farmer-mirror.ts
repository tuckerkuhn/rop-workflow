import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Farmer, FieldItem } from "@/lib/field";

/**
 * One source for a farmer's details.
 *
 * A farmer is kept in two places: the working record in `field_items` (the step they are at, their
 * village, contribution, checks, photos) and a row in `farmers` (the ID that names, plots and
 * readiness checks hang from, and what the KoboCollect farmer list is built on). Village, status,
 * contribution and enrollment date were in both and only the working record was kept up to date.
 *
 * The rule now: the working record is the source. Every save of it writes the same details to the
 * `farmers` row in the same step (mirrorFarmer), so the two cannot drift again. Nothing reads those
 * details from `farmers` ahead of the working record. Rows that drifted before this are put right
 * the next time that farmer is saved, or all at once with `npm run farmers:sync`.
 */

type Writer = Pick<typeof db, "update">;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** What the `farmers` row should say, from the working record. */
export function mirrorOf(f: Farmer) {
  const removed = f.step === "removed";
  const last = f.timeline?.at(-1)?.date;
  return {
    village: f.community || null,
    contributionPaid: !!f.contributionPaid,
    ...(isDate(f.enrolledOn) ? { enrolledOn: f.enrolledOn } : {}),
    ...(removed ? { status: "removed" as const, ...(isDate(last) ? { removedOn: last } : {}) } : f.enrolled ? { status: "enrolled" as const, removedOn: null } : {}),
  };
}

/** Writes a farmer's details from the working record to their `farmers` row. A finding, or a farmer with no row, is left alone. */
export async function mirrorFarmer(q: Writer, projectId: string, item: FieldItem | Farmer) {
  if (item.kind !== "farmer") return;
  await q
    .update(s.farmers)
    .set({ ...mirrorOf(item), updatedAt: new Date() })
    .where(and(eq(s.farmers.projectId, projectId), eq(s.farmers.code, item.id)));
}

/**
 * Farmers whose `farmers` row no longer matches their working record, by project; with `apply`,
 * puts them right. Used by `npm run farmers:sync`.
 */
export async function farmerDrift(apply = false) {
  const rows = await db.select().from(s.farmers);
  const items = await db.select().from(s.fieldItems).where(eq(s.fieldItems.kind, "farmer"));
  const byKey = new Map(items.map((i) => [`${i.projectId}:${i.itemKey}`, i.data as Farmer]));
  const out: { code: string; changes: string[] }[] = [];
  for (const r of rows) {
    const f = byKey.get(`${r.projectId}:${r.code}`);
    if (!f) continue;
    const want = mirrorOf(f) as Record<string, unknown>;
    const have = r as unknown as Record<string, unknown>;
    const changes = Object.keys(want)
      .filter((k) => (want[k] ?? null) !== (have[k] ?? null))
      .map((k) => `${k}: ${String(have[k] ?? "empty")} to ${String(want[k] ?? "empty")}`);
    if (!changes.length) continue;
    out.push({ code: r.code, changes });
    if (apply) await mirrorFarmer(db, r.projectId, f);
  }
  return out;
}
