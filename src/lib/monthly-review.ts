import { z } from "zod";
import type { BudgetView, Flag } from "@/lib/budget-view";
import type { Measure } from "@/lib/measure";
import type { Status } from "@/lib/qpr";
import { selfSchema } from "@/lib/solo";

/**
 * The monthly project review: where results stand against targets and the workplan, where
 * spending stands against the budget, what needs attention, and the changes the team proposes.
 * A proposed change does nothing until a reviewer who did not propose it approves it; then it is
 * applied to the plan (a year's target, money moved between budget lines, an activity's quarters
 * in the workplan) and recorded in the audit trail. The review is closed with a sign-off.
 *
 * Signing keeps the figures of that day with the review (Tucker, 25 November 2026). A signed review
 * shows what was signed, for good, and not today's numbers.
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
  /** Approved by the person who proposed it, in solo mode (server/solo.ts). */
  selfApproved?: boolean;
  proposedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
};

/** `drafted`: written by AI from the month's figures and not yet edited by a person. */
export type Text = { text: string; by: string; at: string; drafted?: boolean };
/** One target's line on the review: this year's figure against this year's target, and where it stands. */
export type ReviewIndicator = {
  code: string;
  donorCode: string;
  name: string;
  unit: string;
  yearTarget: number;
  year: number;
  quarterValue: number;
  /** A survey target with no figure to give: what to show in its place. */
  note?: string;
  measure?: Measure;
  baseline?: number | null;
  status: Status;
  planned: number[] | null;
  workplanCode: string | null;
  lastAccepted: string | null;
};
/** The figures a review shows: results against targets, money and open items. Kept whole at sign-off. */
export type ReviewFigures = {
  quarter: string;
  year: string;
  indicators: ReviewIndicator[];
  budget: {
    totals: BudgetView["totals"];
    timeGone: number | null;
    period: BudgetView["period"];
    currency: string;
    flagged: { code: string; description: string; flags: Flag[]; spentPct: number | null }[];
  };
  open: { pending: number; queried: number };
};
export type MonthlyReview = {
  month: string;
  summary?: Text;
  attention?: Text;
  changes: Change[];
  /** `figures`: the page's figures as they stood at `at`. A review signed before 25 November 2026 has none. */
  signedOff?: { by: string; at: string; figures?: ReviewFigures };
};

/** The part of what the review screen is given that signing keeps. */
export const figuresOf = (v: ReviewFigures): ReviewFigures => ({ quarter: v.quarter, year: v.year, indicators: v.indicators, budget: v.budget, open: v.open });

/**
 * The figures a person had on the screen, as one line of text. The page sends it with the
 * sign-off and the server compares it with the figures it is about to keep, so what is kept is
 * what the signer read.
 */
export const figuresKey = (f: ReviewFigures) =>
  JSON.stringify([
    f.indicators.map((i) => [i.code, i.year, i.yearTarget, i.status, i.note ?? null]),
    [f.budget.totals.spent, f.budget.totals.approved, f.budget.totals.forecast, f.budget.flagged.length],
    [f.open.pending, f.open.queried],
  ]);

/**
 * Whose figures a reader is looking at. "today": not signed, so as they stand now. "signed": the
 * ones kept at sign-off. "unkept": signed before figures were kept, so today's, and the page says so.
 */
export type FiguresFrom = "today" | "signed" | "unkept";

/**
 * What a reader of the review is shown. A signed review gives the figures kept when it was signed
 * in place of today's. The kept copy is not sent a second time inside the review.
 */
export function shownReview<V extends ReviewFigures & { review: MonthlyReview }>(v: V): V & { figuresFrom: FiguresFrom } {
  const signed = v.review.signedOff;
  if (!signed) return { ...v, figuresFrom: "today" };
  const { figures, ...who } = signed;
  const review = { ...v.review, signedOff: who };
  return figures ? { ...v, ...figures, review, figuresFrom: "signed" } : { ...v, review, figuresFrom: "unkept" };
}

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
    /** Solo mode: the person who proposed it approves it, confirming that (server/solo.ts). */
    self: selfSchema.optional(),
  }),
  z.object({ action: z.literal("withdraw"), id: z.string().min(1) }),
  /** AI drafts the summary and what needs attention from the month's figures. */
  z.object({ action: z.literal("draft") }),
  /** `seen`: the figures on the signer's screen (figuresKey). The sign-off is refused when they have changed since. */
  z.object({ action: z.literal("signoff"), seen: z.string().max(100_000).optional() }),
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
