import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { spentIn } from "@/lib/bva";
import { activityOf, breakdownsFor, buildRows, carryForward, checksFor, DEFAULT_ACRONYMS, photosFor, prevQuarterOf, type IndicatorInfo, type Qpr, type Spend } from "@/lib/qpr";
import { quarterRange } from "@/lib/results";
import { loadActuals } from "@/server/actuals-store";
import { projectByCode } from "@/server/field-store";
import { loadResults, loadUpdates } from "@/server/results-store";

/** One saved quarterly report per project and quarter, as project_state "qpr:2026-Q3". */

async function rawQpr(projectId: string, quarter: string) {
  const [row] = await db
    .select()
    .from(s.projectState)
    .where(and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, `qpr:${quarter}`)))
    .limit(1);
  return (row?.data as Qpr | undefined) ?? null;
}

export async function loadQpr(code: string, quarter: string): Promise<Qpr> {
  const project = await projectByCode(code);
  const saved = await rawQpr(project.id, quarter);
  if (saved) return saved;
  const prev = prevQuarterOf(quarter);
  return carryForward(await rawQpr(project.id, prev), project.name, prev);
}

export async function saveQpr(code: string, quarter: string, data: Qpr) {
  const project = await projectByCode(code);
  await db
    .insert(s.projectState)
    .values({ projectId: project.id, key: `qpr:${quarter}`, data })
    .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data, updatedAt: new Date() } });
}

type LineRow = { code: string; amount: string | null; spent: string | null; currency: string; updatedAt: Date };

