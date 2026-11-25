import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { coversActivity, type FieldRecords } from "@/lib/kobo-activities";
import { quarterOf, quarterRange } from "@/lib/results";
import { projectByCode } from "@/server/field-store";
import { koboActivityLinks } from "@/server/kobo-link";

/**
 * KoboCollect submissions as field evidence on the workplan activities their form records
 * (lib/kobo-activities). Read-only and counts only: no answer, farmer or enumerator leaves here.
 * A submission deleted in KoboToolbox is not counted.
 */

type LinkedForm = { uid: string; name: string; purpose: string; activities: string[] };

type Period = { from: string; to: string };

/** The project's linked forms with how many submissions each holds: in the period (first to last day) and in all. */
async function linkedCounts(code: string, { from, to }: Period): Promise<(LinkedForm & { quarter: number; total: number })[]> {
  const project = await projectByCode(code).catch(() => null);
  if (!project) return [];
  const links = await koboActivityLinks(project.id);
  const uids = Object.keys(links);
  if (!uids.length) return [];
  const end = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)) + 1)).toISOString();
  const when = sql`coalesce(${s.evidence.completedAt}, ${s.evidence.createdAt})`;
  const [forms, counts] = await Promise.all([
    db.select({ uid: s.koboForms.assetUid, name: s.koboForms.name, purpose: s.koboForms.purpose }).from(s.koboForms).where(and(eq(s.koboForms.projectId, project.id), inArray(s.koboForms.assetUid, uids))),
    db
      .select({
        uid: s.evidence.koboAssetUid,
        total: sql<number>`count(*)::int`,
        quarter: sql<number>`(count(*) filter (where ${when} >= ${`${from}T00:00:00.000Z`}::timestamptz and ${when} < ${end}::timestamptz))::int`,
      })
      .from(s.evidence)
      .where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.source, "kobo"), inArray(s.evidence.koboAssetUid, uids), isNull(s.evidence.koboRemovedAt)))
      .groupBy(s.evidence.koboAssetUid),
  ]);
  return forms.map((f) => {
    const c = counts.find((x) => x.uid === f.uid);
    return { ...f, activities: links[f.uid] ?? [], quarter: Number(c?.quarter ?? 0), total: Number(c?.total ?? 0) };
  });
}

/** For each workplan row, by its code: the linked forms that record it, with their counts this quarter (the one `today` is in). */
export async function fieldRecordsByActivity(code: string, rows: { code: string; activityCode?: string | null }[], today: string): Promise<Record<string, FieldRecords[]>> {
  const forms = await linkedCounts(code, quarterRange(quarterOf(today)));
  const out: Record<string, FieldRecords[]> = {};
  if (!forms.length) return out;
  for (const r of rows) {
    const mine = forms.filter((f) => f.activities.some((a) => coversActivity(a, r)));
    if (mine.length) out[r.code] = mine.map((f) => ({ form: f.uid, name: f.name, purpose: f.purpose, quarter: f.quarter, total: f.total }));
  }
  return out;
}

/**
 * For the quarterly report's facts: per report activity ("1.2.1"), how many submissions each
 * linked form holds in the report's period. A form linked to a sub-activity ("1.2.1.3") counts under its activity.
 */
export async function koboFieldFacts(code: string, period: Period, activities: string[]) {
  const forms = await linkedCounts(code, period).catch(() => []);
  const rows = activities.flatMap((a) =>
    forms.filter((f) => f.quarter > 0 && f.activities.some((l) => coversActivity(a, { code: l }))).map((f) => ({ activity: a, form: f.name, records_this_quarter: f.quarter })),
  );
  return rows.length ? { kobo_field_records_this_quarter: rows } : {};
}
