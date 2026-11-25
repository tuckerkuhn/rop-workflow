import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { savedObligationSchema, type SavedObligation } from "@/lib/obligations";
import { loadProjectStateRaw, saveProjectState, type Reader } from "@/server/project-state";

/**
 * The donors' reporting obligations confirmed from the agreement (lib/obligations), one
 * project_state document "obligations" per project: a list. An entry that no longer reads as an
 * obligation is left out rather than guessed at.
 */

export const OBLIGATIONS_KEY = "obligations";

export async function loadObligations(projectId: string, q: Reader = db): Promise<SavedObligation[]> {
  const raw = await loadProjectStateRaw(projectId, OBLIGATIONS_KEY, q);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const p = savedObligationSchema.safeParse(x);
    return p.success ? [p.data] : [];
  });
}

export const saveObligations = (projectId: string, list: SavedObligation[]) => saveProjectState(projectId, OBLIGATIONS_KEY, list);

/** The project's donors, first added first (setup adds the donor the documents name first). */
export const projectDonors = (projectId: string) => db.select({ id: s.donors.id, name: s.donors.name }).from(s.donors).where(eq(s.donors.projectId, projectId)).orderBy(asc(s.donors.createdAt));
