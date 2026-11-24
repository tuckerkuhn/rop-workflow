import { and, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { canEditProject, type AppUser } from "@/lib/demo";
import { EMPTY_SELECTION, type Selection } from "@/lib/selection";
import { weekOf } from "@/lib/weekly";
import { loadField } from "@/server/field-store";
import { lensesFor } from "@/server/home-store";
import { loadWeekly } from "@/server/weekly-store";
import { EMPTY_FEEDBACK, overdue, type FeedbackLog } from "@/lib/feedback";
import { MAX_PRIORITIES, mondayOf, safeHref, withProject, suggestFor, weekScore, weekSummaryFor, withCarried, type Priority, type ProjectWeek, type ProjectWork, type WeekKind, type WeekAction, type WeekPlan } from "@/lib/week";
import { demoMode, onProject } from "@/server/auth";
import { early } from "@/server/early";
import { loadHomeJoining } from "@/server/home-store";
import { joinRunning, nextReport } from "@/server/next-report";
import { orgIdForPerson } from "@/server/org-settings-store";
import { DEMO_PROJECT } from "@/server/procurement-guard";
import { loadProjectState } from "@/server/project-state";
import { listProjects } from "@/server/project-store";
import { rawQpr } from "@/server/qpr-store";
import { reportCalendar } from "@/server/report-calendar";

/**
 * The week ahead for a manager (lib/week): the summary and the priorities, across
 * every project the person oversees. The person's confirmed priorities are kept per person and per
 * week in organization state (key "week:<person>:<monday>").
 */

const realToday = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/**
 * Whose week it is, or null for people who have no week page: leadership, then the technical lead,
 * then the people who run a project (its manager). Field and office staff work from the to-do list.
 */
export function weekKindFor(u: AppUser): WeekKind | null {
  if (u.kind !== "employee") return null;
  if (lensesFor(u).includes("lead")) return "lead";
  if (u.project.includes("technical-lead")) return "technical";
  return canEditProject(u) ? "manager" : null;
}

/** What a manager or technical lead reads beyond leadership: money, checks, the field, selection and the weekly updates. */
async function projectWork(p: { code: string; id: string }, u: AppUser, home: NonNullable<Awaited<ReturnType<typeof loadHomeJoining>>>, today: string): Promise<ProjectWork> {
  const [field, sel, weekly] = await Promise.all([
    loadField(p.code, u).catch(() => null),
    loadProjectState<Selection>(p.id, "selection", EMPTY_SELECTION).catch(() => EMPTY_SELECTION),
    loadWeekly(p.code).catch(() => null),
  ]);
  const items = field?.items ?? [];
  const farmers = items.filter((i) => i.kind === "farmer");
  const thisWeek = weekOf(today);
  const lastWeek = weekOf(addDays(thisWeek.from, -2));
  const find = (w: { from: string; to: string }) => weekly?.weeks.find((x) => x.from <= w.to && w.from <= x.to);
  return {
    overBudget: home.budget.overspent.length,
    toCheck: home.mel.pending,
    queried: home.mel.queried,
    fieldIssues: items.reduce((t, i) => t + ((i as { issues?: { status?: string }[] }).issues ?? []).filter((x) => x.status === "open").length, 0),
    farmers: farmers.length,
    undecided: sel.criteria.length ? farmers.filter((f) => !sel.decisions[f.id]).length : 0,
    rulesWritten: sel.criteria.length > 0,
    // A project that has never written a weekly update is not behind on one.
    lastWeekSent: !weekly?.weeks.length || !!find(lastWeek)?.sent,
    thisWeekStarted: !weekly?.weeks.length || !!find(thisWeek),
    weeklyKept: !!weekly?.weeks.length,
  };
}

async function projectWeek(p: { code: string; name: string; id: string }, u: AppUser, today: string, kind: WeekKind): Promise<ProjectWeek | null> {
  const weekAgo = addDays(today, -7);
  const label = (r: { kind: "qpr" | "annual"; period: string }) => (r.kind === "qpr" ? `${r.period.slice(5)} ${r.period.slice(0, 4)} quarterly report` : `${r.period} annual report`);
  const calLater = reportCalendar(p.code, today).catch(() => ({ rows: [] as Awaited<ReturnType<typeof reportCalendar>>["rows"] }));
  // All read together. Home and its next report are what Home's own page is reading for the open
  // project at this moment: joined, not read twice (server/next-report joinRunning).
  const [home, nr, cal, log, released] = await Promise.all([
    loadHomeJoining(p.code, u).catch(() => null),
    joinRunning(`next-report:${p.code}`, () => nextReport(p.code)).catch(() => null),
    calLater,
    loadProjectState<FeedbackLog>(p.id, "feedback", EMPTY_FEEDBACK).catch(() => EMPTY_FEEDBACK),
    // Released in the last seven days: the quarterly reports the calendar lists as released, by their release date.
    // (Annual reports are written outside the app and never marked released, so none is listed.)
    calLater.then(async (c) => (await Promise.all(c.rows.filter((r) => r.released && r.kind === "qpr").map(async (r) => (((await rawQpr(p.id, r.period).catch(() => null))?.released?.at ?? "").slice(0, 10) >= weekAgo ? label(r) : null)))).filter((x): x is string => !!x)),
  ]);
  if (!home) return null;
  // "Afghanistan Community Resilience Programme (ACRP)" reads as "ACRP" in a sentence; a long name with no short form reads as its code.
  const short = p.name.match(/\(([^)]+)\)\s*$/)?.[1] ?? (p.name.length <= 24 ? p.name : p.code);
  const owed = cal.rows.filter((r) => !r.released && r.due && daysBetween(today, r.due) <= 30);
  return {
    code: p.code,
    short,
    late: home.schedule.late.length,
    reports: owed.map((r) => ({ label: label(r), due: r.due!, days: daysBetween(today, r.due!), late: today > r.due!, href: withProject(r.href, p.code) })),
    blocking: nr && !nr.released ? nr.blocking : 0,
    blockingHref: `/progress/report?q=${nr?.quarter ?? ""}&project=${encodeURIComponent(p.code)}#checks`,
    approvals: home.actions.filter((a) => a.bucket === "approve").map((a) => ({ text: a.text, href: withProject(a.href, p.code), since: a.since ?? null, short })),
    complaintsLate: log.entries.filter((e) => overdue(e, today)).length,
    complaintsNew: log.entries.filter((e) => e.date >= weekAgo && e.kind !== "thanks").length,
    complaintsAnswered: log.entries.filter((e) => e.answer && e.answer.on >= weekAgo).length,
    released,
    ...(kind === "lead" ? {} : { work: await projectWork(p, u, home, today) }),
  };
}

