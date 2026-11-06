import { z } from "zod";

/**
 * The monthly project review: where results stand against targets and the workplan, where
 * spending stands against the budget, what needs attention, and the changes the team proposes.
 * A proposed change does nothing until a reviewer who did not propose it approves it; then it is
 * applied to the plan (a year's target, money moved between budget lines, an activity's quarters
 * in the workplan) and recorded in the audit trail. The review is closed with a sign-off.
 */

export const monthOk = /^\d{4}-(0[1-9]|1[0-2])$/;

const text = z.string().trim().max(5000);
const reason = z.string().trim().min(10, "Say why, in a sentence or two.").max(1000);
const quarterDay = z.string().regex(/^\d{4}-(01|04|07|10)-01$/, "Quarters are given by their first day, e.g. 2026-10-01.");

export const changeInputSchema = z.discriminatedUnion("kind", [
  /** A year's target for an indicator: the year's share, e.g. 2026 from 44 to 40 jerib. */
  z.object({
    kind: z.literal("target"),
    indicator: z.string().regex(/^IND-\d+$/),
    year: z.string().regex(/^\d{4}$/),
    to: z.number().min(0).max(1e9),
    reason,
  }),
  /** Money moved from one budget line to another (same currency). */
  z.object({
    kind: z.literal("budget"),
    fromLine: z.string().min(1).max(60),
    toLine: z.string().min(1).max(60),
    amount: z.number().positive().max(1e12),
    reason,
  }),
  /** An activity re-planned: the quarters ROP's workplan gives it. */
  z.object({
    kind: z.literal("workplan"),
    activity: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
    quarters: z.array(quarterDay).max(16),
    reason,
  }),
]);
export type ChangeInput = z.infer<typeof changeInputSchema>;

export type ChangeStatus = "proposed" | "approved" | "rejected";
/** `from` is what the plan said when the change was proposed, so reviewers see both sides. */
export type Change = ChangeInput & {
  id: string;
  from: number | string[] | null;
  status: ChangeStatus;
  proposedBy: string;
  proposedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
};

export type Text = { text: string; by: string; at: string };
export type MonthlyReview = {
  month: string;
  summary?: Text;
  attention?: Text;
  changes: Change[];
  signedOff?: { by: string; at: string };
};

export const emptyReview = (month: string): MonthlyReview => ({
  month,
  changes: [],
});

export const reviewActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("summary"), text }),
  z.object({ action: z.literal("attention"), text }),
  z.object({ action: z.literal("propose"), change: changeInputSchema }),
  z.object({
    action: z.literal("decide"),
    id: z.string().min(1),
    decision: z.enum(["approve", "reject"]),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({ action: z.literal("withdraw"), id: z.string().min(1) }),
  z.object({ action: z.literal("signoff") }),
]);
export type ReviewAction = z.infer<typeof reviewActionSchema>;

/** The month's quarter, e.g. "2026-10" → "2026-Q4". */
export const quarterOfMonth = (m: string) => `${m.slice(0, 4)}-Q${Math.floor((Number(m.slice(5, 7)) - 1) / 3) + 1}`;
export const lastMonth = (today: string) => {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, "0")}`;
};

const q = (d: string) => `Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1} ${d.slice(0, 4)}`;
export const quartersLabel = (list: string[]) => (list.length ? [...list].sort().map(q).join(", ") : "none");

/** One line saying what a change does, for lists and the audit trail. */
export function describeChange(c: Change, names: { indicator?: (code: string) => string } = {}): string {
  if (c.kind === "target") return `${names.indicator?.(c.indicator) ?? c.indicator}: ${c.year} target from ${c.from ?? "?"} to ${c.to}`;
  if (c.kind === "budget") return `Move ${Math.round(c.amount).toLocaleString("en-US")} from ${c.fromLine} to ${c.toLine}`;
  return `Re-plan activity ${c.activity}: ${quartersLabel((c.from as string[] | null) ?? [])} → ${quartersLabel(c.quarters)}`;
}
