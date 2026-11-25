import { ourWork } from "@/lib/budget";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { spentIn } from "@/lib/bva";
import { activityOf, breakdownsFor, buildRows, carryForward, checksFor, DEFAULT_ACRONYMS, grmLogFor, photosFor, prevQuarterOf, withLineReasons, type IndicatorInfo, type Qpr, type Spend } from "@/lib/qpr";
import { EMPTY_FEEDBACK, type FeedbackLog } from "@/lib/feedback";
import { EMPTY_LEARNING, lessonsInQuarter, type Learning } from "@/lib/learning";
import { today as clockToday } from "@/lib/clock";
import { quarterRange } from "@/lib/results";
import { loadActuals } from "@/server/actuals-store";
import { donorPhotoRule } from "@/server/photo-consent";
import { projectByCode, donorNameOf, goalOf } from "@/server/field-store";
import { loadResults, loadUpdates } from "@/server/results-store";
import { MAX_PRACTICE, workTime, type CopyData, type ReportCopy, type WorkTime } from "@/lib/report-copy";
import { auditTrail } from "@/server/audit";
import { loadProjectState, loadProjectStateRaw, updateProjectState } from "@/server/project-state";
import { loadLineReasons } from "@/server/overspend-store";
import { ledgerSpent, spentBetween, type LedgerSpent } from "@/server/ledger-spent";
import { early } from "@/server/early";
import { RESULT_SOURCES } from "@/lib/measure";
import { measuresFor } from "@/server/measures";
import { oncePerRequest, requestWrote } from "@/server/request-memo";
import { qprKeyHolding, qprPeriod, qprPeriodList, quarterlyObligation, type QprPeriod } from "@/lib/obligations";
import { loadObligations } from "@/server/obligations-store";

/** One saved quarterly report per project and quarter, as project_state "qpr:2026-Q3". */

/**
 * The quarterly report's schedule: the obligation it follows (lib/obligations quarterlyObligation)
 * and the project's dates. With no obligations saved, the report keeps to calendar quarters.
 */
async function qprSchedule(code: string) {
  return oncePerRequest(`qpr-schedule:${code}`, async () => {
    const project = await projectByCode(code);
    return { o: quarterlyObligation(await loadObligations(project.id)), start: project.startDate ?? null, end: project.endDate ?? null };
  });
}

/** The days a quarter key's report counts, with its name and label (lib/obligations qprPeriod). */
export async function qprPeriodFor(code: string, quarter: string): Promise<QprPeriod> {
  const { o, start, end } = await qprSchedule(code);
  return qprPeriod(quarter, o, start, end);
}

/** The report's periods to choose from, newest first; null when they are calendar quarters. */
export async function qprPeriodsFor(code: string, today = new Date().toISOString().slice(0, 10)): Promise<QprPeriod[] | null> {
  const { o, start, end } = await qprSchedule(code);
  return qprPeriodList(o, start, end, today);
}

/** The quarter key of the report period holding a day. */
export async function qprKeyFor(code: string, day: string): Promise<string> {
  return qprKeyHolding((await qprSchedule(code)).o, day);
}

export async function rawQpr(projectId: string, quarter: string) {
  // Kept once per read-only request with every other project_state read (server/project-state).
  return ((await loadProjectStateRaw(projectId, `qpr:${quarter}`)) as Qpr | null) ?? null;
}

/**
 * Whether each quarter's report was released (its `released` stamp, or null), without loading
 * each whole report: one query for all the quarters. A quarter with no saved report is null.
 */
export async function rawQprReleased(projectId: string, quarters: string[]): Promise<Map<string, Qpr["released"] | null>> {
  if (!quarters.length) return new Map();
  const rows = await db
    .select({ key: s.projectState.key, released: sql<Qpr["released"] | null>`${s.projectState.data} -> 'released'` })
    .from(s.projectState)
    .where(and(eq(s.projectState.projectId, projectId), inArray(s.projectState.key, quarters.map((q) => `qpr:${q}`))));
  const by = new Map(rows.map((r) => [r.key.slice("qpr:".length), r.released ?? null]));
  return new Map(quarters.map((q) => [q, by.get(q) ?? null]));
}

export async function loadQpr(code: string, quarter: string): Promise<Qpr> {
  const project = await projectByCode(code);
  const prev = prevQuarterOf(quarter);
  // Read together: the quarter's own report, the one before (carried forward when this one is not
  // saved yet) and the lines' reasons (for a report not yet released).
  const [own, before, reasons] = await Promise.all([rawQpr(project.id, quarter), rawQpr(project.id, prev), loadLineReasons(project.id)]);
  const saved = own ?? carryForward(before, project.name, prev);
  // Each line's reason for being over budget lives on the line; a released report keeps its own.
  return saved.released ? saved : withLineReasons(saved, reasons);
}

