import type { KoboApproval } from "@/lib/kobo-approval";
import type { FieldSetup } from "@/lib/package";

/**
 * Starting a project from another project's setup, so a new project is not set up from blank
 * screens. Three things carry over, each only where the new project has nothing yet:
 *
 * - the input package and season, as a draft the project manager confirms against the new budget;
 * - the rule for who approves KoboCollect data (for example the Director of MEL and a stand-in);
 * - the targets that take recorded results, with their amounts to be changed.
 *
 * Nothing about people in the field, farmers, records, purchases or money is ever copied.
 */

/** A draft waits in Field activities until the manager saves it; `from` says where it came from. */
export type DraftSetup = FieldSetup & { draft: true; from: string };

/**
 * The package as a draft for the new project. Dates that belong to the old season are dropped. The
 * target the package counts toward is kept only when the new project has a target with that code.
 */
export function setupForCopy(setup: FieldSetup, from: string, targetCodes: string[]): DraftSetup {
  const { windowEnd: _windowEnd, season: _season, village: _village, target, ...rest } = setup;
  void [_windowEnd, _season, _village];
  return { ...rest, items: setup.items.map((i) => ({ ...i })), ...(target && targetCodes.includes(target) ? { target } : {}), draft: true, from };
}

/**
 * The approval rule for the new project: the same choice and the same named people, when they work
 * on the new project too. KoboCollect accounts are never copied: each project matches its own.
 * Null when the rule names someone who is not on the new project, so a person chooses instead.
 */
export function approvalForCopy(rule: KoboApproval, onNewProject: (person: string) => boolean): KoboApproval | null {
  if (rule.who !== "named") return { who: rule.who };
  if (!rule.person || !onNewProject(rule.person)) return null;
  return { who: "named", person: rule.person, ...(rule.standIn && rule.standIn !== rule.person && onNewProject(rule.standIn) ? { standIn: rule.standIn } : {}) };
}

export type CopyResult = {
  from: string;
  /** What was copied. */
  package: boolean;
  approval: boolean;
  targets: number;
  /** What was left alone and why, and what to do next, in order. */
  notes: string[];
};

/** What the person is told after a copy, in the order they should act. */
export function nextSteps(r: Pick<CopyResult, "package" | "approval" | "targets">, had: { package: boolean; approval: boolean; targets: boolean }, approvalMissing: boolean): string[] {
  const out: string[] = [];
  if (r.targets) out.push(`${r.targets} ${r.targets === 1 ? "target was" : "targets were"} copied with the other project's amounts: change each amount to this project's in Setup.`);
  else if (had.targets) out.push("This project already has targets, so none were copied.");
  if (r.package) out.push("The input package is filled in as a draft: check each amount and its budget line, then save it to start Field activities.");
  else if (had.package) out.push("This project already has an input package, so it was left as it is.");
  if (r.approval) out.push("Who approves KoboCollect data was copied. Match each KoboCollect account to a person on the KoboToolbox setup screen.");
  else if (had.approval) out.push("This project already says who approves KoboCollect data, so that was left as it is.");
  else if (approvalMissing) out.push("The person who approves KoboCollect data on the other project does not work on this one: choose who approves here on the KoboToolbox setup screen.");
  return out;
}
