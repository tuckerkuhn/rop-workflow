import { z } from "zod";
import { withoutNames } from "@/lib/personal-text";
import { quarterRange } from "@/lib/results";

/**
 * Learning and closing: lessons recorded as the project runs (what happened, what we learned,
 * what we will do differently, and whether it was applied), and the close-out checklist that
 * ends a project, each item with its evidence and who confirmed it, then a final sign-off.
 */

export const LESSON_AREAS = ["Programme", "MEL", "Procurement", "Finance", "Safeguards", "Partnerships", "Operations"] as const;
export type Lesson = {
  id: string;
  date: string;
  area: (typeof LESSON_AREAS)[number];
  happened: string;
  lesson: string;
  action: string;
  by: string;
  byName: string;
  applied: { on: string; how: string; by: string; byName: string } | null;
};

/** What closing a project needs, from the donor's and ROP's rules. */
export const CLOSEOUT_ITEMS = [
  { id: "finalReport", label: "Final narrative report sent to the donor", who: "report-release", hint: "The completion report, with its indicator table and evidence links." },
  { id: "finalFinancial", label: "Final financial report sent, and unspent funds returned or agreed", who: "finance", hint: "Budget and spending for the whole agreement." },
  { id: "procurementsClosed", label: "Every procurement closed: nothing owed either way", who: "procurement", hint: "Checked automatically from Procurement." },
  { id: "assets", label: "Project equipment handed over or disposed of as the agreement says", who: "finance", hint: "Asset register with handover or disposal records." },
  { id: "results", label: "Every result accepted or withdrawn, none waiting for MEL", who: "mel", hint: "Checked automatically from Results." },
  { id: "lessons", label: "Lessons reviewed with the team and shared", who: "plan-approver", hint: "The lessons record, reviewed at a closing meeting." },
  { id: "staff", label: "Project staff contracts ended or moved, final pay and leave settled", who: "hr", hint: "From the HR record." },
  { id: "records", label: "Records archived for the retention period", who: "plan-approver", hint: "Project folder locked in your file store; the organization's retention rule applies." },
  { id: "donorClosure", label: "Donor confirmed the agreement is closed", who: "plan-approver", hint: "The donor's closure letter or email." },
] as const;
export type CloseoutId = (typeof CLOSEOUT_ITEMS)[number]["id"];
export type CloseoutTick = { on: string; by: string; byName: string; evidence: string; note: string };
export type Learning = { lessons: Lesson[]; closeout: Partial<Record<CloseoutId, CloseoutTick>>; closed: { on: string; by: string; byName: string } | null };
export const EMPTY_LEARNING: Learning = { lessons: [], closeout: {}, closed: null };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const learningAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("lesson"),
    date: day,
    area: z.enum(LESSON_AREAS),
    happened: z.string().trim().min(10, "Say what happened.").max(2000),
    lesson: z.string().trim().min(10, "Say what was learned.").max(2000),
    action_: z.string().trim().min(5, "Say what will be done differently.").max(1000),
  }),
  z.object({ action: z.literal("applied"), id: z.string(), how: z.string().trim().min(10, "Say how it was applied.").max(1000) }),
  z.object({ action: z.literal("tick"), item: z.enum(CLOSEOUT_ITEMS.map((i) => i.id) as [CloseoutId, ...CloseoutId[]]), evidence: z.string().trim().max(600).default(""), note: z.string().trim().max(600).default("") }),
  z.object({ action: z.literal("untick"), item: z.enum(CLOSEOUT_ITEMS.map((i) => i.id) as [CloseoutId, ...CloseoutId[]]), note: z.string().trim().min(10, "Say why it is reopened.").max(600) }),
  z.object({ action: z.literal("close") }),
]);
export type LearningAction = z.infer<typeof learningAction>;

/** A lesson as the quarterly report shows it: what was recorded, without who recorded it. */
export type ReportLesson = Pick<Lesson, "id" | "date" | "area" | "happened" | "lesson" | "action">;

/** The lessons recorded in a quarter (by their date), oldest first, for that quarter's report. */
export function lessonsInQuarter(lessons: Lesson[], quarter: string, range: { from: string; to: string } = quarterRange(quarter)): ReportLesson[] {
  const { from, to } = range;
  return lessons
    .filter((l) => l.date >= from && l.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => ({ id: l.id, date: l.date, area: l.area, happened: l.happened, lesson: l.lesson, action: l.action }));
}

const sentence = (s: string) => {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/**
 * A lesson as one paragraph of the report's Lessons Learned section. Names of people are taken
 * out: the report goes to the donor.
 */
export function lessonForReport(l: ReportLesson): string {
  return withoutNames(`${l.area}. What happened: ${sentence(l.happened)} What we learned: ${sentence(l.lesson)} What we will do differently: ${sentence(l.action)}`);
}