const keyOf = (u: AppUser, week: string) => `week:${u.id}:${week}`;
export async function planOf(orgId: string | null, u: AppUser, week: string): Promise<WeekPlan> {
  const empty: WeekPlan = { week, items: [], confirmedAt: null };
  if (!orgId) return empty;
  const [row] = await db.select().from(s.organizationState).where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, keyOf(u, week)))).limit(1);
  return { ...empty, ...((row?.data as Partial<WeekPlan> | undefined) ?? {}) };
}

export async function loadWeek(u: AppUser, today = realToday()) {
  const week = mondayOf(today);
  const kind = weekKindFor(u) ?? "lead";
  // The person's own plan does not depend on the projects: read alongside them.
  // This week's plan, and last week's for what was left undone.
  const planLater = early(orgIdForPerson(u.id).catch(() => null).then(async (orgId) => Promise.all([planOf(orgId, u, week), planOf(orgId, u, addDays(week, -7))])));
  const listed = (await listProjects()).filter((p) => (demoMode() || p.code !== DEMO_PROJECT) && onProject(u, p.code) && p.stage !== "Develop");
  const ids = new Map((await db.select({ id: s.projects.id, code: s.projects.code }).from(s.projects).where(inArray(s.projects.code, listed.map((p) => p.code).concat("")))).map((r) => [r.code, r.id]));
  const projects = (await Promise.all(listed.filter((p) => ids.has(p.code)).map((p) => projectWeek({ code: p.code, name: p.name, id: ids.get(p.code)! }, u, today, kind)))).filter((x): x is ProjectWeek => !!x);
  const [plan, lastWeek] = await planLater;
  return {
    week,
    today,
    kind,
    summary: weekSummaryFor(kind, projects, today),
    /** Proposed from the records; the person's own list once confirmed. */
    suggestions: withCarried(lastWeek, suggestFor(kind, projects)),
    /** How last week's confirmed list ended, for the line under the heading. */
    lastWeek: weekScore(lastWeek),
    plan,
    projects: projects.map((p) => ({ code: p.code, short: p.short })),
    max: MAX_PRIORITIES,
  };
}
export type WeekView = Awaited<ReturnType<typeof loadWeek>>;

/** Changes the person's own plan for this week. Read and saved with the row locked, so two taps never undo each other. */
export async function actOnWeek(u: AppUser, a: WeekAction, today = realToday()): Promise<string | null> {
  const week = mondayOf(today);
  const orgId = await orgIdForPerson(u.id).catch(() => null);
  if (!orgId) return "No organization is set up yet.";
  const key = keyOf(u, week);
  const where = and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, key));
  return db.transaction(async (tx) => {
    await tx.insert(s.organizationState).values({ organizationId: orgId, key, data: { week, items: [], confirmedAt: null } }).onConflictDoNothing();
    const [row] = await tx.select().from(s.organizationState).where(where).for("update");
    const plan: WeekPlan = { week, items: [], confirmedAt: null, ...((row?.data as Partial<WeekPlan> | undefined) ?? {}) };
    let next: WeekPlan;
    if (a.action === "confirm") {
      const was = new Map(plan.items.map((i) => [i.id, i]));
      const items: Priority[] = a.items.map((i, k) => ({ id: i.own && !was.has(i.id) ? `own:${Date.now()}:${k}` : i.id, text: i.text, href: i.own ? "" : safeHref(i.href), own: i.own, done: was.get(i.id)?.done ?? false }));
      if (new Set(items.map((i) => i.id)).size !== items.length) return "The same priority is on the list twice.";
      next = { week, items, confirmedAt: new Date().toISOString() };
    } else if (a.action === "done") {
      if (!plan.items.some((i) => i.id === a.id)) return "That priority is no longer on this week's list.";
      next = { ...plan, items: plan.items.map((i) => (i.id === a.id ? { ...i, done: a.done } : i)) };
    } else next = { ...plan, confirmedAt: null };
    await tx.update(s.organizationState).set({ data: next, updatedAt: new Date() }).where(where);
    return null;
  });
}
