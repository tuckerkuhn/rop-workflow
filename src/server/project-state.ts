import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";

/** One JSON document per project and key in project_state. */
export async function loadProjectState<T>(projectId: string, key: string, empty: T): Promise<T> {
  const [row] = await db
    .select()
    .from(s.projectState)
    .where(and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, key)))
    .limit(1);
  return row ? ({ ...empty, ...(row.data as object) } as T) : empty;
}

export async function saveProjectState(projectId: string, key: string, data: unknown) {
  await db
    .insert(s.projectState)
    .values({ projectId, key, data })
    .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data, updatedAt: new Date() } });
}
