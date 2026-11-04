import { and, asc, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { TODAY, projects as demoProjects, type AppUser } from "@/lib/demo";
import { actualFor, indicators as demoIndicators, results as demoResults, type Indicator, type Submission } from "@/lib/project";
import { BUILT_IN_SOURCES, forecastFor, periodOf, projectYears, reportPeriod, trackFor, type DonorInfo, type ForecastYear, type DonorInput, type IndicatorProgress, type Level, type ProgressData, type ReportValues } from "@/lib/progress";
import { FORMATS } from "@/lib/report-formats";
import { listSubmissions } from "@/server/kobo";
import { mappedInputs, mappedValue } from "@/server/kobo-link";

/** Indicators with their values, and donors with their report deadlines, in Postgres. */

type IndicatorRow = typeof s.indicators.$inferSelect;

async function projectOrNull(code: string) {
  const [p] = await db.select().from(s.projects).where(eq(s.projects.code, code)).limit(1);
  return p ?? null;
}

/** The shape the existing value rules (actualFor) expect. */
const asIndicator = (r: IndicatorRow): Indicator => ({
  id: r.code,
  result: r.result ?? "",
  name: r.name,
  unit: r.unit,
  target: Number(r.target),
  source: r.source as Indicator["source"],
  match: r.filter ? (sub) => sub.fields[r.filter!.field] === r.filter!.equals : undefined,
  frequency: r.frequency,
  donorRef: "",
});

type Mapped = Awaited<ReturnType<typeof mappedInputs>> extends Map<string, infer V> ? V : never;

const base = (r: IndicatorRow) => ({
  code: r.code,
  name: r.name,
  unit: r.unit,
  target: Number(r.target),
  level: r.level,
  result: r.result,
  source: r.source,
  frequency: r.frequency,
  theme: r.theme,
});

type Dates = { start: string | null; end: string | null };

/**
 * Forecast against actual for each project year, and where the indicator stands today.
 * `asOf(date)` is the indicator's value from everything dated up to that day.
 */
function forecastOf(r: IndicatorRow, dates: Dates, total: number | null, asOf: (date: string) => number | null): { forecast: ForecastYear[]; track: IndicatorProgress["track"] } {
  const years = projectYears(dates.start, dates.end);
  const plan = forecastFor(r.forecast, Number(r.target), years);
  const now = Number(TODAY.slice(0, 4));
  const forecast = years.map((year) => ({ year, forecast: plan.get(year) ?? null, actual: year < now ? asOf(`${year}-12-31`) : year === now ? total : null }));
  const track = dates.start ? trackFor({ forecast: plan, actual: total, today: TODAY, start: dates.start, once: r.frequency === "end_of_season" }) : null;
  return { forecast, track };
}

/** Counted from a mapped KoboToolbox question. */
function fromMapping(r: IndicatorRow, m: Mapped, dates: Dates): IndicatorProgress {
  const all = mappedValue(m.mapping, m.counted);
  const p = periodOf(r.frequency, TODAY);
  const inPeriod = p ? mappedValue(m.mapping, m.counted.filter((x) => x.date >= p.from && x.date <= p.to)) : null;
  const asOf = (d: string) => mappedValue(m.mapping, m.counted.filter((x) => x.date <= d)).value;
  return { ...base(r), total: all.value, period: inPeriod?.value ?? null, pending: m.waiting, byGender: null, lastDate: all.dates.sort().at(-1) ?? null, dataSource: "kobo", ...forecastOf(r, dates, all.value, asOf) };
}

function withValues(r: IndicatorRow, subs: Submission[], span: Dates, mapped?: Mapped): IndicatorProgress {
  if (mapped) return fromMapping(r, mapped, span);
  // Added in setup and not mapped to a question yet: nothing to count.
  if (!BUILT_IN_SOURCES.includes(r.source)) return { ...base(r), total: null, period: null, pending: 0, byGender: null, lastDate: null, dataSource: "none", ...forecastOf(r, span, null, () => null) };
  const ind = asIndicator(r);
  const all = actualFor(ind, subs);
  const p = periodOf(r.frequency, TODAY);
  const inPeriod = p ? actualFor(ind, subs.filter((x) => x.date >= p.from && x.date <= p.to)).value : null;
  const dates = all.evidence.map((e) => e.date).sort();
  const asOf = (d: string) => actualFor(ind, subs.filter((x) => x.date <= d)).value;
  return {
    ...base(r),
    total: all.value,
    period: inPeriod,
    pending: all.pending,
    byGender: r.source === "survey" ? null : all.byGender,
    lastDate: dates.at(-1) ?? null,
    dataSource: r.source === "survey" ? "survey" : "records",
    ...forecastOf(r, span, all.value, asOf),
  };
}

async function donorsOf(projectId: string): Promise<DonorInfo[]> {
  const rows = await db.select().from(s.donors).where(eq(s.donors.projectId, projectId)).orderBy(asc(s.donors.createdAt));
  if (!rows.length) return [];
  const deadlines = await db
    .select()
    .from(s.workItems)
    .where(and(inArray(s.workItems.donorId, rows.map((d) => d.id)), eq(s.workItems.milestoneKind, "report_deadline")))
    .orderBy(asc(s.workItems.date));
  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    reportFormat: d.reportFormat,
    indicatorRefs: d.indicatorRefs,
    deadlines: deadlines.filter((w) => w.donorId === d.id).map((w) => ({ id: w.id, title: w.title, date: w.date! })),
  }));
}

