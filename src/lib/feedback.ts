import { z } from "zod";
import { daysBetween as days } from "@/lib/preflight";

/**
 * The feedback and complaints log: what farmers, community members, suppliers and staff told the
 * project, and what the project answered. Most institutional donors ask how complaints are
 * received and answered, and an auditor asks to see the record. Kept in project state (key
 * "feedback"); no names are written, and a serious matter is read only by the people who must act.
 */

export const FEEDBACK_KINDS = ["complaint", "suggestion", "question", "thanks"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const KIND_LABEL: Record<FeedbackKind, string> = { complaint: "Complaint", suggestion: "Suggestion", question: "Question", thanks: "Thanks" };

export const FEEDBACK_FROM = ["farmer", "community member", "supplier", "staff", "other"] as const;
export const FEEDBACK_CHANNELS = ["in person", "phone", "community meeting", "suggestion box", "message", "other"] as const;

/** Days the project gives itself to answer, unless the donor's agreement says otherwise. */
export const ANSWER_DAYS = 14;

export type FeedbackEntry = {
  id: string;
  date: string;
  kind: FeedbackKind;
  from: (typeof FEEDBACK_FROM)[number];
  channel: (typeof FEEDBACK_CHANNELS)[number];
  place: string;
  about: string;
  /** A serious matter (harm to a person, abuse, fraud, a safety risk): read only by plan approvers, administrators and the person who recorded it. */
  serious: boolean;
  by: string;
  byName: string;
  answer: { on: string; text: string; by: string; byName: string } | null;
};
export type FeedbackLog = { entries: FeedbackEntry[] };
export const EMPTY_FEEDBACK: FeedbackLog = { entries: [] };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const feedbackAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("record"),
    date: day,
    kind: z.enum(FEEDBACK_KINDS),
    from: z.enum(FEEDBACK_FROM),
    channel: z.enum(FEEDBACK_CHANNELS),
    place: z.string().trim().max(120).default(""),
    about: z.string().trim().min(10, "Say what the person told you.").max(2000),
    serious: z.boolean().default(false),
  }),
  z.object({ action: z.literal("answer"), id: z.string(), text: z.string().trim().min(10, "Say what was done or answered.").max(2000) }),
]);
export type FeedbackAction = z.infer<typeof feedbackAction>;


/** Thanks need no answer; everything else does. */
export const needsAnswer = (e: Pick<FeedbackEntry, "kind" | "answer">) => e.kind !== "thanks" && !e.answer;
/** Not answered within the days the project gives itself. */
export const overdue = (e: Pick<FeedbackEntry, "kind" | "answer" | "date">, today: string) => needsAnswer(e) && days(e.date, today) > ANSWER_DAYS;

/** The numbers a report asks for, over a period (inclusive). */
export function feedbackSummary(entries: FeedbackEntry[], from: string, to: string, today: string) {
  const inPeriod = entries.filter((e) => e.date >= from && e.date <= to);
  const toAnswer = inPeriod.filter((e) => e.kind !== "thanks");
  const answered = toAnswer.filter((e) => e.answer);
  const took = answered.map((e) => Math.max(0, days(e.date, e.answer!.on)));
  return {
    /** Everything recorded in the period, thank-you notes included. */
    received: inPeriod.length,
    /** Thank-you notes: recorded, but nothing to answer. */
    thanks: inPeriod.length - toAnswer.length,
    complaints: inPeriod.filter((e) => e.kind === "complaint").length,
    answered: answered.length,
    open: toAnswer.length - answered.length,
    overdue: toAnswer.filter((e) => overdue(e, today)).length,
    /** Average days from received to answered, or null with nothing answered. */
    averageDays: took.length ? Math.round(took.reduce((a, b) => a + b, 0) / took.length) : null,
  };
}

/** Who reads a serious entry's text: the person who recorded it, plan approvers and administrators. */
export const mayReadSerious = (u: { id: string; admin?: boolean; project: readonly string[] }, e: Pick<FeedbackEntry, "by">) => !!u.admin || u.project.includes("plan-approver") || u.id === e.by;

/** An entry as one person may see it: a serious matter's words are withheld from everyone else. */
export function forViewer(e: FeedbackEntry, u: { id: string; admin?: boolean; project: readonly string[] }): FeedbackEntry & { withheld: boolean } {
  if (!e.serious || mayReadSerious(u, e)) return { ...e, withheld: false };
  return { ...e, about: "", place: "", answer: e.answer ? { ...e.answer, text: "" } : null, withheld: true };
}

/** To answer first: open and oldest at the top, then answered, newest first. */
export function sortFeedback<T extends FeedbackEntry>(entries: T[]): T[] {
  const open = entries.filter(needsAnswer).sort((a, b) => a.date.localeCompare(b.date));
  const rest = entries.filter((e) => !needsAnswer(e)).sort((a, b) => b.date.localeCompare(a.date));
  return [...open, ...rest];
}
