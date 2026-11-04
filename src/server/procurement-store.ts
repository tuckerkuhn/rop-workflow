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