/** A donor's own staff see only their organization's donor entry. */
const visibleDonors = (all: DonorInfo[], user: AppUser) => (user.kind === "donor" ? all.filter((d) => d.name === user.org) : all);

export async function listDonors(code: string, user: AppUser) {
  const project = await projectOrNull(code);
  return project ? visibleDonors(await donorsOf(project.id), user) : [];
}

export async function loadProgress(code: string, user: AppUser): Promise<ProgressData> {
  const project = await projectOrNull(code);
  const demo = demoProjects.find((p) => p.id === code);
  if (!project) return { saved: false, project: { code, name: demo?.name ?? code, startDate: null, endDate: null }, today: TODAY, indicators: [], donors: [], reports: [] };
  const rows = await db.select().from(s.indicators).where(eq(s.indicators.projectId, project.id)).orderBy(asc(s.indicators.position));
  const subs = rows.some((r) => BUILT_IN_SOURCES.includes(r.source)) ? (await listSubmissions(code)).submissions : [];
  const mapped = rows.length ? await mappedInputs(project.id) : new Map<string, Mapped>();
  const donors = visibleDonors(await donorsOf(project.id), user);
  // Each donor's report covers the time since its last deadline, so its counts differ from the cards'.
  const reports: ReportValues[] = [null, ...donors].map((d) => {
    const { from, to } = reportPeriod(d, TODAY, project.startDate);
    const within = subs.filter((x) => x.date >= from && x.date <= to);
    const value = (r: IndicatorRow) => {
      const m = mapped.get(r.code);
      if (m) return mappedValue(m.mapping, m.counted.filter((x) => x.date >= from && x.date <= to)).value;
      return r.source === "survey" || !BUILT_IN_SOURCES.includes(r.source) ? null : actualFor(asIndicator(r), within).value;
    };
    return { donorId: d?.id ?? null, from, to, values: Object.fromEntries(rows.map((r) => [r.code, value(r)])) };
  });
  return {
    saved: true,
    project: { code, name: project.name, startDate: project.startDate, endDate: project.endDate },
    today: TODAY,
    indicators: rows.map((r) => withValues(r, subs, { start: project.startDate, end: project.endDate }, mapped.get(r.code))),
    donors,
    reports,
  };
}

/* ---------- donor settings ---------- */

export class InputError extends Error {}

/**
 * Creates or updates a donor and makes its report deadlines match: each deadline is a
 * report_deadline milestone in Tasks, changed here and nowhere else.
 */
export async function saveDonor(code: string, id: string | null, input: DonorInput) {
  const project = await projectOrNull(code);
  if (!project) throw new InputError("This project is kept in the browser only; donors cannot be saved for it yet.");
  if (!FORMATS.some((f) => f.id === input.reportFormat)) throw new InputError("Unknown report format.");
  const codes = new Set((await db.select({ code: s.indicators.code }).from(s.indicators).where(eq(s.indicators.projectId, project.id))).map((r) => r.code));
  const refs = Object.fromEntries(Object.entries(input.indicatorRefs).filter(([k, v]) => codes.has(k) && v));

  return db.transaction(async (tx) => {
    const values = { name: input.name, reportFormat: input.reportFormat, indicatorRefs: refs, updatedAt: new Date() };
    const [donor] = id
      ? await tx.update(s.donors).set(values).where(and(eq(s.donors.id, id), eq(s.donors.projectId, project.id))).returning()
      : await tx.insert(s.donors).values({ ...values, projectId: project.id, organizationId: project.organizationId }).returning();
    if (!donor) throw new InputError("No such donor on this project.");

    const keep = input.deadlines.filter((d) => d.id).map((d) => d.id!);
    const mine = and(eq(s.workItems.donorId, donor.id), eq(s.workItems.projectId, project.id));
    await tx.delete(s.workItems).where(keep.length ? and(mine, notInArray(s.workItems.id, keep)) : mine);
    for (const d of input.deadlines) {
      const fields = { title: d.title, date: d.date, updatedAt: new Date() };
      if (d.id) await tx.update(s.workItems).set(fields).where(and(mine, eq(s.workItems.id, d.id)));
      else
        await tx.insert(s.workItems).values({
          ...fields,
          projectId: project.id,
          organizationId: project.organizationId,
          type: "milestone",
          milestoneKind: "report_deadline",
          donorId: donor.id,
          sourceKey: `donor:${donor.id}:${crypto.randomUUID()}`,
          createdBy: "settings",
        });
    }
    return donor.id;
  });
}

