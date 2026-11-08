import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";

/**
 * One route per indicator: an indicator mapped to a KoboToolbox question gets its results from
 * Kobo only, never by hand, so the same achievement cannot be counted twice.
 */
export const FROM_KOBO = "This indicator comes from Kobo";

/** Codes of a project's indicators that are fed by a Kobo question. */
export async function koboFedCodes(projectId: string): Promise<Set<string>> {
  const rows = await db
    .select({ code: s.indicators.code })
    .from(s.koboMappings)
    .innerJoin(s.indicators, eq(s.indicators.id, s.koboMappings.indicatorId))
    .where(eq(s.indicators.projectId, projectId));
  return new Set(rows.map((r) => r.code));
}

/** Per project code: indicators that take results recorded by hand (results-sourced, not fed by Kobo). */
export async function handRecordedCounts(): Promise<Map<string, number>> {
  const rows = await db
    .select({ code: s.projects.code, n: sql<number>`count(*)::int` })
    .from(s.indicators)
    .innerJoin(s.projects, eq(s.projects.id, s.indicators.projectId))
    .leftJoin(s.koboMappings, eq(s.koboMappings.indicatorId, s.indicators.id))
    .where(and(eq(s.indicators.source, "results"), isNull(s.koboMappings.id)))
    .groupBy(s.projects.code);
  return new Map(rows.map((r) => [r.code ?? "", r.n]));
}