export async function saveQpr(code: string, quarter: string, data: Qpr) {
  const project = await projectByCode(code);
  await db
    .insert(s.projectState)
    .values({ projectId: project.id, key: `qpr:${quarter}`, data })
    .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data, updatedAt: new Date() } });
  requestWrote();
}

type LineRow = { code: string; amount: string | null; spent: string | null; currency: string; updatedAt: Date };

/**
 * The quarter's spending: from the latest budget-against-actual import, else the budget file's totals.
 * When the project has posted spending in the grant ledger, each line's spending (to the quarter's
 * end and in the quarter) comes from the ledger instead (server/ledger-spent); the import still gives
 * the approved budget, its phases, the months still missing and any overhead on top of the lines.
 */
export async function spendFor(code: string, quarter: string, lines: LineRow[], range: { from: string; to: string } = quarterRange(quarter)): Promise<Spend> {
  const [{ imports }, ledger] = await Promise.all([loadActuals(code), projectByCode(code).then((p) => ledgerSpent(p.id))]);
  const { from, to } = range;
  const [fm, tm] = [from.slice(0, 7), to.slice(0, 7)];
  if (!imports.length) {
    if (ledger) return fromLedger(ledger, lines, fm, tm, { budget: Math.round(lines.reduce((t, l) => t + Number(l.amount ?? 0), 0)), overheadToEnd: 0, overheadInQuarter: 0, budgets: {} });
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
  const qMonths = monthsFrom(fm, tm);
  // Only a month that is over can be in Finance's workbook: the current and later months are not missing yet.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const missing = qMonths.filter((m) => m > last && m < thisMonth).map(label);
  const withOverhead = imports.every((i) => !!i.totals.grand);
  if (ledger) {
    // What the import counts on top of its lines (overhead): its grand totals less its line totals.
    const toEndOf = (i: (typeof imports)[number], x: { actual: number; months: Record<string, number> }) => ((i.months.at(-1) ?? "") <= tm ? x.actual : sumMonths(x.months, "0000-00", tm));
    const overOf = (i: (typeof imports)[number]) => (i.totals.grand && i.totals.costs ? { toEnd: toEndOf(i, i.totals.grand) - toEndOf(i, i.totals.costs), inQ: sumMonths(i.totals.grand.months, fm, tm) - sumMonths(i.totals.costs.months, fm, tm) } : { toEnd: 0, inQ: 0 });
    const base = fromLedger(ledger, lines, fm, tm, {
      budget: Math.round(imports.reduce((t, i) => t + grandOf(i).budget, 0)),
      overheadToEnd: imports.reduce((t, i) => t + overOf(i).toEnd, 0),
      overheadInQuarter: imports.reduce((t, i) => t + overOf(i).inQ, 0),
      budgets: Object.fromEntries(phase.lines.filter((l) => !l.currency).map((l) => [l.code, l.budget])),
    });
    return {
      ...base,
      currency: phase.currency,
      withOverhead,
      source: { kind: "import", files: imports.map((i) => ({ name: i.file.name, sharepointUrl: i.file.sharepointUrl, by: i.by, at: i.at.slice(0, 10), period: period(i) })) },
      phases: imports.map((i) => ({ period: period(i), budget: Math.round(grandOf(i).budget), actual: Math.round(grandOf(i).actual) })),
      missingMonths: missing,
    };
  }
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

/** Every month from one to another, as "2026-11", across a year's end. */
function monthsFrom(a: string, b: string) {
  const out: string[] = [];
  for (let y = Number(a.slice(0, 4)), m = Number(a.slice(5, 7)); `${y}-${String(m).padStart(2, "0")}` <= b && out.length < 24; m === 12 ? (y++, (m = 1)) : m++) out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out;
}

/**
 * The quarter's spending from the ledger: per budget line, spent to the end of the quarter and in
 * it, in the line's currency; the totals are the lines plus any overhead the import counts on top.
 * `budgets`: the approved budget per line from the import; a line without one shows its budget line's amount.
 */
function fromLedger(ledger: LedgerSpent, lines: LineRow[], fm: string, tm: string, extra: { budget: number; overheadToEnd: number; overheadInQuarter: number; budgets: Record<string, number> }): Spend {
  const codes = [...new Set([...Object.keys(extra.budgets), ...lines.map((l) => l.code)])];
  const amount = new Map(lines.map((l) => [l.code, Number(l.amount ?? 0)]));
  const byLine = Object.fromEntries(
    codes
      .filter((c) => c in extra.budgets || ledger.byCode[c] !== undefined)
      .map((c) => [c, { budget: extra.budgets[c] ?? amount.get(c) ?? 0, actual: spentBetween(ledger.monthsByCode[c], "0000-00", tm), quarter: spentBetween(ledger.monthsByCode[c], fm, tm) }]),
  );
  const sum = (k: "actual" | "quarter") => Object.values(byLine).reduce((t, l) => t + l[k], 0);
  return {
    currency: lines[0]?.currency ?? "USD",
    budget: extra.budget,
    cumulative: Math.round(sum("actual") + extra.overheadToEnd),
    quarter: Math.round(sum("quarter") + extra.overheadInQuarter),
    withOverhead: false,
    source: { kind: "budget", at: lines.map((l) => l.updatedAt.toISOString().slice(0, 10)).sort().at(-1) ?? null },
    phases: [],
    missingMonths: [],
    byLine,
  };
}

/** Everything the report shows for a quarter: figures from accepted results, saved text, and the checks. */
export function qprData(code: string, quarter: string) {
  // Built once per read-only request (server/request-memo): the monthly review, the report check and the summary each ask for the same quarter.
  return oncePerRequest(`qpr-data:${code}:${quarter}`, () => readQprData(code, quarter));
}

async function readQprData(code: string, quarter: string) {
  const project = await projectByCode(code);
  // The days the report counts: the calendar quarter, or the agreement's own period (lib/obligations qprPeriod).
  const period = await qprPeriodFor(code, quarter);
  const range = { from: period.from, to: period.to, ...(period.calendar ? {} : { label: period.label }) };
  // Started together and awaited below where each is used: none depends on another.
  const resultsLater = early(loadResults(code));
  const updatesLater = early(loadUpdates(code));
  const savedLater = early(loadQpr(code, quarter));
  const photoRuleLater = early(donorPhotoRule(project.id));
  const feedbackLater = early(loadProjectState<FeedbackLog>(project.id, "feedback", EMPTY_FEEDBACK).catch(() => EMPTY_FEEDBACK));
  // The lessons record (Lessons and close-out): the quarter's lessons go into the Lessons Learned section, not typed again.
  const learningLater = early(loadProjectState<Learning>(project.id, "learning", EMPTY_LEARNING).catch(() => EMPTY_LEARNING));
  const measureLater = early(measuresFor(project.id));
  const planLater = early(db.select({ code: s.workplanItems.code, org: s.workplanItems.org, active: s.workplanItems.active }).from(s.workplanItems).where(eq(s.workplanItems.projectId, project.id)));
  const linesLater = early(
    db
      .select({ code: s.budgetLines.code, amount: s.budgetLines.amount, spent: s.budgetLines.spent, currency: s.budgetLines.currency, activityCode: s.budgetLines.activityCode, activity: s.budgetLines.activity, updatedAt: s.budgetLines.updatedAt })
      .from(s.budgetLines)
      .where(eq(s.budgetLines.projectId, project.id)),
  );
  const wpLater = early(db.selectDistinct({ code: s.workplanItems.activityCode, name: s.workplanItems.activity }).from(s.workplanItems).where(and(eq(s.workplanItems.projectId, project.id), isNotNull(s.workplanItems.activityCode))));
  const rows = await db
    .select()
    .from(s.indicators)
    .where(and(eq(s.indicators.projectId, project.id), inArray(s.indicators.source, RESULT_SOURCES), eq(s.indicators.inQuarterlyReport, true)))
    .orderBy(asc(s.indicators.position));
  const measureOf = await measureLater;
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
    workplanCode: r.workplanCode,
    // How results become its figure (lib/measure); only a target that does not add up carries it, so the rows of one that does stay as they were.
    ...(measureOf(r) !== "sum" ? { measure: measureOf(r), baseline: r.baseline === null ? null : Number(r.baseline) } : {}),
  }));
  const results = await resultsLater;
  const updates = await updatesLater;
  const saved = await savedLater;
  saved.acronyms ??= DEFAULT_ACRONYMS;
  // When each activity is planned. A consortium workplan lists every partner; this report is ROP's.
  const plan = await planLater;
  const ours = ourWork(plan);
  const plans: Record<string, string[]> = {};
  for (const w of ours) plans[w.code] = [...new Set([...(plans[w.code] ?? []), ...((w.active as string[]) ?? [])])];
  const table = buildRows(indicators, results, quarter, saved, plans, range);
  const lines = await linesLater;
  const spend = await spendFor(code, quarter, lines, range);
  const names = new Map<string, string>();
  for (const l of lines) if (l.activityCode && l.activity && !names.has(l.activityCode)) names.set(l.activityCode, l.activity);
  const wp = await wpLater;
  for (const w of wp) if (w.code && w.name && !names.has(w.code)) names.set(w.code, w.name);
  const activityCodes = [...new Set(indicators.map((i) => activityOf(i.donorCode, i.code)))];
  const activities = activityCodes.map((a) => ({ code: a, name: names.get(a) ?? `Activity ${a}` }));
  // Photos go to the donor only as far as the photo library's consent rule allows (server/photo-consent).
  const photoOk = await photoRuleLater;
  const captioned = photosFor(table, results, updates, quarter, range);
  const photos = captioned.filter((ph) => photoOk(ph.hash).ok);
  // The feedback log's count for this quarter: the report's complaints figures unless someone typed others.
  // A quarter before the log was started gets none, so the check keeps asking for typed figures.
  const log = await feedbackLater;
  const { from: qFrom, to: qTo } = range;
  const grmLog = grmLogFor(log.entries, qFrom, qTo, clockToday());
  return {
    project: { code, name: project.name, goal: await goalOf(project), donor: await donorNameOf(project), start: project.startDate, end: project.endDate },
    quarter,
    period,
    saved,
    rows: table,
    results,
    updates: updates.filter((u) => u.date >= qFrom && u.date <= qTo),
    photos,
    /** Captioned photos held back until they are checked for people who can be recognised, or consent covers them. */
    photosHeld: captioned.length - photos.length,
    breakdowns: breakdownsFor(table, results, quarter, range),
    spend,
    activities,
    grmLog,
    /** Lessons recorded in the quarter, from the lessons record. */
    lessons: lessonsInQuarter((await learningLater).lessons, quarter, range),
    checks: checksFor(table, results, quarter, saved, spend, activityCodes, grmLog, range),
  };
}
export type QprData = Awaited<ReturnType<typeof qprData>>;