/** The quarter's spending: from the latest budget-against-actual import, else the budget file's totals. */
async function spendFor(code: string, quarter: string, lines: LineRow[]): Promise<Spend> {
  const { imports } = await loadActuals(code);
  const { from, to } = quarterRange(quarter);
  const [fm, tm] = [from.slice(0, 7), to.slice(0, 7)];
  if (!imports.length) {
    return {
      currency: lines[0]?.currency ?? "USD",
      budget: Math.round(lines.reduce((t, l) => t + Number(l.amount ?? 0), 0)),
      cumulative: Math.round(lines.reduce((t, l) => t + Number(l.spent ?? 0), 0)),
      quarter: null,
      withOverhead: false,
      source: { kind: "budget", at: lines.map((l) => l.updatedAt.toISOString().slice(0, 10)).sort().at(-1) ?? null },
      phases: [],
      missingMonths: [],
      byLine: Object.fromEntries(lines.map((l) => [l.code, { budget: Number(l.amount ?? 0), actual: Number(l.spent ?? 0), quarter: 0 }])),
    };
  }
  const sumMonths = (m: Record<string, number>, a: string, b: string) => Object.entries(m).reduce((t, [k, v]) => (k >= a && k <= b ? t + v : t), 0);
  const grandOf = (i: (typeof imports)[number]) => i.totals.grand ?? { budget: i.lines.reduce((t, l) => t + l.budget, 0), actual: i.lines.reduce((t, l) => t + l.actual, 0), months: {} };
  const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const label = (m: string) => `${SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  // A combined first column ("Jan-Feb'26") starts the phase at its first month.
  const startOf = (i: (typeof imports)[number]) => {
    const m = (i.monthLabels[i.months[0]] ?? "").match(/^([A-Za-z]{3})[a-z]*\s*-/);
    const k = m ? SHORT.indexOf(m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase()) : -1;
    return k >= 0 ? `${SHORT[k]} ${i.months[0].slice(0, 4)}` : label(i.months[0]);
  };
  const period = (i: (typeof imports)[number]) => `${startOf(i)} – ${label(i.months.at(-1)!)}`;
  // Line detail comes from the phase the quarter falls in.
  const phase = [...imports].reverse().find((i) => (i.months[0] ?? "") <= tm) ?? imports.at(-1)!;
  const toEnd = spentIn(phase, "0000-00", tm);
  const inQ = spentIn(phase, fm, tm);
  const covered = new Set(imports.flatMap((i) => i.months));
  const last = [...covered].sort().at(-1) ?? "";
  // A combined column (Jan-Feb) is filed under its last month, so a quarter counts as covered by its last month.
  const qMonths = [0, 1, 2].map((k) => `${quarter.slice(0, 4)}-${String(Number(fm.slice(5)) + k).padStart(2, "0")}`);
  const missing = qMonths.filter((m) => m > last).map(label);
  const withOverhead = imports.every((i) => !!i.totals.grand);
  return {
    currency: phase.currency,
    budget: Math.round(imports.reduce((t, i) => t + grandOf(i).budget, 0)),
    // A phase whose last month is on or before the quarter's end counts at its stated total (the monthly cells can miss postings shown only in its totals).
    cumulative: Math.round(imports.reduce((t, i) => t + ((i.months.at(-1) ?? "") <= tm ? grandOf(i).actual : sumMonths(grandOf(i).months, "0000-00", tm)), 0)),
    quarter: Math.round(imports.reduce((t, i) => t + sumMonths(grandOf(i).months, fm, tm), 0)),
    withOverhead,
    source: { kind: "import", files: imports.map((i) => ({ name: i.file.name, sharepointUrl: i.file.sharepointUrl, by: i.by, at: i.at.slice(0, 10), period: period(i) })) },
    phases: imports.map((i) => ({ period: period(i), budget: Math.round(grandOf(i).budget), actual: Math.round(grandOf(i).actual) })),
    missingMonths: missing,
    byLine: Object.fromEntries(phase.lines.filter((l) => !l.currency).map((l) => [l.code, { budget: l.budget, actual: toEnd.byLine[l.code] ?? 0, quarter: inQ.byLine[l.code] ?? 0 }])),
  };
}

/** Everything the report shows for a quarter: figures from accepted results, saved text, and the checks. */
export async function qprData(code: string, quarter: string) {
  const project = await projectByCode(code);
  const rows = await db
    .select()
    .from(s.indicators)
    .where(and(eq(s.indicators.projectId, project.id), eq(s.indicators.source, "results")))
    .orderBy(asc(s.indicators.position));
  const indicators: IndicatorInfo[] = rows.map((r) => ({
    code: r.code,
    donorCode: r.donorCode,
    name: r.name,
    unit: r.unit,
    target: Number(r.target),
    yearTargets: Object.fromEntries(Object.entries((r.forecast as Record<string, number> | null) ?? {}).map(([k, v]) => [k, Number(v)])),
    result: r.result,
    disaggregation: r.disaggregation,
    budgetRef: r.budgetRef,
  }));
  const results = await loadResults(code);
  const updates = await loadUpdates(code);
  const saved = await loadQpr(code, quarter);
  saved.acronyms ??= DEFAULT_ACRONYMS;
  const table = buildRows(indicators, results, quarter, saved);
  const lines = await db
    .select({ code: s.budgetLines.code, amount: s.budgetLines.amount, spent: s.budgetLines.spent, currency: s.budgetLines.currency, activityCode: s.budgetLines.activityCode, activity: s.budgetLines.activity, updatedAt: s.budgetLines.updatedAt })
    .from(s.budgetLines)
    .where(eq(s.budgetLines.projectId, project.id));
  const spend = await spendFor(code, quarter, lines);
  const names = new Map<string, string>();
  for (const l of lines) if (l.activityCode && l.activity && !names.has(l.activityCode)) names.set(l.activityCode, l.activity);
  const wp = await db
    .selectDistinct({ code: s.workplanItems.activityCode, name: s.workplanItems.activity })
    .from(s.workplanItems)
    .where(and(eq(s.workplanItems.projectId, project.id), isNotNull(s.workplanItems.activityCode)));
  for (const w of wp) if (w.code && w.name && !names.has(w.code)) names.set(w.code, w.name);
  const activityCodes = [...new Set(indicators.map((i) => activityOf(i.donorCode, i.code)))];
  const activities = activityCodes.map((a) => ({ code: a, name: names.get(a) ?? `Activity ${a}` }));
  return {
    project: { code, name: project.name, goal: project.goal, donor: project.donor, start: project.startDate, end: project.endDate },
    quarter,
    saved,
    rows: table,
    results,
    updates: updates.filter((u) => u.date >= quarterRange(quarter).from && u.date <= quarterRange(quarter).to),
    photos: photosFor(table, results, updates, quarter),
    breakdowns: breakdownsFor(table, results, quarter),
    spend,
    activities,
    checks: checksFor(table, results, quarter, saved, spend, activityCodes),
  };
}
export type QprData = Awaited<ReturnType<typeof qprData>>;
