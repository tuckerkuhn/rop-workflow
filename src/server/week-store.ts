import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { EMPTY_FEEDBACK, overdue, type FeedbackLog } from "@/lib/feedback";
import { MAX_PRIORITIES, mondayOf, safeHref, suggestPriorities, weekNumbers, weekSummary, type Priority, type ProjectWeek, type WeekAction, type WeekPlan } from "@/lib/week";
import { demoMode, onProject } from "@/server/auth";
import { loadHome } from "@/server/home-store";
import { nextReport } from "@/server/next-report";
import { orgIdForPerson } from "@/server/org-settings-store";
import { DEMO_PROJECT } from "@/server/procurement-guard";
import { loadProjectState } from "@/server/project-state";
import { listProjects } from "@/server/project-store";
import { rawQpr } from "@/server/qpr-store";
import { reportCalendar } from "@/server/report-calendar";

/**
 * The week ahead for a manager (lib/week): the summary, three numbers and the priorities, across
 * every project the person oversees. The person's confirmed priorities are kept per person and per
 * week in organization state (key "week:<person>:<monday>").
 */

const realToday = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

async function projectWeek(p: { code: string; name: string; id: string }, u: AppUser, today: string): Promise<ProjectWeek | null> {
  const [home, nr, cal, log] = await Promise.all([
    loadHome(p.code, u).catch(() => null),
    nextReport(p.code).catch(() => null),
    reportCalendar(p.code, today).catch(() => ({ rows: [] })),
    loadProjectState<FeedbackLog>(p.id, "feedback", EMPTY_FEEDBACK).catch(() => EMPTY_FEEDBACK),
  ]);
  if (!home) return null;
  const weekAgo = addDays(today, -7);
  const label = (r: { kind: "qpr" | "annual"; period: string }) => (r.kind === "qpr" ? `${r.period.slice(5)} quarterly report` : `${r.period} annual report`);
  const owed = cal.rows.filter((r) => !r.released && r.due && daysBetween(today, r.due) <= 30);
  // Released in the last seven days: the quarterly reports the calendar lists as released, by their release date.
  const released = (
    await Promise.all(cal.rows.filter((r) => r.released && r.kind === "qpr").map(async (r) => ((await rawQpr(p.id, r.period).catch(() => null))?.released?.at ?? "").slice(0, 10) >= weekAgo ? label(r) : null))
  ).filter((x): x is string => !!x);
  return {
    code: p.code,
    // "Afghanistan Community Resilience Programme (ACRP)" reads as "ACRP" in a sentence; a long name with no short form reads as its code.
    short: p.name.match(/\(([^)]+)\)\s*$/)?.[1] ?? (p.name.length <= 24 ? p.name : p.code),
    late: home.schedule.late.length,
    reports: owed.map((r) => ({ label: label(r), due: r.due!, days: daysBetween(today, r.due!), late: today > r.due!, href: `${r.href.replace("#", `${r.href.includes("?") ? "&" : "?"}project=${encodeURIComponent(p.code)}#`)}` })),
    blocking: nr && !nr.released ? nr.blocking : 0,
    blockingHref: `/progress/report?q=${nr?.quarter ?? ""}&project=${encodeURIComponent(p.code)}#checks`,
    approvals: home.actions.filter((a) => a.bucket === "approve").map((a) => ({ text: a.text, href: a.href, since: a.since ?? null })),
    complaintsLate: log.entries.filter((e) => overdue(e, today)).length,
    complaintsNew: log.entries.filter((e) => e.date >= weekAgo && e.kind !== "thanks").length,
    complaintsAnswered: log.entries.filter((e) => e.answer && e.answer.on >= weekAgo).length,
    released,
  };
}

const keyOf = (u: AppUser, week: string) => `week:${u.id}:${week}`;
async function planOf(orgId: string | null, u: AppUser, week: string): Promise<WeekPlan> {
  const empty: WeekPlan = { week, items: [], confirmedAt: null };
  if (!orgId) return empty;
  const [row] = await db.select().from(s.organizationState).where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, keyOf(u, week)))).limit(1);
  return { ...empty, ...((row?.data as Partial<WeekPlan> | undefined) ?? {}) };
}

export async function loadWeek(u: AppUser, today = realToday()) {
  const week = mondayOf(today);
  const orgId = await orgIdForPerson(u.id).catch(() => null);
  const all = (await db.select({ id: s.projects.id, code: s.projects.code }).from(s.projects)).reduce<Record<string, string>>((m, r) => (r.code ? { ...m, [r.code]: r.id } : m), {});
  const listed = (await listProjects()).filter((p) => (demoMode() || p.code !== DEMO_PROJECT) && onProject(u, p.code) && p.stage !== "Develop" && all[p.code]);
  const projects = (await Promise.all(listed.map((p) => projectWeek({ code: p.code, name: p.name, id: all[p.code] }, u, today)))).filter((x): x is ProjectWeek => !!x);
  const plan = await planOf(orgId, u, week);
  return {
    week,
    today,
    summary: weekSummary(projects, today),
    numbers: weekNumbers(projects),
    /** Proposed from the records; the person's own list once confirmed. */
    suggestions: suggestPriorities(projects),
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
      next = { week, items, confirmedAt: new Date().toISOString() };
    } else if (a.action === "done") {
      if (!plan.items.some((i) => i.id === a.id)) return "That priority is no longer on this week's list.";
      next = { ...plan, items: plan.items.map((i) => (i.id === a.id ? { ...i, done: a.done } : i)) };
    } else next = { ...plan, confirmedAt: null };
    await tx.update(s.organizationState).set({ data: next, updatedAt: new Date() }).where(where);
    return null;
  });
}
