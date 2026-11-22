import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";

/** One JSON document per project and key in project_state. */
/** Anything that can run a select: the database, or an open transaction. */
export type Reader = Pick<typeof db, "select">;

export async function loadProjectState<T>(projectId: string, key: string, empty: T, q: Reader = db): Promise<T> {
  const [row] = await q
    .select()
    .from(s.projectState)
    .where(and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, key)))
    .limit(1);
  return row ? ({ ...empty, ...(row.data as object) } as T) : empty;
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Reads, changes and saves one document with its row locked, so two changes made at the same
 * moment both land (a plain load and save keeps only the second). `change` returns the new
 * document, or null to save nothing, and a result to pass back.
 */
export async function updateProjectState<T, R>(projectId: string, key: string, empty: T, change: (current: T, tx: Tx) => Promise<{ data: T | null; result: R }>): Promise<R> {
  return db.transaction(async (tx) => {
    // A row to lock: made here when the project has none yet, and taken away again if nothing is saved.
    const made = await tx.insert(s.projectState).values({ projectId, key, data: empty }).onConflictDoNothing().returning({ key: s.projectState.key });
    const where = and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, key));
    const [row] = await tx.select().from(s.projectState).where(where).for("update");
    const { data, result } = await change({ ...empty, ...(row?.data as object) } as T, tx);
    if (data) await tx.update(s.projectState).set({ data, updatedAt: new Date() }).where(where);
    else if (made.length) await tx.delete(s.projectState).where(where);
    return result;
  });
}

export async function saveProjectState(projectId: string, key: string, data: unknown) {
  await db
    .insert(s.projectState)
    .values({ projectId, key, data })
    .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data, updatedAt: new Date() } });
}
