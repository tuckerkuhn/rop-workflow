import { MEASURES_KEY, measureOf, type Measure } from "@/lib/measure";
import { loadProjectStateRaw, type Reader } from "@/server/project-state";

/** Each target's measure (lib/measure), from the project's "measures" document. No document: every target uses its default. */
export async function loadMeasures(projectId: string, q?: Reader): Promise<Record<string, unknown>> {
  const doc = await loadProjectStateRaw(projectId, MEASURES_KEY, q);
  return doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};
}

/** A function from an indicator row to its measure, for a project. */
export async function measuresFor(projectId: string, q?: Reader): Promise<(i: { code: string; source?: string | null; unit: string }) => Measure> {
  const doc = await loadMeasures(projectId, q);
  return (i) => measureOf(doc, i);
}
