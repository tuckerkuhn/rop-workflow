import type { Opportunity } from "@/lib/opportunities";
import { DONE, levelFor, roleLabel, stages, stepById, valueOf, type Procurement, type Role } from "@/lib/procurement";

/**
 * Boards: columns of cards, one column per step, for seeing at a glance where everything stands.
 * Cards are not dragged: a procurement moves when its step's checks and signatures are done, a
 * grant when its checklist is, an opportunity by the match call. Each card opens the item's own page.
 */

export { STUCK_DAYS, isStuck } from "@/lib/grants";

export type ProcCard = {
  id: string;
  title: string;
  value: number;
  level: string;
  /** Index into `stages` (Need … Close); -1 once done. */
  stage: number;
  step: string;
  stepTitle: string;
  /** The role the step waits on, as a label. */
  waitingOn: string | null;
  /** The last thing that happened, which is when it reached this step or acted in it. */
  since: string | null;
  project: { code: string; name: string; sandbox: boolean };
};

/** The date of the latest timeline event: the best record the procurement keeps of when its step began. */
const lastEvent = (p: Procurement) => (p.timeline ?? []).reduce<string | null>((m, e) => (e.date && (!m || e.date > m) ? e.date.slice(0, 10) : m), null);

export function procurementCards(items: Procurement[], project: ProcCard["project"]): ProcCard[] {
  return items.map((p) => {
    const step = p.step === DONE ? null : stepById[p.step];
    return {
      id: p.id,
      title: p.title,
      value: valueOf(p),
      level: levelFor(valueOf(p)),
      stage: step ? step.stage : -1,
      step: p.step,
      stepTitle: step?.title ?? "Done",
      waitingOn: step ? roleLabel(step.owner as Role) : null,
      since: lastEvent(p),
      project,
    };
  });
}

/** Procurement columns: the eight stages, then the finished ones. Oldest first within a column, so the longest wait is at the top. */
export function procurementColumns(cards: ProcCard[]) {
  const byAge = (a: ProcCard, b: ProcCard) => (a.since ?? "").localeCompare(b.since ?? "");
  return [
    ...stages.map((name, i) => ({ id: name, items: cards.filter((c) => c.stage === i).sort(byAge) })),
    { id: "done", items: cards.filter((c) => c.stage < 0) },
  ];
}

/** Donor pipeline columns: to decide (split by whether the match brief is drafted), matched, in design, and no match folded at the end. Nearest deadline first. */
export const OPP_COLUMNS = ["noBrief", "briefReady", "match", "designing", "no_match"] as const;
export type OppColumn = (typeof OPP_COLUMNS)[number];
export const oppColumnOf = (o: Pick<Opportunity, "status" | "brief">): OppColumn => (o.status === "tracking" ? (o.brief ? "briefReady" : "noBrief") : o.status);
export function opportunityColumns<T extends Pick<Opportunity, "status" | "brief" | "deadline">>(items: T[]) {
  const byDeadline = (a: T, b: T) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
  return OPP_COLUMNS.map((id) => ({ id, items: items.filter((o) => oppColumnOf(o) === id).sort(byDeadline) }));
}

/** A deadline within this many days shows in clay. */
export const SOON_DAYS = 14;
export const deadlineSoon = (deadline: string | null, today: string) => !!deadline && deadline >= today && Date.parse(deadline) - Date.parse(today) <= SOON_DAYS * 86400000;
