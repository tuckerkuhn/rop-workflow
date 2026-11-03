import { z } from "zod";
import { TODAY, daysFrom } from "@/lib/demo";

/**
 * Tasks and milestones added in Tasks. Field and procurement steps are not stored here;
 * Tasks shows them next to these items, read from their own workflows.
 */

export const MILESTONE_KINDS = ["report_deadline", "harvest_window", "field_activity", "other"] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

/** A stored task or milestone, as the API returns it. */
export type WorkItem = {
  id: string;
  type: "task" | "milestone";
  title: string;
  date: string | null;
  endDate: string | null;
  milestoneKind: MilestoneKind | null;
  assignee: string | null;
  doneAt: string | null;
  doneBy: string | null;
  createdBy: string | null;
  /** Made by the app from another record (e.g. a donor's reporting deadline); change it there. */
  automatic: boolean;
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** What a person may send to add an item. */
export const newWorkItemSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task"), title: z.string().trim().min(1).max(200), date: isoDate.nullable(), assignee: z.string().min(1).nullable() }),
  z
    .object({ type: z.literal("milestone"), title: z.string().trim().min(1).max(200), date: isoDate, endDate: isoDate.nullable(), milestoneKind: z.enum(MILESTONE_KINDS) })
    .refine((m) => !m.endDate || m.endDate >= m.date, { message: "The end date is before the start date.", path: ["endDate"] }),
]);
export type NewWorkItem = z.infer<typeof newWorkItemSchema>;

/** Changes a person may make later. Only tasks can be ticked off. */
export const workItemPatchSchema = z.object({ done: z.boolean() });

/**
 * One row in Tasks, whatever its source. Tasks from a workflow open that workflow instead of
 * being ticked off here.
 */
export type Row =
  | {
      key: string;
      kind: "task";
      title: string;
      /** Due date; for workflow steps, when the step is expected to finish. */
      date: string | null;
      done: boolean;
      /** A workflow step taking longer than usual, even if its projected date is still ahead. */
      late: boolean;
      source: "manual" | "field" | "procurement" | "project";
      /** Workflow steps: what to do now. */
      step?: string;
      href?: string;
      assignee?: string | null;
      id?: string;
    }
  | { key: string; kind: "milestone"; title: string; date: string; end: string | null; milestoneKind: MilestoneKind; id: string; automatic: boolean };

export const rowEnd = (r: Row) => (r.kind === "milestone" ? (r.end ?? r.date) : r.date);

export const isOverdue = (r: Row, today = TODAY) => r.kind === "task" && !r.done && ((!!r.date && r.date < today) || r.late);

/** True when the row falls on `day`; a range covers every day in it. */
export function onDay(r: Row, day: string) {
  if (!r.date) return false;
  const end = rowEnd(r) ?? r.date;
  return r.date <= day && day <= end;
}

export type Bucket = "overdue" | "week" | "later" | "undated" | "done";
export const BUCKETS: Bucket[] = ["overdue", "week", "later", "undated", "done"];

/** Where a row goes in the list. "This week" is today and the next 6 days. */
export function bucketOf(r: Row, today = TODAY): Bucket {
  if (r.kind === "task" && r.done) return "done";
  if (isOverdue(r, today)) return "overdue";
  if (!r.date) return "undated";
  // A range that has started but not ended is current.
  const start = r.date < today && (rowEnd(r) ?? r.date) >= today ? today : r.date;
  if (r.kind === "milestone" && (rowEnd(r) ?? r.date) < today) return "done";
  return daysFrom(today, start) <= 6 ? "week" : "later";
}

export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
