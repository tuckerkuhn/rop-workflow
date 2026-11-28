import { z } from "zod";
import { ruleSchema, ruleText, type Rule } from "@/lib/eligibility";

/**
 * Farmer selection: the written rule for who takes part, and for each farmer the decision, the
 * reason and who made it. "Who was chosen, and by what rule?" is a standard audit question, and the
 * first complaint a project hears is from someone who was left out. Kept in project state (key
 * "selection"). The criteria are numbered by version: a decision records the version it was made
 * under, so a later change to the rule never rewrites why someone was chosen.
 */

/** `rule`: a rule the app checks against the farmer's record (lib/eligibility); its text is written from it. */
export type Criterion = { id: string; text: string; rule?: Rule };
/**
 * What was decided for a farmer. Selected: takes part. Waitlisted: meets every rule but there is
 * no place now (places full); can be selected later. Did not qualify: fails at least one rule.
 */
export type Outcome = "selected" | "waitlisted" | "not_qualified";
/**
 * As shown: an Outcome, or "not_selected" for a decision recorded before waitlists existed that
 * cannot be placed safely (every rule ticked, or no record of which rule failed). Never stored.
 */
export type Shown = Outcome | "not_selected";
export const OUTCOMES: Outcome[] = ["selected", "waitlisted", "not_qualified"];
export const outcomeLabel: Record<Shown, string> = { selected: "Selected", waitlisted: "Waitlisted", not_qualified: "Did not qualify", not_selected: "Not selected" };
/**
 * `of`: how many rules were in force when it was made; `exception`: selected without meeting every
 * one of them. Both are fixed at the time, so a later change to the rules never rewrites them.
 * `earlier`: the decisions it replaced, each with why it changed, oldest first.
 */
export type Decision = {
  /** Kept for older readers: true only when the outcome is "selected". */
  selected: boolean;
  /** Missing on decisions recorded before waitlists: see outcomeOf. */
  outcome?: Outcome;
  met: string[];
  reason: string;
  version: number;
  by: string;
  byName: string;
  on: string;
  of?: number;
  exception?: boolean;
  /** R2-20: an exception confirmed by a second person who may decide; until then the farmer is not served. */
  confirmed?: { by: string; byName: string; on: string };
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
    criteria: z.array(text(5, 300, "Write each rule in a few words.")).max(12),
    /** Rules checked against each farmer's record (lib/eligibility), at most one of each kind. */
    checks: z
      .array(ruleSchema)
      .max(12)
      .refine((l) => new Set(l.map((r) => `${r.kind}:${r.package ?? ""}`)).size === l.length, "Each kind of checked rule is set once for each package.")
      .optional(),
    /** Needed once any farmer has been decided: why the rule is changing. */
    reason: z.string().trim().max(600).default(""),
  }),
  /** `change`: needed when the farmer already has a decision: why it is being changed. */
  z.object({ action: z.literal("decide"), farmer: z.string().trim().min(1).max(40), outcome: z.enum(["selected", "waitlisted", "not_qualified"], "Choose Selected, Waitlisted or Did not qualify."), met: z.array(z.string()).max(12), reason: z.string().trim().max(1000).default(""), change: z.string().trim().max(600).default("") }),
  z.object({ action: z.literal("undo"), farmer: z.string().trim().min(1).max(40), reason: text(10, 600, "Say why the decision is being reopened.") }),
  z.object({ action: z.literal("confirm"), farmer: z.string().trim().min(1).max(40) }),
]);
export type SelectionAction = z.infer<typeof selectionAction>;

/**
 * Why a decision cannot be recorded, or null. Waitlisted and Did not qualify always need a reason:
 * the farmer may ask, and so may an auditor. Waitlisted is for a farmer who meets every rule; Did
 * not qualify for one who fails at least one (left unticked), so the list says which rule. Taking
 * someone in who does not meet every rule is an exception, and an exception needs its reason too.
 */
export function decisionProblem(s: Selection, a: { farmer?: string; outcome: Outcome; met: string[]; reason: string; change?: string }): string | null {
  if (!s.criteria.length) return "Write the selection rules first.";
  if (a.farmer && s.decisions[a.farmer] && (a.change ?? "").trim().length < 10) return "This farmer has already been decided. Say why the decision is changing.";
  const unknown = a.met.filter((id) => !s.criteria.some((c) => c.id === id));
  if (unknown.length) return "Those rules have changed. Open the farmer again.";
  const all = s.criteria.every((c) => a.met.includes(c.id));
  const reason = a.reason.trim().length >= 10;
  if (a.outcome === "waitlisted") {
    if (!all) return "Waitlisted is for farmers who meet every rule. Tick the rules they meet, or record that they did not qualify.";
    if (!reason) return "Say why this farmer is waitlisted, for example that the places are full.";
  }
  if (a.outcome === "not_qualified") {
    if (all) return "This farmer meets every rule. Untick the rule they do not meet, or waitlist them.";
    if (!reason) return "Say why this farmer did not qualify. They may ask, and so may an auditor.";
  }
  if (a.outcome === "selected" && !all && !reason) return "This farmer does not meet every rule. Say why they are selected anyway.";
  return null;
}

/** The rules a decision left unticked, when they are the rules in force now; empty otherwise. */
export const failedRules = (s: Selection, d: Decision) => (d.version === s.version ? s.criteria.filter((c) => !d.met.includes(c.id)) : []);

/**
 * The outcome of a decision. Older decisions have no outcome: selected stays Selected; not selected
 * with a rule left unticked when it was made becomes Did not qualify (the record shows the failed
 * rule); any other not-selected decision stays "Not selected", because nothing on it says whether
 * the farmer qualified, and guessing could wrongly tell someone they were waitlisted. Nothing stored
 * is rewritten.
 */
