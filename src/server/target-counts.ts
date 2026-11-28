import { eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";

/**
 * Per project code: how many targets take results recorded in the app. (Before KoboToolbox was
 * removed on 28 Nov 2026, a target fed by a Kobo question was left out here: every target now takes
 * its results in the app.)
 */
export async function handRecordedCounts(): Promise<Map<string, number>> {
  const rows = await db
    .select({ code: s.projects.code, n: sql<number>`count(*)::int` })
    .from(s.indicators)
    .innerJoin(s.projects, eq(s.projects.id, s.indicators.projectId))
    .where(eq(s.indicators.source, "results"))
    .groupBy(s.projects.code);
  return new Map(rows.map((r) => [r.code ?? "", r.n]));
}
