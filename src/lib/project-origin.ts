import { z } from "zod";

/**
 * Where a project comes from: the won proposal (lib/funding-proposals) and its opportunity
 * (lib/opportunities), so what the team wrote before the award is not typed again. Kept in the
 * project's project_state under ORIGIN_KEY; the proposal keeps the project's code in turn.
 */

export const ORIGIN_KEY = "origin";

/** A call document, by reference to the organization's file store: never a copy. */
export type OriginDoc = { hash: string; name: string; type: string; size: number; label: string };

export type ProjectOrigin = {
  /** Null when the project came from a matched opportunity that had no proposal. */
  proposalId: string | null;
  opportunityId: string | null;
  title: string;
  donor: string;
  /** The reasons the donor was given to choose the organization: context, never results. */
  winThemes: string[];
  documents: OriginDoc[];
  /** The day the proposal was recorded as won (or the opportunity matched). */
  decidedAt: string | null;
  /** The award as the person confirmed it at setup. */
  currency: string;
  ceiling: number | null;
  by: string;
  at: string;
};

/** What setup opens with: editable defaults, saved only when the person creates the project. */
export type SetupDefaults = {
  proposalId: string | null;
  opportunityId: string | null;
  title: string;
  name: string;
  donor: string;
  currency: string;
  ceiling: number | null;
  startDate: string | null;
  country: string | null;
  winThemes: string[];
  documents: number;
  /** What the records do not hold, for the person to settle. */
  missing: string[];
};

/** What the browser sends with the new project: which record it comes from and the award as confirmed. */
export const originChoice = z
  .object({
    proposalId: z.string().trim().max(40).nullable().default(null),
    opportunityId: z.string().trim().max(40).nullable().default(null),
    currency: z.string().trim().regex(/^[A-Z]{3}$/, "Give the currency as a three-letter code, such as USD."),
    ceiling: z.number().min(0).max(1e11).nullable().default(null),
  })
  .refine((o) => !!o.proposalId || !!o.opportunityId, "Say which proposal the project comes from.");
export type OriginChoice = z.infer<typeof originChoice>;

/** Whether a proposal offers "Set up the project from this proposal": won and not set up yet, for a person who may set up projects. */
export const offersSetUp = (p: { outcome: string; projectCode?: string }, maySetUp: boolean) => p.outcome === "won" && !p.projectCode && maySetUp;

// ---------- The budget against the award ceiling ----------

/** The budget's total against the award ceiling confirmed at setup. `over` is null when the two are in different currencies. */
export type CeilingCheck = { currency: string; ceiling: number; total: number; budgetCurrency: string; over: number | null };

export function againstCeiling(total: number, budgetCurrency: string, award: Pick<ProjectOrigin, "currency" | "ceiling"> | null): CeilingCheck | null {
  if (!award || award.ceiling === null) return null;
  return { currency: award.currency, ceiling: award.ceiling, total, budgetCurrency, over: budgetCurrency === award.currency ? Math.round((total - award.ceiling) * 100) / 100 : null };
}

const amount = (currency: string, n: number) => `${currency} ${Math.round(n).toLocaleString("en-US")}`;

/**
 * What the budget shows beside its total: the ceiling, and a plain warning when the total is above
 * it. A warning, never a block: the agreement may differ from the proposal.
 */
export function ceilingWords(c: CeilingCheck): { ceiling: string; warning: string | null; line: string } {
  const ceiling = `Award ceiling: ${amount(c.currency, c.ceiling)}`;
  if (c.over === null) {
    const note = `The budget is in ${c.budgetCurrency} and the award ceiling in ${c.currency}, so the two are not compared.`;
    return { ceiling, warning: null, line: `${ceiling}. ${note}` };
  }
  const warning = c.over >= 1 ? `The budget total is ${amount(c.currency, c.over)} above the award ceiling. Check it against the signed agreement, which may differ from the proposal.` : null;
  const diff = c.over >= 1 ? `${amount(c.currency, c.over)} above it` : c.over <= -1 ? `${amount(c.currency, -c.over)} under it` : "the same";
  return { ceiling, warning, line: `${ceiling}. Budget total ${amount(c.currency, c.total)}: ${diff}.` };
}

/**
 * The currency of a budget read from a sheet: the one the sheet names, else the award's. The
 * sheet reader (lib/budget parseBudget) falls back to USD when the sheet names none.
 */
export function sheetCurrency(read: string, sheetText: string, award: string | null): string {
  if (!award || read === award) return read;
  return new RegExp(`\\b${read}\\b`, "i").test(sheetText) ? read : award;
}
