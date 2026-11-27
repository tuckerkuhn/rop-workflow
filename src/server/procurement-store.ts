import { and, eq } from "drizzle-orm";
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
 * Every document of a purchase is filed under its number, so a number is one of a kind across the
 * organization (review round 1, ISS-11: two projects each had a PR-2026-003). Each project numbers
 * its own requests, with the project's code in the number: PR-A2027-004 (Tucker, 27 Nov: numbering
 * per project). Numbers made before keep their old shape (PR-2027-009).
 */
export const projectTag = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const procurementIdOf = (code: string, n: number) => `PR-${projectTag(code)}-${String(n).padStart(3, "0")}`;
/** The next free number for the project, from the numbers it already uses. Pure. */
export function nextProcurementIdFrom(used: readonly string[], code: string): string {
  const shape = new RegExp(`^PR-${projectTag(code)}-(\\d+)$`);
  const taken = used.map((id) => id.match(shape)?.[1]).filter((x): x is string => !!x).map(Number);
  return procurementIdOf(code, Math.max(0, ...taken) + 1);
}
/** The purchase numbers used anywhere in the organization. */
export async function procurementIdsOfOrg(organizationId: string): Promise<{ id: string; projectId: string }[]> {
  const rows = await db.select({ id: s.procurements.procKey, projectId: s.procurements.projectId }).from(s.procurements).where(eq(s.procurements.organizationId, organizationId));
  return rows;
}
/** The next free purchase number for this project. */
export async function nextProcurementId(code: string): Promise<string> {
  const project = await projectByCode(code);
  const rows = await db.select({ id: s.procurements.procKey }).from(s.procurements).where(eq(s.procurements.projectId, project.id));
  return nextProcurementIdFrom(rows.map((r) => r.id), code);
}

/**
 * Takes the numbers of new requests by writing them first, so two people saving the same new
 * number at once never overwrite each other: the second is told the number is taken. Returns the
 * numbers that were already taken (nothing is written for those).
 */
export async function claimNewProcurements(code: string, items: Procurement[]): Promise<string[]> {
  if (!items.length) return [];
  const project = await projectByCode(code);
  const taken: string[] = [];
  for (const p of items) {
    const [row] = await db
      .insert(s.procurements)
      .values({ organizationId: project.organizationId, projectId: project.id, procKey: p.id, step: p.step, data: p })
      .onConflictDoNothing({ target: [s.procurements.projectId, s.procurements.procKey] })
      .returning({ id: s.procurements.procKey });
    if (!row) taken.push(p.id);
  }
  return taken;
}

/** Takes back numbers claimed by a save that did not go through. */
export async function releaseNewProcurements(code: string, ids: string[]) {
  if (!ids.length) return;
  const project = await projectByCode(code);
  for (const id of ids) await db.delete(s.procurements).where(and(eq(s.procurements.projectId, project.id), eq(s.procurements.procKey, id)));
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
