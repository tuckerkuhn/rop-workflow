import { and, asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { EMPTY_LEARNING, type Learning } from "@/lib/learning";
import { buildPeriodRows, periodRange, type Period, type PeriodIndicator } from "@/lib/period-report";
import { activityOf, photosFor, SECTIONS, type Row } from "@/lib/qpr";
import { projectByCode, donorNameOf } from "@/server/field-store";
import { donorPhotoRule } from "@/server/photo-consent";
import { loadProjectState } from "@/server/project-state";
import { rawQpr, spendFor } from "@/server/qpr-store";
import { loadResults, loadUpdates } from "@/server/results-store";

/**
 * The annual or final report: the indicator table for the period, each quarter's released
 * narrative gathered by section for the team to condense, lessons from the lessons record,
 * spending to the period's end, and the captioned photos.
 */
export async function periodReport(code: string, p: Period) {
  const project = await projectByCode(code);
  const rows = await db
    .select()
    .from(s.indicators)
    .where(and(eq(s.indicators.projectId, project.id), eq(s.indicators.source, "results"), eq(s.indicators.inQuarterlyReport, true)))
    .orderBy(asc(s.indicators.position));
  const indicators: PeriodIndicator[] = rows.map((r) => ({
    code: r.code,
    donorCode: r.donorCode,
    name: r.name,
    unit: r.unit,
    target: Number(r.target),
    yearTargets: Object.fromEntries(Object.entries((r.forecast as Record<string, number> | null) ?? {}).map(([k, v]) => [k, Number(v)])),
    result: r.result,
    disaggregation: r.disaggregation,
    budgetRef: r.budgetRef,
    baseline: r.baseline === null ? null : Number(r.baseline),
  }));
  const [results, updates, learning] = await Promise.all([loadResults(code), loadUpdates(code), loadProjectState<Learning>(project.id, "learning", EMPTY_LEARNING)]);
  const { from, to } = periodRange(p, project.startDate, project.endDate);
  const table = buildPeriodRows(indicators, results, p, project.startDate, project.endDate);

  // Quarters in the period that have started.
  const today = new Date().toISOString().slice(0, 10);
  const quarters: string[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++)
    for (let q = 1; q <= 4; q++) {
      const start = `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
      if (start >= from.slice(0, 7) + "-01" && start <= to && start <= today) quarters.push(`${y}-Q${q}`);
    }
  const reports = (await Promise.all(quarters.map(async (q) => [q, await rawQpr(project.id, q)] as const))).filter(([, r]) => !!r);
  const narrative = SECTIONS.map((sec) => ({
    key: sec.key,
    heading: sec.heading,
    parts: reports.map(([q, r]) => ({ quarter: q, released: !!r!.released, text: r!.sections[sec.key]?.text?.trim() ?? "" })).filter((x) => x.text),
  })).filter((x) => x.parts.length);
  const latest = reports.at(-1)?.[1] ?? null;

  const lines = await db
    .select({ code: s.budgetLines.code, amount: s.budgetLines.amount, spent: s.budgetLines.spent, currency: s.budgetLines.currency, updatedAt: s.budgetLines.updatedAt })
    .from(s.budgetLines)
    .where(eq(s.budgetLines.projectId, project.id));
  const lastQ = quarters.at(-1);
  const spend = lastQ ? await spendFor(code, lastQ, lines) : null;
  const pseudoRows = indicators.map((i) => ({ code: i.code, activity: activityOf(i.donorCode, i.code) })) as unknown as Row[];
  const photoOk = await donorPhotoRule(project.id);
  const photos = quarters.flatMap((q) => photosFor(pseudoRows, results, updates, q)).filter((ph) => photoOk(ph.hash).ok);
  const lessons = learning.lessons.filter((l) => l.date >= from && l.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const open = results.filter((r) => r.status !== "accepted" && r.date >= from && r.date <= to).length;
  return {
    project: { code, name: project.name, donor: await donorNameOf(project), start: project.startDate, end: project.endDate },
    period: p,
    range: { from, to },
    info: latest?.info ?? null,
    rows: table,
    narrative,
    quarters: reports.map(([q, r]) => ({ quarter: q, released: !!r!.released })),
    lessons,
    spend,
    photos,
    open,
    closed: learning.closed,
  };
}
export type PeriodReportView = Awaited<ReturnType<typeof periodReport>>;