export function outcomeOf(s: Selection, d: Decision): Shown {
  if (d.outcome) return d.outcome;
  if (d.selected) return "selected";
  const failed = d.of !== undefined ? d.met.length < d.of : d.version === s.version && !s.criteria.every((c) => d.met.includes(c.id));
  return failed ? "not_qualified" : "not_selected";
}

/** Farmer id to outcome, for projects that use selection (rules written); null for those that do not. */
/** An exception still waiting for a second person (R2-20). */
export const waitingConfirmation = (s: Selection, d: Decision) => isException(s, d) && !d.confirmed;

/** Outcomes for the rest of the app: an exception not yet confirmed waits, as if waitlisted (R2-20). */
export function outcomesById(s: Selection): Record<string, Shown> | null {
  if (!s.criteria.length) return null;
  return Object.fromEntries(Object.entries(s.decisions).map(([id, d]) => [id, waitingConfirmation(s, d) ? "waitlisted" : outcomeOf(s, d)]));
}
/**
 * Review round 1, ISS-18: farmers are trained and given inputs while no selection rule is saved.
 * Flagged (never blocked) on the screens where training and hand-outs start, until the rule is
 * written. `outcomes`: outcomesById, null when no rule is saved. Null when there is nothing to say.
 */
export function noSelectionRule(outcomes: Record<string, Shown> | null, farmers: readonly { step: string }[]): string | null {
  if (outcomes) return null;
  const n = farmers.filter((f) => f.step !== "removed").length;
  if (!n) return null;
  return `No farmer selection rule is saved for this project, yet ${n === 1 ? "1 farmer is" : `${n} farmers are`} being trained and given inputs. The project manager or a plan approver writes the rule in Farmer selection.`;
}
/** The farmer steps where training or a hand-out starts: where the missing rule is flagged on the record. */
export const STARTS_WITHOUT_RULE = new Set(["train", "distribute"]);

/** Whether the field team should train and serve this farmer: no decision yet, or selected. */
export const inFieldQueue = (o: Shown | undefined) => !o || o === "selected";

const held: Record<Exclude<Shown, "selected">, string> = { waitlisted: "waitlisted", not_qualified: "marked Did not qualify", not_selected: "marked Not selected" };
/**
 * Why a farmer may not be moved along the field path or given inputs, or null. Enforced on the
 * server wherever a farmer moves (an accepted KoboCollect form, an approved distribution, the
 * contribution), not only by the Field activities page's filter. `outcomes`: outcomesById, null
 * when the project does not use selection.
 */
export function selectionHold(outcomes: Record<string, Shown> | null, farmer: string | null | undefined): string | null {
  const o = farmer ? outcomes?.[farmer] : undefined;
  return !o || inFieldQueue(o) ? null : `${farmer} is ${held[o as Exclude<Shown, "selected">]} in Farmer selection`;
}

export type SelectionCounts = { total: number; selected: number; waitlisted: number; notQualified: number; notSelected: number; undecided: number; women: number; womenSelected: number; exceptions: number; exceptionsWaiting: number };
/** The counts a report asks for. `farmers` is the project's list; a decision for someone no longer on it is not counted. `notSelected`: older decisions not placed (outcomeOf). */
export function selectionCounts(s: Selection, farmers: { id: string; gender: string }[]): SelectionCounts {
  const c: SelectionCounts = { total: farmers.length, selected: 0, waitlisted: 0, notQualified: 0, notSelected: 0, undecided: 0, women: 0, womenSelected: 0, exceptions: 0, exceptionsWaiting: 0 };
  for (const f of farmers) {
    const d = s.decisions[f.id];
    const woman = f.gender === "Female";
    if (woman) c.women++;
    if (!d) {
      c.undecided++;
      continue;
    }
    const o = outcomeOf(s, d);
    if (o === "selected") {
      c.selected++;
      if (woman) c.womenSelected++;
      if (isException(s, d)) c.exceptions++;
      if (waitingConfirmation(s, d)) c.exceptionsWaiting++;
    } else if (o === "waitlisted") c.waitlisted++;
    else if (o === "not_qualified") c.notQualified++;
    else c.notSelected++;
  }
  return c;
}

/** Selected without meeting every rule in force when the decision was made (fixed then; worked out for older records). */
export const isException = (s: Selection, d: Decision) => d.selected && (d.exception ?? (d.version === s.version && !s.criteria.every((c) => d.met.includes(c.id))));
/**
 * The rules as saved: the written ones, then the checked ones in words (lib/eligibility). Null and
 * a reason when they cannot be saved.
 */
export function rulesFrom(criteria: string[], checks: Rule[] = [], packages: { key: string; name: string }[] = []): { list: { text: string; rule?: Rule }[] } | { problem: string } {
  const unknown = checks.find((r) => r.package && !packages.some((p) => p.key === r.package));
  if (unknown) return { problem: "A rule names a package this project does not offer. Reload the page." };
  const list = [...criteria.map((text) => ({ text })), ...checks.map((rule) => ({ text: ruleText(rule, packages.find((p) => p.key === rule.package)?.name), rule }))];
  if (!list.length) return { problem: "Write at least one rule." };
  if (list.length > 12) return { problem: "Twelve rules at most." };
  if (new Set(list.map((r) => r.text.toLowerCase())).size !== list.length) return { problem: "Each rule is written once." };
  return { list };
}

/** Whether two lists hold the same rules, in any order. */
export const sameRules = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
/** Decided under an earlier version of the rules: worth a second look, never changed silently. */
export const isStale = (s: Selection, d: Decision) => d.version !== s.version;
