import { EMPTY_RECORD, STATUS_LABEL, timingOf, type ActivityAction, type ActivityBook, type ActivityRecord } from "@/lib/activities";
import { ourWork } from "@/lib/budget";
import type { AppUser } from "@/lib/demo";
import { logAudit } from "@/server/audit";
import { people } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { loadWorkplan } from "@/server/plan-store";
import { loadProjectState, updateProjectState } from "@/server/project-state";
import { createWorkItem, listWorkItems } from "@/server/work-store";

const KEY = "activities";
const today = () => new Date().toISOString().slice(0, 10);
/** Managers assign owners and may update any activity: plan approvers and monthly reviewers. */
export const managesActivities = (u: AppUser) => !!u.admin || u.project.includes("plan-approver") || u.project.includes("monthly-review");

export async function loadActivities(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const [plan, book, work, staff] = await Promise.all([loadWorkplan(code), loadProjectState<ActivityBook>(project.id, KEY, { items: {} }), listWorkItems(code), people()]);
  const t = today();
  const tasks = new Map(work.items.map((w) => [w.id, w]));
  const name = (id: string | null) => (id ? (staff.find((p) => p.id === id)?.name ?? id) : null);
  const rows = ourWork(plan).map((w) => {
    const rec: ActivityRecord = { ...EMPTY_RECORD, ...book.items[w.code] };
    const linked = rec.tasks.map((id) => tasks.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
    return {
      code: w.code,
      activityCode: w.activityCode,
      activity: w.activity,
      title: w.title,
      indicator: w.indicator,
      unit: w.unit,
      active: w.active,
      target: Object.values(w.targets).reduce((s, n) => s + n, 0),
      ...rec,
      ownerName: name(rec.owner),
      timing: timingOf(rec, w.active, t),
      tasks: linked.map((x) => ({ id: x.id, title: x.title, date: x.date, done: !!x.doneAt, assignee: name(x.assignee) })),
      mine: rec.owner === u.id,
    };
  });
  const count = (k: string) => rows.filter((r) => r.timing === k).length;
  return {
    project: { code, name: project.name },
    today: t,
    rows,
    summary: { total: rows.length, done: count("done"), late: count("late"), dueNow: count("due_now"), unowned: rows.filter((r) => !r.owner && r.timing !== "done" && r.timing !== "cancelled").length, onHold: rows.filter((r) => r.status === "on_hold").length },
    people: staff.filter((p) => p.kind === "employee").map((p) => ({ id: p.id, name: p.name, title: p.title })),
    can: { manage: managesActivities(u) },
  };
}
export type ActivitiesView = Awaited<ReturnType<typeof loadActivities>>;

/** Applies an action; returns why it was refused, or null. */
export async function actOnActivity(code: string, a: ActivityAction, u: AppUser): Promise<string | null> {
  const project = await projectByCode(code);
  const plan = ourWork(await loadWorkplan(code));
  const w = plan.find((x) => x.code === a.code);
  if (!w) return `${a.code} is not in ROP's workplan for this project.`;
  const book = await loadProjectState<ActivityBook>(project.id, KEY, { items: {} });
  const rec: ActivityRecord = { ...EMPTY_RECORD, ...book.items[a.code] };
  const manage = managesActivities(u);
  const ev = (what: string) => ({ at: today(), by: u.id, byName: u.name, what });
  // The change, applied to the record as stored when it is saved (locked), so two changes at once both stay.
  let apply: (r: ActivityRecord) => ActivityRecord;
  if (a.action === "assign") {
    if (!manage) return "Only a plan approver or monthly reviewer assigns owners.";
    const staff = await people();
    if (a.owner && !staff.some((p) => p.id === a.owner)) return "No such person.";
    apply = (r) => ({ ...r, owner: a.owner, history: [...r.history, ev(a.owner ? `Owner: ${staff.find((p) => p.id === a.owner)!.name}` : "Owner removed")] });
  } else if (a.action === "status") {
    if (!manage && rec.owner !== u.id) return "Only the activity's owner or a manager updates its status.";
    if (a.on > today()) return "The date cannot be in the future.";
    apply = (r) => ({
      ...r,
      status: a.status,
      startedOn: a.status === "not_started" ? null : (r.startedOn ?? a.on),
      doneOn: a.status === "done" ? a.on : null,
      blocker: a.status === "on_hold" || a.status === "cancelled" || a.blocker ? a.blocker : "",
      history: [...r.history, ev(`${STATUS_LABEL[a.status]} from ${a.on}${a.blocker ? `: ${a.blocker}` : ""}`)],
    });
  } else {
    if (!manage && rec.owner !== u.id) return "Only the activity's owner or a manager adds tasks to it.";
    const item = await createWorkItem(code, { type: "task", title: `${a.code} · ${a.title}`, date: a.date, assignee: a.assignee ?? rec.owner }, u.id);
    apply = (r) => ({ ...r, tasks: [...r.tasks, item.id], history: [...r.history, ev(`Task added: ${a.title}`)] });
  }
  return updateProjectState<ActivityBook, string | null>(project.id, KEY, { items: {} }, async (cur, tx) => {
    const now = { ...EMPTY_RECORD, ...cur.items[a.code] };
    // A status change is judged again on the record as it is now: an owner changed a moment ago decides.
    if (a.action === "status" && !manage && now.owner !== u.id) return { data: null, result: "Only the activity's owner or a manager updates its status." };
    await logAudit(tx, project.id, { entity: "activity", entityId: project.id, action: `activity_${a.action}`, by: u.id, detail: { code: a.code, ...("status" in a ? { status: a.status } : {}), ...("owner" in a ? { owner: a.owner } : {}) } });
    return { data: { items: { ...cur.items, [a.code]: apply(now) } }, result: null };
  });
}
