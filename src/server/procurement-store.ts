import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Procurement } from "@/lib/procurement";
import { projectByCode } from "@/server/field-store";

/** Procurements in Postgres, one `procurements` row each. */

export async function loadProcurements(code: string): Promise<Procurement[]> {
  const project = await projectByCode(code);
  const rows = await db.select().from(s.procurements).where(eq(s.procurements.projectId, project.id));
  // Newest first, as the workspace lists them.
  return rows.map((r) => r.data as Procurement).sort((a, b) => b.id.localeCompare(a.id));
}

/**
 * Every document of a purchase is filed under its number, so the number is one of a kind across
 * the organization, not only inside a project (review round 1, ISS-11: two projects each had a
 * PR-2026-003).
 */
export const procurementIdOf = (year: string, n: number) => `PR-${year}-${String(n).padStart(3, "0")}`;
/** The next free number for the year, from the given numbers already used. Pure. */
export function nextProcurementIdFrom(used: readonly string[], year: string): string {
  const taken = used.map((id) => id.match(new RegExp(`^PR-${year}-(\\d+)$`))?.[1]).filter((x): x is string => !!x).map(Number);
  return procurementIdOf(year, Math.max(0, ...taken) + 1);
}
/** The purchase numbers used anywhere in the organization. */
export async function procurementIdsOfOrg(organizationId: string): Promise<{ id: string; projectId: string }[]> {
  const rows = await db.select({ id: s.procurements.procKey, projectId: s.procurements.projectId }).from(s.procurements).where(eq(s.procurements.organizationId, organizationId));
  return rows;
}
/** The next free purchase number for the organization this project belongs to. */
export async function nextProcurementId(code: string, year: string): Promise<string> {
  const project = await projectByCode(code);
  return nextProcurementIdFrom((await procurementIdsOfOrg(project.organizationId)).map((r) => r.id), year);
}

/** Insert or replace the given procurements (only the ones that changed are sent). */
export async function saveProcurements(code: string, items: Procurement[]) {
  if (!items.length) return;
  const project = await projectByCode(code);
  for (const p of items) {
    await db
      .insert(s.procurements)
      .values({ organizationId: project.organizationId, projectId: project.id, procKey: p.id, step: p.step, data: p })
      .onConflictDoUpdate({ target: [s.procurements.projectId, s.procurements.procKey], set: { data: p, step: p.step, updatedAt: new Date() } });
  }
}
