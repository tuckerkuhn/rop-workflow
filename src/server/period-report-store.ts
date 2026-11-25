import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { EMPTY_LEARNING, type Learning } from "@/lib/learning";
import { buildPeriodRows, PERIOD_COPIES, periodKey, periodRange, type Period, type PeriodIndicator } from "@/lib/period-report";
import { activityOf, photosFor, SECTIONS, type Qpr, type Row } from "@/lib/qpr";
import { projectByCode, donorNameOf } from "@/server/field-store";
import { donorPhotoRule } from "@/server/photo-consent";
import { loadProjectState, loadProjectStates, updateProjectState } from "@/server/project-state";
import { loadCopies, spendFor } from "@/server/qpr-store";
import { quarterRange } from "@/lib/results";
import { measured, RESULT_SOURCES } from "@/lib/measure";
import { measuresFor } from "@/server/measures";
import { loadResults, loadUpdates } from "@/server/results-store";

/**
 * The annual or final report: the indicator table for the period, each quarter's released
 * narrative gathered by section for the team to condense, lessons from the lessons record,
 * spending to the period's end, and the captioned photos.
 */
export async function periodReport(code: string, p: Period) {
  const project = await projectByCode(code);
  const { from, to } = periodRange(p, project.startDate, project.endDate);
  // Quarters in the period that have started.
  const today = new Date().toISOString().slice(0, 10);
  const quarters: string[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++)
    for (let q = 1; q <= 4; q++) {
      const start = `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
      if (start >= from.slice(0, 7) + "-01" && start <= to && start <= today) quarters.push(`${y}-Q${q}`);
    }
  // None of these depends on another: read together. Every quarter's saved report comes in one read.
  const [rows, results, updates, learning, saved, measureOf] = await Promise.all([
    db
      .select()
      .from(s.indicators)
      .where(and(eq(s.indicators.projectId, project.id), inArray(s.indicators.source, RESULT_SOURCES), eq(s.indicators.inQuarterlyReport, true)))
      .orderBy(asc(s.indicators.position)),
    loadResults(code),
    loadUpdates(code),
    loadProjectState<Learning>(project.id, "learning", EMPTY_LEARNING),
    loadProjectStates<Record<string, Qpr | null>>(project.id, Object.fromEntries(quarters.map((q) => [`qpr:${q}`, null]))),
    measuresFor(project.id),
  ]);
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
    // How results become its figure (lib/measure); left out for a target that adds up.
    ...(measureOf(r) !== "sum" ? { measure: measureOf(r) } : {}),
  }));
  const table = buildPeriodRows(indicators, results, p, project.startDate, project.endDate);

  const reports = quarters.map((q) => [q, saved[`qpr:${q}`]] as const).filter(([, r]) => !!r);
  const narrative = SECTIONS.map((sec) => ({
    key: sec.key,
    heading: sec.heading,
    parts: reports.map(([q, r]) => ({ quarter: q, released: !!r!.released, text: r!.sections[sec.key]?.text?.trim() ?? "" })).filter((x) => x.text),
  })).filter((x) => x.parts.length);
  const latest = reports.at(-1)?.[1] ?? null;

  const lastQ = quarters.at(-1);
  // Read together: the spending, the photo rule, the donor's name and each released quarter's frozen copy.
  const [spend, photoOk, donor, copies] = await Promise.all([
    lastQ
      ? db
          .select({ code: s.budgetLines.code, amount: s.budgetLines.amount, spent: s.budgetLines.spent, currency: s.budgetLines.currency, updatedAt: s.budgetLines.updatedAt })
          .from(s.budgetLines)
          .where(eq(s.budgetLines.projectId, project.id))
          .then((lines) => spendFor(code, lastQ, lines))
      : null,
    donorPhotoRule(project.id),
    donorNameOf(project),
    Promise.all(reports.map(async ([q, r]) => [q, r!.released ? (await loadCopies(code, q)).find((c) => c.kind === "release") : undefined] as const)),
  ]);
  const releaseCopy = new Map(copies);
  const pseudoRows = indicators.map((i) => ({ code: i.code, activity: activityOf(i.donorCode, i.code) })) as unknown as Row[];
  const photos = quarters.flatMap((q) => photosFor(pseudoRows, results, updates, q)).filter((ph) => photoOk(ph.hash).ok);
  const lessons = learning.lessons.filter((l) => l.date >= from && l.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const open = results.filter((r) => r.status !== "accepted" && r.date >= from && r.date <= to).length;
  // Figures the donor already has: each released quarter's frozen copy against the records now.
  // A record corrected after release changes the year's total, so the difference is named, not hidden.
  const changed: { code: string; donorCode: string; quarter: string; then: number; now: number }[] = [];
  for (const [q, r] of reports) {
    if (!r!.released) continue;
    const copy = releaseCopy.get(q);
    if (!copy) continue;
    // The days the copy counted: the agreement's own period when it is not a calendar quarter.
    const range = copy.data.period ?? quarterRange(q);
    for (const row of copy.data.rows) {
      const ind = indicators.find((i) => i.code === row.code);
      if (!ind) continue;
      const now = measured(ind, results.filter((x) => x.indicator === row.code), ind.measure, range.from, range.to).value;
      if (Math.abs(now - row.quarter) > 1e-9) changed.push({ code: row.code, donorCode: row.donorCode || row.code, quarter: q, then: row.quarter, now });
    }
  }
  return {
    project: { code, name: project.name, donor, start: project.startDate, end: project.endDate },
    period: p,
    range: { from, to },
    info: latest?.info ?? null,
    rows: table,
    narrative,
    quarters: reports.map(([q, r]) => ({ quarter: q, released: !!r!.released })),
    // Quarters of the period the project ran in that have started and have no saved report: their text is not in the narrative.
    missing: quarters.filter((q) => !saved[`qpr:${q}`] && (!project.startDate || quarterRange(q).to >= project.startDate) && (!project.endDate || quarterRange(q).from <= project.endDate)),
    lessons,
    spend,
    photos,
    open,
    changed,
    closed: learning.closed,
  };
}
export type PeriodReportView = Awaited<ReturnType<typeof periodReport>>;

// ---------- Release: a frozen copy for the donor ----------

/** What the donor received: the report as it stood when it was released, kept as it was. */
export type PeriodCopy = { by: string; at: string; data: PeriodReportView };
/** Every released annual or final report of a project, by period key ("year:2026" or "final"). */
export type PeriodCopies = { copies: Record<string, PeriodCopy> };

export const loadPeriodCopies = async (projectId: string) => (await loadProjectState<PeriodCopies>(projectId, PERIOD_COPIES, { copies: {} })).copies;

/** The released copy of one period, or null while it has not been released. */
export async function periodCopy(code: string, p: Period): Promise<PeriodCopy | null> {
  const project = await projectByCode(code);
  return (await loadPeriodCopies(project.id))[periodKey(p)] ?? null;
}

/**
 * Freezes the report as it stands now and keeps it as what the donor receives. Null when the
 * period was already released: a release is final, as a quarterly report's is. Who may release
 * and the audit entry are the caller's (the period-report route), as for the quarterly report.
 */
export async function releasePeriod(code: string, p: Period, by: string, at: string): Promise<PeriodCopy | null> {
  const project = await projectByCode(code);
  const data = await periodReport(code, p);
  return updateProjectState<PeriodCopies, PeriodCopy | null>(project.id, PERIOD_COPIES, { copies: {} }, async (cur) => {
    const key = periodKey(p);
    if (cur.copies[key]) return { data: null, result: null };
    const copy: PeriodCopy = { by, at, data };
    return { data: { copies: { ...cur.copies, [key]: copy } }, result: copy };
  });
}
