import { randomUUID } from "node:crypto";
import type { AppUser } from "@/lib/demo";
import { EMPTY_FEEDBACK, feedbackSummary, forViewer, mayReadSerious, sortFeedback, type FeedbackAction, type FeedbackLog } from "@/lib/feedback";
import { quarterOf, quarterRange } from "@/lib/results";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { loadProjectState, updateProjectState } from "@/server/project-state";

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
  if (a.action === "record" && a.date > today()) return "The date cannot be in the future.";
  const project = await projectByCode(code);
  const me = { by: u.id, byName: u.name };
  // Read and saved with the log locked: two people recording at the same moment both keep their entry.
  return updateProjectState<FeedbackLog, string | null>(project.id, KEY, EMPTY_FEEDBACK, async (log, tx) => {
    let next: FeedbackLog;
    let id: string;
    if (a.action === "record") {
      id = randomUUID().slice(0, 8);
      next = { entries: [...log.entries, { id, date: a.date, kind: a.kind, from: a.from, channel: a.channel, place: a.place, about: a.about, serious: a.serious, ...me, answer: null }] };
    } else {
      const e = log.entries.find((x) => x.id === a.id);
      if (!e) return { data: null, result: "No such entry." };
      if (e.answer) return { data: null, result: "Already answered." };
      if (e.serious && !mayReadSerious(u, e)) return { data: null, result: "A serious matter is answered by a plan approver or an administrator." };
      id = e.id;
      next = { entries: log.entries.map((x) => (x.id === a.id ? { ...x, answer: { on: today(), text: a.text, ...me } } : x)) };
    }
    // The record of who did what never carries the words of the matter.
    await logAudit(tx, project.id, { entity: "feedback", entityId: id, action: a.action === "record" ? "feedback_recorded" : "feedback_answered", by: u.id, detail: a.action === "record" ? { kind: a.kind, from: a.from, serious: a.serious } : {} });
    return { data: next, result: null };
  });
}
