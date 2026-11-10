import { and, asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { activityOf } from "@/lib/qpr";
import { emptyWeekly, weekOf, type Week, type WeeklyState } from "@/lib/weekly";
import { isMelOwner } from "@/server/auth";
import { projectByCode, donorNameOf } from "@/server/field-store";
import { loadProjectState, saveProjectState } from "@/server/project-state";
import { loadUpdates } from "@/server/results-store";

/** The weekly update: its weeks in project_state ("weekly"), its items as activity updates. */

export const mayWriteWeekly = (u: AppUser) => u.kind === "employee" && (u.fieldAccess === "edit" || isMelOwner(u));

export async function loadWeekly(code: string): Promise<WeeklyState> {
  const project = await projectByCode(code);
  return loadProjectState<WeeklyState>(project.id, "weekly", emptyWeekly);
}

export async function saveWeekly(code: string, state: WeeklyState) {
  const project = await projectByCode(code);
  await saveProjectState(project.id, "weekly", { ...state, weeks: [...state.weeks].sort((a, b) => b.from.localeCompare(a.from)) });
}

/** A week's view: the week (saved, or proposed when none is saved yet), its items, and the activities to file them under. */
export async function weeklyView(code: string, u: AppUser, from: string | null) {
  const project = await projectByCode(code);
  const state = await loadWeekly(code);
  const today = new Date().toISOString().slice(0, 10);
  const pick = from ? state.weeks.find((w) => w.from === from) : undefined;
  const here = weekOf(today);
  const current: Week & { saved: boolean } = pick
    ? { ...pick, saved: true }
    : (() => {
        const p = from ? weekOf(from) : here;
        const saved = state.weeks.find((w) => w.from <= p.to && p.from <= w.to);
        return saved ? { ...saved, saved: true } : { n: Math.max(0, ...state.weeks.map((w) => w.n)) + 1, ...p, saved: false };
      })();
  const updates = (await loadUpdates(code)).filter((x) => x.date >= current.from && x.date <= current.to);
  const indicators = await db.select({ code: s.indicators.code, donorCode: s.indicators.donorCode }).from(s.indicators).where(eq(s.indicators.projectId, project.id)).orderBy(asc(s.indicators.code));
  const names = new Map<string, string>();
  for (const l of await db.selectDistinct({ c: s.budgetLines.activityCode, n: s.budgetLines.activity }).from(s.budgetLines).where(and(eq(s.budgetLines.projectId, project.id)))) if (l.c && l.n && !names.has(l.c)) names.set(l.c, l.n);
  for (const w of await db.selectDistinct({ c: s.workplanItems.activityCode, n: s.workplanItems.activity }).from(s.workplanItems).where(eq(s.workplanItems.projectId, project.id))) if (w.c && w.n) names.set(w.c, w.n);
  // Activities as the donor numbers them (1.1.1); a project whose indicators have no donor codes has none yet.
  const activities = [...new Set(indicators.map((i) => activityOf(i.donorCode, i.code)))]
    .filter((c) => /^\d+\.\d+\.\d+$/.test(c))
    .sort()
    .map((c) => ({ code: c, name: names.get(c) ?? `Activity ${c}` }));
  const order = (a: string) => activities.findIndex((x) => x.code === a);
  const items = updates.sort((a, b) => order(a.activity) - order(b.activity) || a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
  const write = mayWriteWeekly(u) && !current.sent;
  return {
    project: { code: project.code, name: project.name, donor: await donorNameOf(project) },
    region: state.region,
    weeks: state.weeks.map((w) => ({ n: w.n, from: w.from, to: w.to, sent: !!w.sent })),
    week: current,
    items: items.map((x) => ({ ...x, mayEdit: write && (x.by === u.id || isMelOwner(u)) })),
    activities,
    today,
    may: { write, add: write && current.saved && current.from <= today && activities.length > 0, send: write && current.saved && items.length > 0 },
  };
}
export type WeeklyView = Awaited<ReturnType<typeof weeklyView>>;
