import { z } from "zod";

/**
 * Farmer selection: the written rule for who takes part, and for each farmer the decision, the
 * reason and who made it. "Who was chosen, and by what rule?" is a standard audit question, and the
 * first complaint a project hears is from someone who was left out. Kept in project state (key
 * "selection"). The criteria are numbered by version: a decision records the version it was made
 * under, so a later change to the rule never rewrites why someone was chosen.
 */

export type Criterion = { id: string; text: string };
/**
 * `of`: how many rules were in force when it was made; `exception`: selected without meeting every
 * one of them. Both are fixed at the time, so a later change to the rules never rewrites them.
 * `earlier`: the decisions it replaced, each with why it changed, oldest first.
 */
export type Decision = {
  selected: boolean;
  met: string[];
  reason: string;
  version: number;
  by: string;
  byName: string;
  on: string;
  of?: number;
  exception?: boolean;
  earlier?: { decision: Omit<Decision, "earlier">; why: string; by: string; byName: string; on: string }[];
};
export type Selection = {
  /** How people heard they could apply: an open call is the defence against "only friends were told". */
  outreach: string;
  criteria: Criterion[];
  version: number;
  criteriaBy: { by: string; byName: string; on: string } | null;
  decisions: Record<string, Decision>;
};
export const EMPTY_SELECTION: Selection = { outreach: "", criteria: [], version: 0, criteriaBy: null, decisions: {} };

const text = (min: number, max: number, msg: string) => z.string().trim().min(min, msg).max(max);
export const selectionAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("criteria"),
    outreach: text(10, 1000, "Say how people heard they could apply."),
    criteria: z
      .array(text(5, 300, "Write each rule in a few words."))
      .min(1, "Write at least one rule.")
      .max(12)
      .refine((l) => new Set(l.map((t) => t.toLowerCase())).size === l.length, "Each rule is written once."),
    /** Needed once any farmer has been decided: why the rule is changing. */
    reason: z.string().trim().max(600).default(""),
  }),
  /** `change`: needed when the farmer already has a decision: why it is being changed. */
  z.object({ action: z.literal("decide"), farmer: z.string().trim().min(1).max(40), selected: z.boolean(), met: z.array(z.string()).max(12), reason: z.string().trim().max(1000).default(""), change: z.string().trim().max(600).default("") }),
  z.object({ action: z.literal("undo"), farmer: z.string().trim().min(1).max(40), reason: text(10, 600, "Say why the decision is being reopened.") }),
]);
export type SelectionAction = z.infer<typeof selectionAction>;

/**
 * Why a decision cannot be recorded, or null. Leaving someone out always needs a reason. Taking
 * someone in who does not meet every rule is an exception, and an exception needs its reason too.
 */
export function decisionProblem(s: Selection, a: { farmer?: string; selected: boolean; met: string[]; reason: string; change?: string }): string | null {
  if (!s.criteria.length) return "Write the selection rules first.";
  if (a.farmer && s.decisions[a.farmer] && (a.change ?? "").trim().length < 10) return "This farmer has already been decided. Say why the decision is changing.";
  const unknown = a.met.filter((id) => !s.criteria.some((c) => c.id === id));
  if (unknown.length) return "Those rules have changed. Open the farmer again.";
  const all = s.criteria.every((c) => a.met.includes(c.id));
  const reason = a.reason.trim().length >= 10;
  if (!a.selected && !reason) return "Say why this farmer is not selected. They may ask, and so may an auditor.";
  if (a.selected && !all && !reason) return "This farmer does not meet every rule. Say why they are selected anyway.";
  return null;
}

export type SelectionCounts = { total: number; selected: number; notSelected: number; undecided: number; women: number; womenSelected: number; exceptions: number };
/** The counts a report asks for. `farmers` is the project's list; a decision for someone no longer on it is not counted. */
export function selectionCounts(s: Selection, farmers: { id: string; gender: string }[]): SelectionCounts {
  const c: SelectionCounts = { total: farmers.length, selected: 0, notSelected: 0, undecided: 0, women: 0, womenSelected: 0, exceptions: 0 };
  for (const f of farmers) {
    const d = s.decisions[f.id];
    const woman = f.gender === "Female";
    if (woman) c.women++;
    if (!d) c.undecided++;
    else if (d.selected) {
      c.selected++;
      if (woman) c.womenSelected++;
      if (isException(s, d)) c.exceptions++;
    } else c.notSelected++;
  }
  return c;
}

/** Selected without meeting every rule in force when the decision was made (fixed then; worked out for older records). */
export const isException = (s: Selection, d: Decision) => d.selected && (d.exception ?? (d.version === s.version && !s.criteria.every((c) => d.met.includes(c.id))));
/** Whether two lists hold the same rules, in any order. */
export const sameRules = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
/** Decided under an earlier version of the rules: worth a second look, never changed silently. */
export const isStale = (s: Selection, d: Decision) => d.version !== s.version;
