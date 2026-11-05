import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { spentIn } from "@/lib/bva";
import { activityOf, buildRows, carryForward, checksFor, prevQuarterOf, type IndicatorInfo, type Qpr, type Spend } from "@/lib/qpr";
import { quarterRange } from "@/lib/results";
import { loadActuals } from "@/server/actuals-store";
import { projectByCode } from "@/server/field-store";
import { loadResults } from "@/server/results-store";

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
  const { current } = await loadActuals(code);
  const { from, to } = quarterRange(quarter);
  const [fm, tm] = [from.slice(0, 7), to.slice(0, 7)];
  if (!current) {
    return {
      currency: lines[0]?.currency ?? "USD",
      budget: Math.round(lines.reduce((t, l) => t + Number(l.amount ?? 0), 0)),
      cumulative: Math.round(lines.reduce((t, l) => t + Number(l.spent ?? 0), 0)),
      quarter: null,
      overhead: null,
      source: { kind: "budget", at: lines.map((l) => l.updatedAt.toISOString().slice(0, 10)).sort().at(-1) ?? null },
      missingMonths: [],
      byLine: Object.fromEntries(lines.map((l) => [l.code, { budget: Number(l.amount ?? 0), actual: Number(l.spent ?? 0), quarter: 0 }])),
    };
  }
  const toEnd = spentIn(current, "0000-00", tm);
  const inQ = spentIn(current, fm, tm);
  // A combined column (Jan-Feb) is filed under its last month, so a quarter counts as covered by its last month.
  const qMonths = [0, 1, 2].map((k) => `${quarter.slice(0, 4)}-${String(Number(fm.slice(5)) + k).padStart(2, "0")}`);
  const last = current.months.at(-1) ?? "";
  const missing = qMonths.filter((m) => m > last).map((m) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }));
  return {
    currency: current.currency,
    budget: Math.round(current.lines.reduce((t, l) => t + l.budget, 0)),
    cumulative: Math.round(toEnd.total),
    quarter: Math.round(inQ.total),
    overhead: current.totals.overhead,
    source: { kind: "import", file: current.file.name, sharepointUrl: current.file.sharepointUrl, by: current.by, at: current.at.slice(0, 10) },
    missingMonths: missing,
    byLine: Object.fromEntries(current.lines.map((l) => [l.code, { budget: l.budget, actual: toEnd.byLine[l.code] ?? 0, quarter: inQ.byLine[l.code] ?? 0 }])),
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
  const saved = await loadQpr(code, quarter);
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
    spend,
    activities,
    checks: checksFor(table, results, quarter, saved, spend, activityCodes),
  };
}
export type QprData = Awaited<ReturnType<typeof qprData>>;
