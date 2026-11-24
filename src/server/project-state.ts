import { and, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { oncePerRequest, requestWrote } from "@/server/request-memo";

/** One JSON document per project and key in project_state. */
/** Anything that can run a select: the database, or an open transaction. */
export type Reader = Pick<typeof db, "select">;

const memoKey = (projectId: string, key: string) => `state:${projectId}:${key}`;
/** A stored row's document, or null when the project has no row for the key. */
type Found = { data: unknown } | null;

/**
 * Read once per read-only request (server/request-memo) when read from the database: Home asks
 * for the same keys many times. Inside a transaction (`q` is the transaction) always afresh.
 */
function readRow(projectId: string, key: string, q: Reader): Promise<Found> {
  const read = async (): Promise<Found> => {
    const [row] = await q
      .select({ data: s.projectState.data })
      .from(s.projectState)
      .where(and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, key)))
      .limit(1);
    return row ? { data: row.data } : null;
  };
  return q === db ? oncePerRequest(memoKey(projectId, key), read) : read();
}

/** The stored document as it is, or null when there is none. */
export async function loadProjectStateRaw(projectId: string, key: string, q: Reader = db): Promise<unknown> {
  return (await readRow(projectId, key, q))?.data ?? null;
}

export async function loadProjectState<T>(projectId: string, key: string, empty: T, q: Reader = db): Promise<T> {
  const row = await readRow(projectId, key, q);
  return row ? ({ ...empty, ...(row.data as object) } as T) : empty;
}

/**
 * Several documents of one project in one round trip, each merged over its `empty` as
 * loadProjectState does. Each key read here is also kept for the request, as if read on its own.
 */
export async function loadProjectStates<T extends Record<string, unknown>>(projectId: string, empties: T, q: Reader = db): Promise<T> {
  const keys = Object.keys(empties);
  if (!keys.length) return { ...empties };
  const many = async () => {
    const rows = await q
      .select({ key: s.projectState.key, data: s.projectState.data })
      .from(s.projectState)
      .where(and(eq(s.projectState.projectId, projectId), inArray(s.projectState.key, keys)));
    return new Map(rows.map((r) => [r.key, r.data as unknown]));
  };
  let all: Promise<Map<string, unknown>> | undefined;
  const fromAll = (k: string) => async (): Promise<Found> => {
    all ??= many();
    const m = await all;
    return m.has(k) ? { data: m.get(k) } : null;
  };
  // Keys already kept for this request are not read again; the rest come from one query.
  const rows = await Promise.all(keys.map((k) => (q === db ? oncePerRequest(memoKey(projectId, k), fromAll(k)) : fromAll(k)())));
  return Object.fromEntries(keys.map((k, i) => [k, rows[i] ? { ...(empties[k] as object), ...(rows[i]!.data as object) } : empties[k]])) as T;
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
  }).finally(() => requestWrote());
}

export async function saveProjectState(projectId: string, key: string, data: unknown) {
  await db
    .insert(s.projectState)
    .values({ projectId, key, data })
    .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data, updatedAt: new Date() } });
  // Anything kept for this request (server/request-memo) may be older than this write.
  requestWrote();
}