// ---------- Frozen copies and time spent (lib/report-copy) ----------

/** The report as it stands, reduced to what a frozen copy keeps. */
export function copyOf(d: QprData): CopyData {
  const { from, to } = d.period;
  // This year to the period's end; a period that starts in the year before counts from its own start.
  const yearStart = [`${d.quarter.slice(0, 4)}-01-01`, from].sort()[0];
  return {
    project: d.project,
    quarter: d.quarter,
    // Only an agreement period that is not a calendar quarter is kept with the copy: the dates it counted.
    ...(d.period.calendar ? {} : { period: d.period }),
    saved: d.saved,
    rows: d.rows,
    photos: d.photos,
    breakdowns: d.breakdowns,
    spend: d.spend,
    activities: d.activities,
    checks: d.checks,
    grmLog: d.grmLog,
    counted: d.results.filter((r) => r.status === "accepted" && r.date >= yearStart && r.date <= to).map((r) => ({ id: r.id, indicator: r.indicator, date: r.date, value: r.value })),
  };
}

const copiesKey = (quarter: string) => `qpr-copies:${quarter}`;

export async function loadCopies(code: string, quarter: string): Promise<ReportCopy[]> {
  const project = await projectByCode(code);
  return (await loadProjectState<{ copies: ReportCopy[] }>(project.id, copiesKey(quarter), { copies: [] })).copies;
}

/** Keeps the release copy and the latest practice copies. */
export async function addCopy(code: string, quarter: string, copy: ReportCopy) {
  const project = await projectByCode(code);
  await updateProjectState<{ copies: ReportCopy[] }, null>(project.id, copiesKey(quarter), { copies: [] }, async (cur) => {
    const list = [...cur.copies, copy];
    const practice = list.filter((c) => c.kind === "practice").slice(-MAX_PRACTICE);
    // One release copy: a release that did not complete is replaced by the next.
    const release = list.filter((c) => c.kind === "release").slice(-1);
    return { data: { copies: [...release, ...practice] }, result: null };
  });
}

/** Time spent writing the report, from the times of its edits in the audit trail. */
export async function reportWork(code: string, quarter: string, until?: string): Promise<WorkTime> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await auditTrail(code, (await qprPeriodFor(code, quarter)).from, today);
  return workTime(rows.filter((r) => r.entity === "qpr" && r.detail.quarter === quarter && r.action !== "qpr_practice" && (!until || r.at <= until)).map((r) => r.at));
}