/** Removes a donor and, with it, its report deadlines. */
export async function deleteDonor(code: string, id: string) {
  const project = await projectOrNull(code);
  if (!project) return false;
  const gone = await db.delete(s.donors).where(and(eq(s.donors.id, id), eq(s.donors.projectId, project.id))).returning({ id: s.donors.id });
  return gone.length > 0;
}

/* ---------- demo data ---------- */

const levelOf = (resultId: string): Level => (resultId === "G" ? "goal" : resultId.includes(".") ? "output" : "outcome");

/**
 * The demo project's plan to the end of 2028: end targets and the total expected by 31 December
 * of each earlier year. The 2028 figure is the target itself.
 */
export const DEMO_PLAN: Record<string, { target: number; forecast: Record<string, number> }> = {
  "IND-1": { target: 250, forecast: { "2026": 20, "2027": 100 } },
  "IND-2": { target: 250, forecast: { "2026": 0, "2027": 100 } },
  "IND-3": { target: 200, forecast: { "2026": 0, "2027": 80 } },
  "IND-4": { target: 500, forecast: { "2026": 0, "2027": 200 } },
  "IND-5": { target: 25, forecast: { "2027": 10 } },
};

/** The demo project's indicators, from the plan the app showed before they moved here. */
export async function seedIndicators(projectId: string) {
  await db
    .insert(s.indicators)
    .values(
      demoIndicators.map((i, k) => ({
        projectId,
        code: i.id,
        name: i.name,
        unit: i.unit,
        target: String(DEMO_PLAN[i.id]?.target ?? i.target),
        forecast: DEMO_PLAN[i.id]?.forecast ?? {},
        level: levelOf(i.result),
        result: demoResults.find((r) => r.id === i.result)?.statement ?? null,
        source: i.source,
        filter: i.id === "IND-3" ? { field: "result", equals: "Yes" } : null,
        frequency: i.frequency === "Monthly" ? ("monthly" as const) : ("end_of_season" as const),
        theme: i.library ?? null,
        position: k,
      })),
    )
    .onConflictDoNothing();
}

/** Two fictional donors so the donor filter shows: one tracks every indicator, one a few. */
export async function seedDonors(projectId: string, organizationId: string) {
  const existing = await db.select({ id: s.donors.id }).from(s.donors).where(eq(s.donors.projectId, projectId));
  if (existing.length) return;
  const add = async (name: string, refs: Record<string, string>, deadlines: [string, string][]) => {
    const [d] = await db.insert(s.donors).values({ projectId, organizationId, name, indicatorRefs: refs }).returning();
    await db.insert(s.workItems).values(
      deadlines.map(([title, date], k) => ({
        projectId,
        organizationId,
        type: "milestone" as const,
        milestoneKind: "report_deadline" as const,
        title,
        date,
        donorId: d.id,
        sourceKey: `donor:${d.id}:demo-${k}`,
        createdBy: "demo",
      })),
    );
  };
  await add("Demo Foundation (fictional)", Object.fromEntries(demoIndicators.map((i) => [i.id, i.donorRef])), [
    ["Monthly report: January", "2027-02-08"],
    ["Monthly report: February", "2027-03-08"],
    ["Monthly report: March", "2027-04-08"],
    ["Quarterly progress report", "2027-04-15"],
    ["Monthly report: April", "2027-05-10"],
  ]);
  await add("Agri Futures Fund (fictional)", { "IND-2": "AFF-OUT-2", "IND-3": "AFF-OUT-3", "IND-5": "AFF-IMP-1" }, [
    ["Annual report 2026", "2026-12-31"],
    ["Semi-annual report", "2027-06-30"],
  ]);
}

/** Removes the demo report milestones that donor deadlines replace (databases seeded before donors existed). */
export async function dropOldDemoDeadlines(projectId: string) {
  await db
    .delete(s.workItems)
    .where(and(eq(s.workItems.projectId, projectId), inArray(s.workItems.sourceKey, ["demo:report-march", "demo:report-q1"]), isNotNull(s.workItems.sourceKey)));
}
