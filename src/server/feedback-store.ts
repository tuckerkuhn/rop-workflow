import { randomUUID } from "node:crypto";
import { db } from "@/db";
import type { AppUser } from "@/lib/demo";
import { EMPTY_FEEDBACK, feedbackSummary, forViewer, mayReadSerious, sortFeedback, type FeedbackAction, type FeedbackLog } from "@/lib/feedback";
import { quarterOf, quarterRange } from "@/lib/results";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { loadProjectState, saveProjectState } from "@/server/project-state";

const KEY = "feedback";
const today = () => new Date().toISOString().slice(0, 10);

export async function loadFeedback(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const log = await loadProjectState<FeedbackLog>(project.id, KEY, EMPTY_FEEDBACK);
  const t = today();
  const q = quarterOf(t);
  const { from, to } = quarterRange(q);
  return {
    project: { code, name: project.name },
    entries: sortFeedback(log.entries.map((e) => forViewer(e, u))),
    quarter: q,
    thisQuarter: feedbackSummary(log.entries, from, to, t),
    all: feedbackSummary(log.entries, "0000-01-01", "9999-12-31", t),
    can: { record: u.kind === "employee" },
  };
}
export type FeedbackView = Awaited<ReturnType<typeof loadFeedback>>;

export async function actOnFeedback(code: string, a: FeedbackAction, u: AppUser): Promise<string | null> {
  if (u.kind !== "employee") return "Feedback is recorded by project staff.";
  const project = await projectByCode(code);
  const log = await loadProjectState<FeedbackLog>(project.id, KEY, EMPTY_FEEDBACK);
  const me = { by: u.id, byName: u.name };
  let next: FeedbackLog;
  let id: string;
  if (a.action === "record") {
    if (a.date > today()) return "The date cannot be in the future.";
    id = randomUUID().slice(0, 8);
    next = { entries: [...log.entries, { id, date: a.date, kind: a.kind, from: a.from, channel: a.channel, place: a.place, about: a.about, serious: a.serious, ...me, answer: null }] };
  } else {
    const e = log.entries.find((x) => x.id === a.id);
    if (!e) return "No such entry.";
    if (e.answer) return "Already answered.";
    if (e.serious && !mayReadSerious(u, e)) return "A serious matter is answered by a plan approver or an administrator.";
    id = e.id;
    next = { entries: log.entries.map((x) => (x.id === a.id ? { ...x, answer: { on: today(), text: a.text, ...me } } : x)) };
  }
  await saveProjectState(project.id, KEY, next);
  // The record of who did what never carries the words of the matter.
  await logAudit(db, project.id, { entity: "feedback", entityId: id, action: a.action === "record" ? "feedback_recorded" : "feedback_answered", by: u.id, detail: a.action === "record" ? { kind: a.kind, from: a.from, serious: a.serious } : {} });
  return null;
}
