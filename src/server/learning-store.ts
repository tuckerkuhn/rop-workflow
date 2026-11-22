import { storeNames } from "@/lib/file-store";
import { randomUUID } from "node:crypto";
import { registerAuthority } from "@/lib/authority";
import type { AppUser } from "@/lib/demo";
import { CLOSEOUT_ITEMS, EMPTY_LEARNING, type CloseoutId, type Learning, type LearningAction } from "@/lib/learning";
import { DONE, isSharePointUrl, procRolesFor } from "@/lib/procurement";
import { logAudit } from "@/server/audit";
import { isMelOwner } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { loadHr } from "@/server/hr-store";
import { loadProcurements } from "@/server/procurement-store";
import { loadProjectState, updateProjectState } from "@/server/project-state";
import { loadResults } from "@/server/results-store";

const KEY = "learning";
const today = () => new Date().toISOString().slice(0, 10);

/** Who may confirm each close-out item: the role named on it, or an administrator. */
async function mayTick(u: AppUser, who: string) {
  if (u.admin) return true;
  const holders = (await loadHr().catch(() => null))?.state.rules?.holders ?? {};
  registerAuthority(holders);
  const roles = procRolesFor(u);
  if (who === "finance") return roles.includes("finance");
  if (who === "procurement") return roles.includes("procurement");
  if (who === "mel") return isMelOwner(u);
  if (who === "hr") return !!(holders as Record<string, string[]>).hr?.includes(u.id);
  return u.project.includes(who as AppUser["project"][number]);
}

export async function loadLearning(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const [l, procs, results] = await Promise.all([loadProjectState<Learning>(project.id, KEY, EMPTY_LEARNING), loadProcurements(code).catch(() => []), loadResults(code).catch(() => [])]);
  const openProcs = procs.filter((p) => p.step !== DONE);
  const waiting = results.filter((r) => r.status !== "accepted");
  // Two items are read from the records themselves.
  const auto: Partial<Record<CloseoutId, { ok: boolean; detail: string }>> = {
    procurementsClosed: { ok: !openProcs.length, detail: openProcs.length ? `${openProcs.length} open: ${openProcs.slice(0, 5).map((p) => p.id).join(", ")}` : `All ${procs.length} closed` },
    results: { ok: !waiting.length, detail: waiting.length ? `${waiting.length} still pending or queried` : `All ${results.length} accepted` },
  };
  const items = await Promise.all(
    CLOSEOUT_ITEMS.map(async (i) => {
      const tick = l.closeout[i.id] ?? null;
      const a = auto[i.id];
      return { ...i, tick, auto: a ?? null, done: a ? a.ok && !!tick : !!tick, canTick: !l.closed && (await mayTick(u, i.who)) };
    }),
  );
  return {
    project: { code, name: project.name, end: project.endDate },
    lessons: [...l.lessons].sort((a, b) => b.date.localeCompare(a.date)),
    items,
    closed: l.closed,
    can: { record: u.kind === "employee", close: !l.closed && (!!u.admin || u.project.includes("plan-approver")) && items.every((i) => i.done) },
  };
}
export type LearningView = Awaited<ReturnType<typeof loadLearning>>;

export async function actOnLearning(code: string, a: LearningAction, u: AppUser): Promise<string | null> {
  const project = await projectByCode(code);
  const me = { by: u.id, byName: u.name };
  // Who may do it, read before the lock (these read other records).
  if (a.action === "lesson") {
    if (u.kind !== "employee") return "Lessons are recorded by project staff.";
    if (a.date > today()) return "The date cannot be in the future.";
  } else if (a.action === "tick" || a.action === "untick") {
    const item = CLOSEOUT_ITEMS.find((i) => i.id === a.item)!;
    if (!(await mayTick(u, item.who))) return `Only the ${item.who.replace("-", " ")} confirms this item.`;
    if (a.action === "tick") {
      if (a.evidence && !isSharePointUrl(a.evidence)) return `Evidence must be a link to the file in ${storeNames()}.`;
      if (!a.evidence && !["procurementsClosed", "results"].includes(a.item)) return `Link the evidence in ${storeNames()}.`;
    }
  } else if (a.action !== "applied") {
    const v = await loadLearning(code, u);
    if (!v.can.close) return "Every close-out item must be done, and only a plan approver closes the project.";
  }
  // The change itself, on the record as stored now (locked): two changes at the same moment both stay.
  return updateProjectState<Learning, string | null>(project.id, KEY, EMPTY_LEARNING, async (l, tx) => {
    let next: Learning;
    if (a.action === "lesson") {
      next = { ...l, lessons: [...l.lessons, { id: randomUUID().slice(0, 8), date: a.date, area: a.area, happened: a.happened, lesson: a.lesson, action: a.action_, ...me, applied: null }] };
    } else if (a.action === "applied") {
      const x = l.lessons.find((y) => y.id === a.id);
      if (!x) return { data: null, result: "No such lesson." };
      if (x.applied) return { data: null, result: "Already marked applied." };
      next = { ...l, lessons: l.lessons.map((y) => (y.id === a.id ? { ...y, applied: { on: today(), how: a.how, ...me } } : y)) };
    } else if (a.action === "tick" || a.action === "untick") {
      if (l.closed) return { data: null, result: "The project is closed." };
      if (a.action === "tick") {
        next = { ...l, closeout: { ...l.closeout, [a.item]: { on: today(), evidence: a.evidence, note: a.note, ...me } } };
      } else {
        const rest = { ...l.closeout };
        delete rest[a.item];
        next = { ...l, closeout: rest };
      }
    } else {
      // Checked again on the record as it is now: an item unticked a moment ago keeps the project open.
      if (l.closed) return { data: null, result: "The project is already closed." };
      if (CLOSEOUT_ITEMS.some((i) => !l.closeout[i.id])) return { data: null, result: "Every close-out item must be done, and only a plan approver closes the project." };
      next = { ...l, closed: { on: today(), ...me } };
    }
    await logAudit(tx, project.id, { entity: "learning", entityId: project.id, action: `learning_${a.action}`, by: u.id, detail: { ...("item" in a ? { item: a.item } : {}), ...("area" in a ? { area: a.area } : {}), ...("note" in a && a.note ? { note: a.note } : {}) } });
    return { data: next, result: null };
  });
}
