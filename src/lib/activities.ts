import { z } from "zod";

/**
 * Execution of the workplan: each of ROP's sub-activities has a status, an owner, the dates it
 * actually started and finished, what is in the way, and the tasks made for it. The plan itself
 * (targets, quarters) stays in the workplan; this is what happened.
 */

export const ACTIVITY_STATUSES = ["not_started", "in_progress", "on_hold", "done", "cancelled"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
export const STATUS_LABEL: Record<ActivityStatus, string> = { not_started: "Not started", in_progress: "Under way", on_hold: "On hold", done: "Done", cancelled: "Cancelled" };

export type ActivityEvent = { at: string; by: string; byName: string; what: string };
export type ActivityRecord = {
  status: ActivityStatus;
  owner: string | null;
  startedOn: string | null;
  doneOn: string | null;
  /** What is in the way, for on hold or late work. */
  blocker: string;
  /** Work items (tasks) made for this activity. */
  tasks: string[];
  history: ActivityEvent[];
};
export type ActivityBook = { items: Record<string, ActivityRecord> };
export const EMPTY_RECORD: ActivityRecord = { status: "not_started", owner: null, startedOn: null, doneOn: null, blocker: "", tasks: [], history: [] };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const activityAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), code: z.string().min(1).max(30), owner: z.string().min(1).max(60).nullable() }),
  z
    .object({ action: z.literal("status"), code: z.string().min(1).max(30), status: z.enum(ACTIVITY_STATUSES), on: day, blocker: z.string().trim().max(600).default("") })
    .refine((a) => !["on_hold", "cancelled"].includes(a.status) || a.blocker.length >= 5, { message: "Say what is in the way, or why it was cancelled.", path: ["blocker"] }),
  z.object({ action: z.literal("task"), code: z.string().min(1).max(30), title: z.string().trim().min(1).max(200), date: day.nullable(), assignee: z.string().min(1).max(60).nullable() }),
]);
export type ActivityAction = z.infer<typeof activityAction>;

/** The end of a quarter that starts on `q` (YYYY-MM-01). */
export const quarterEnd = (q: string) => {
  const d = new Date(`${q}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 3);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};

export type Timing = "done" | "cancelled" | "late" | "due_now" | "upcoming" | "unscheduled";
/**
 * Where an activity stands against its planned window: late once its last planned quarter has
 * ended and it is not done; due now while a planned quarter is under way.
 */
export function timingOf(rec: ActivityRecord, active: string[], today: string): Timing {
  if (rec.status === "done") return "done";
  if (rec.status === "cancelled") return "cancelled";
  if (!active.length) return "unscheduled";
  const last = [...active].sort().at(-1)!;
  if (quarterEnd(last) < today) return "late";
  if (active.some((q) => q <= today && quarterEnd(q) >= today)) return "due_now";
  return "upcoming";
}
