import type { BudgetLine } from "@/lib/budget";
import type { TermsProposal } from "@/server/setup-extract";

/**
 * What setup read from the documents and is waiting for its step (budget, deadlines, rules). Kept
 * in the page's memory, not saved anywhere: creating the project moves setup to the budget step
 * without reloading the page, so it is still here; a reload asks for the documents again.
 */
export type Pending = {
  terms?: TermsProposal;
  termsFile?: string;
  budget?: { file: string; currency: string; lines: BudgetLine[]; sources: string[]; questions: string[] };
};

let pending: Pending = {};
export const getPending = () => pending;
export const setPending = (p: Pending) => {
  pending = { ...pending, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) };
};
export const clearPending = (k: keyof Pending) => {
  pending = { ...pending, [k]: undefined };
};
