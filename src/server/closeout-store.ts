import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Closeouts } from "@/lib/closeout";
import { projectByCode } from "@/server/field-store";

/** Monthly closeout sign-offs, kept as one project_state document. */

export async function loadCloseouts(code: string): Promise<Closeouts> {
  const project = await projectByCode(code);
  const [row] = await db
    .select()
    .from(s.projectState)
    .where(and(eq(s.projectState.projectId, project.id), eq(s.projectState.key, "closeout")))
    .limit(1);
  return (row?.data as Closeouts | undefined) ?? {};
}

export async function saveCloseouts(code: string, data: Closeouts) {
  const project = await projectByCode(code);
  await db
    .insert(s.projectState)
    .values({ projectId: project.id, key: "closeout", data })
    .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data, updatedAt: new Date() } });
}
