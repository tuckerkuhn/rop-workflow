import { z } from "zod";
import type { Spend } from "@/lib/qpr";

/**
 * What each donor funds on a project, and what a donor is shown about money.
 *
 * A project has one budget and can have more than one donor. This says, per donor, which budget
 * lines its grant pays for and which lines are cost share (paid by Roots of Peace or a partner and
 * reported to that donor as its match). It is kept beside the project's other settings
 * (project_state "donor-funding"); the budget itself is not changed or split.
 *
 * A donor sees money only as a released report gave it: the figures are the released copy's own
 * (lib/qpr Spend), never this week's import. Amounts stay in the agreement's currency: nothing is
 * converted here.
 */

export const DONOR_FUNDING_KEY = "donor-funding";

/** `lines`: "all" for the whole budget, or the codes of the lines the grant pays for. `share`: the cost-share lines. */
export type DonorFunding = { lines: "all" | string[]; share: string[] };
/** Per donor id. A donor not listed has no setting yet. */
export type DonorFundingBook = Record<string, DonorFunding>;

export const donorFundingSchema = z.object({
  lines: z.union([z.literal("all"), z.array(z.string().trim().min(1).max(60)).max(2000)]),
  share: z.array(z.string().trim().min(1).max(60)).max(2000).default([]),
});

/**
 * The setting that applies to a donor. Unset on a project with one donor, the grant pays for the
 * whole budget: there is nobody else it could belong to. Unset with several donors, nothing is
 * assumed and nothing about money is shown until someone says.
 */
export function fundingFor(book: DonorFundingBook, donorId: string, donorCount: number): DonorFunding | null {
  return book[donorId] ?? (donorCount === 1 ? { lines: "all", share: [] } : null);
}

/** A line's place in a donor's view: paid by the grant, cost share, or not theirs. A line marked as cost share is never also counted as paid by the grant. */
export function roleOf(f: DonorFunding, code: string): "funded" | "share" | null {
  if (f.share.includes(code)) return "share";
  return f.lines === "all" || f.lines.includes(code) ? "funded" : null;
}

export type LineInfo = { code: string; description: string; activityCode: string | null; activity: string | null };
export type MoneyLine = { code: string; description: string; activity: string | null; approved: number; spent: number; inQuarter: number };
export type MoneyBlock = { lines: MoneyLine[]; approved: number; spent: number; inQuarter: number };
export type DonorMoney = {
  currency: string;
  /** Paid by this donor's grant. */
  funded: MoneyBlock;
  /** Cost share reported to this donor; null when none is marked. */
  share: MoneyBlock | null;
  /**
   * Indirect costs as the report gives them, or null. Only for a grant that pays for the whole
   * budget, in a report whose figures include overhead for one agreement phase: then it is the
   * report's total less its lines. For a grant that pays for some lines it is not worked out here.
   */
  indirect: { approved: number; spent: number } | null;
  /** Why indirect costs are not shown, when they are not. */
  indirectNote: "none" | "partial" | "phases" | null;
  /** True when the figures come from Finance's imported workbook; false when only the budget file's own totals were there. */
  fromImport: boolean;
};

const round = (n: number) => Math.round(n * 100) / 100;

function block(lines: MoneyLine[]): MoneyBlock {
  return { lines, approved: round(lines.reduce((t, l) => t + l.approved, 0)), spent: round(lines.reduce((t, l) => t + l.spent, 0)), inQuarter: round(lines.reduce((t, l) => t + l.inQuarter, 0)) };
}

/** A donor's money from one released report's figures. Lines keep the budget's order (`info`); a line the report has and the budget no longer lists comes last under its code. */
export function donorMoney(spend: Spend, f: DonorFunding, info: LineInfo[]): DonorMoney {
  const byCode = new Map(info.map((l) => [l.code, l]));
  const order = [...info.map((l) => l.code).filter((c) => c in spend.byLine), ...Object.keys(spend.byLine).filter((c) => !byCode.has(c))];
  const line = (code: string): MoneyLine => {
    const v = spend.byLine[code];
    const i = byCode.get(code);
    return { code, description: i?.description ?? code, activity: i?.activity ?? null, approved: round(v.budget), spent: round(v.actual), inQuarter: round(v.quarter) };
  };
  const funded = block(order.filter((c) => roleOf(f, c) === "funded").map(line));
  const shared = order.filter((c) => roleOf(f, c) === "share").map(line);
  const whole = f.lines === "all";
  const lineTotal = Object.values(spend.byLine).reduce((t, v) => ({ budget: t.budget + v.budget, actual: t.actual + v.actual }), { budget: 0, actual: 0 });
  const over = { approved: round(spend.budget - lineTotal.budget), spent: round(spend.cumulative - lineTotal.actual) };
  const canShow = whole && spend.withOverhead && spend.phases.length === 1 && over.approved > 0;
  return {
    currency: spend.currency,
    funded,
    share: shared.length ? block(shared) : null,
    indirect: canShow ? over : null,
    indirectNote: canShow ? null : !whole ? "partial" : spend.withOverhead && spend.phases.length > 1 ? "phases" : "none",
    fromImport: spend.source.kind === "import",
  };
}

/** The grant's total as the donor sees it: its lines, and indirect costs where the report gives them. */
export const grantTotal = (m: DonorMoney) => ({ approved: round(m.funded.approved + (m.indirect?.approved ?? 0)), spent: round(m.funded.spent + (m.indirect?.spent ?? 0)) });
