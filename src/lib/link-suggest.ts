import { workplanFor, type BudgetLine, type WorkplanItem } from "@/lib/budget";
import { activityOf } from "@/lib/qpr";

/**
 * Suggested links from each target to the workplan item that delivers it and the budget line that
 * pays for it. Setup never fills these two links. The quarterly report needs the workplan item
 * to tell late work from work planned for later. A suggestion is only a suggestion: nothing here
 * writes: a person confirms each one on Target details. No database in here.
 *
 * The workplan item comes from the activity number in the target's donor code (as the quarterly
 * report reads it); only when that number finds nothing are the words of its result statement
 * matched against workplan titles. The budget line is the one the budget already ties to that
 * workplan item (lib/budget workplanFor, as on Connections).
 */

export type LinkTarget = { code: string; donorCode: string | null; name: string; result: string | null; workplanCode: string | null; budgetRef: string | null };
export type LinkStep = Pick<WorkplanItem, "code" | "activityCode" | "title"> & { indicator?: string | null };
export type LinkLine = Pick<BudgetLine, "code" | "activityCode" | "description">;

export type LinkSuggestion = {
  indicator: string;
  /** Left out when the target already has one, or nothing matches. */
  workplan: { code: string; title: string; reason: string } | null;
  /** Best first. Empty when the target already has one, or nothing matches. */
  budget: { code: string; description: string; reason: string }[];
};

// Words too common in results and titles to tell one activity from another.
const COMMON = new Set(["with", "from", "that", "this", "their", "have", "into", "under", "number", "percent", "total", "through", "other", "each", "more", "will", "were", "been", "also", "project"]);
const wordsOf = (s: string | null | undefined) => new Set((s ?? "").toLowerCase().match(/\p{L}{4,}/gu)?.filter((w) => !COMMON.has(w)) ?? []);

/** The words two texts share and how much of the shorter one they cover. */
function shared(a: string | null | undefined, b: string | null | undefined) {
  const x = wordsOf(a);
  const y = wordsOf(b);
  const both = [...x].filter((w) => y.has(w));
  return { words: both, score: both.length / Math.max(1, Math.min(x.size, y.size)) };
}

const quote = (ws: string[]) => ws.map((w) => `"${w}"`).join(", ");
const isNumber = (s: string) => /^\d+(\.\d+)*$/.test(s);
const under = (step: LinkStep, act: string) => step.activityCode === act || step.code === act || step.code.startsWith(`${act}.`);

/** The workplan item that most likely delivers a target, with why. Null when nothing matches. */
export function workplanForTarget(t: Pick<LinkTarget, "code" | "donorCode" | "name" | "result">, steps: LinkStep[]): LinkSuggestion["workplan"] {
  const act = activityOf(t.donorCode, t.code);
  const same = isNumber(act) ? steps.filter((s) => under(s, act)) : [];
  if (same.length) {
    // Several items under one activity: the one whose wording is closest, else the first.
    const ranked = same.map((s, i) => ({ s, i, m: shared(`${t.name} ${t.result ?? ""}`, `${s.title} ${s.indicator ?? ""}`) })).sort((a, b) => b.m.words.length - a.m.words.length || a.i - b.i);
    const best = ranked[0];
    const why = same.length > 1 && best.m.words.length > 0 ? `, shares the words ${quote(best.m.words)}` : "";
    return { code: best.s.code, title: best.s.title, reason: `same activity number ${act}${why}` };
  }
  // No number to go by: two or more words of the result statement in a workplan title.
  const text = t.result || t.name;
  const best = steps
    .map((s, i) => ({ s, i, m: shared(text, s.title) }))
    .filter((x) => x.m.words.length >= 2 && x.m.score >= 0.3)
    .sort((a, b) => b.m.score - a.m.score || b.m.words.length - a.m.words.length || a.i - b.i)[0];
  return best ? { code: best.s.code, title: best.s.title, reason: `shares the words ${quote(best.m.words)}` } : null;
}

/** The budget lines the budget ties to a workplan item, best first, with why. */
export function linesForStep(step: LinkStep, steps: LinkStep[], lines: LinkLine[]): LinkSuggestion["budget"] {
  return lines
    .map((l, i) => ({ l, i, m: shared(l.description, step.title) }))
    .filter((x) => workplanFor(x.l, steps)?.code === step.code)
    .sort((a, b) => b.m.score - a.m.score || a.i - b.i)
    .map(({ l, m }) => ({ code: l.code, description: l.description, reason: `pays for workplan item ${step.code}: same activity number ${l.activityCode}${m.words.length ? `, shares the words ${quote(m.words)}` : ""}` }));
}

/**
 * For each target missing a workplan item or a budget line, what to suggest. A target with a
 * workplan item already gets its budget line from that item. Targets with nothing to suggest are
 * left out.
 */
export function suggestLinks(targets: LinkTarget[], workplan: LinkStep[], lines: LinkLine[]): LinkSuggestion[] {
  // A consortium workplan can list an item once per partner: one per code.
  const seen = new Set<string>();
  const steps = workplan.filter((w) => !seen.has(w.code) && seen.add(w.code));
  const out: LinkSuggestion[] = [];
  for (const t of targets) {
    if (t.workplanCode && t.budgetRef) continue;
    const workplan = t.workplanCode ? null : workplanForTarget(t, steps);
    const step = t.workplanCode ? steps.find((s) => s.code === t.workplanCode) : workplan ? steps.find((s) => s.code === workplan.code) : undefined;
    const budget = t.budgetRef || !step ? [] : linesForStep(step, steps, lines);
    if (workplan || budget.length) out.push({ indicator: t.code, workplan, budget });
  }
  return out;
}
