import { z } from "zod";
import { HR_ROLES, ROLE_LABEL, type HrRole } from "@/lib/hr";

/**
 * Proposals: the work between "this opportunity is a match" and "submitted". A donor's call for
 * proposals becomes one list of items, each with one owner, a status, what to do and where the
 * final file is saved. Every item is one of three kinds:
 *
 * - a checkbox item: the donor only checks it is there and correct (a signed declaration, an audit);
 * - a scored item: evaluators read it and score it against the call's grid. It carries what the
 *   grid asks for, notes on what earns the best score tied to the win themes the organization
 *   chose, and a rating band a reviewer confirms;
 * - a decision: something a named person must decide before others can finish (apply alone or
 *   with partners, who the donor writes to).
 *
 * Nothing here is ROP's own: the standard list is a starting point any organization edits, and a
 * new proposal can start from the last one. Files stay where the team keeps them (SharePoint);
 * the app holds the plan, the owners, the status and the assessment.
 */

/* ---------------- Who may open proposals ---------------- */

/**
 * Each organization names its own core: the people who can start a proposal and who see and run
 * every one. It is set by role type (whoever holds the role in the authority table, so it follows
 * the HR record), by name, or both. Anyone else, inside the organization or outside it, is added
 * to a proposal as a contributor and then sees that proposal only.
 */
export type Core = { roles: HrRole[]; people: string[] };
/** Until an organization chooses: the executive head and programme management. */
export const DEFAULT_CORE: Core = { roles: ["ceo", "management"], people: [] };
export type Holders = Partial<Record<HrRole, string[]>>;

export const inCore = (person: string, core: Core, holders: Holders): boolean => core.people.includes(person) || core.roles.some((r) => holders[r]?.includes(person));

/** Why this person is in the core, in words: the role types they hold that are in it, or that they are named. */
export function coreReason(person: string, core: Core, holders: Holders): string {
  const roles = core.roles.filter((r) => holders[r]?.includes(person)).map((r) => ROLE_LABEL[r]);
  return [...roles, ...(core.people.includes(person) ? ["Named"] : [])].join(", ");
}

/** Someone outside the organization named on a proposal: a consultant, a partner's writer. They hold items; they have no sign-in. */
export type Outsider = { id: string; name: string; org: string; email: string };

/* ---------------- The record ---------------- */

export const KINDS = ["checkbox", "scored", "decision"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = { checkbox: "Checkbox", scored: "Scored", decision: "Decision" };
export const KIND_HELP: Record<Kind, string> = {
  checkbox: "The donor checks it is there and correct. It earns no points, and a missing one can sink the proposal.",
  scored: "Evaluators read it and score it against the call's grid.",
  decision: "A named person decides before the others can finish.",
};

export const STATUSES = ["todo", "drafting", "review", "sign", "final", "na"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { todo: "Not started", drafting: "Being drafted", review: "Ready to review", sign: "Ready to sign", final: "Final", na: "Not applicable" };
const DONE: Status[] = ["final", "na"];
export const isDone = (i: Pick<Item, "status">) => DONE.includes(i.status);

/** Not numbers: how a scored section would stand against other applicants, best first. */
export const BANDS = ["differentiator", "competitive", "fringe", "not_competitive"] as const;
export type Band = (typeof BANDS)[number];
export const BAND_LABEL: Record<Band, string> = { differentiator: "Differentiator", competitive: "Competitive", fringe: "Fringe", not_competitive: "Not competitive" };
export const BAND_HELP: Record<Band, string> = {
  differentiator: "Answers everything the grid asks, with evidence, and gives a reason to choose us that others cannot give.",
  competitive: "Answers everything the grid asks, with evidence. Would score with the stronger applicants.",
  fringe: "Answers the question but thinly: claims without evidence, or part of what the grid asks is missing.",
  not_competitive: "Does not answer what the grid asks, or is not there yet.",
};
const BAND_VALUE: Record<Band, number> = { differentiator: 3, competitive: 2, fringe: 1, not_competitive: 0 };

export type Rating = {
  band: Band;
  why: string;
  /** What would move it up one band. */
  next: string;
  by: string;
  byName: string;
  at: string;
  /** Suggested by AI and not yet confirmed by a reviewer: shown, never counted. */
  suggested: boolean;
};

export type Item = {
  id: string;
  /** Where the call asks for it: "Annex I", "Section 3.2", "Q71". */
  ref: string;
  title: string;
  kind: Kind;
  owner: string | null;
  /** The person who must sign it before it is final, when someone must. */
  signer: string | null;
  /** The day it is due inside the team, before the donor's deadline. */
  due: string | null;
  status: Status;
  /** What to do, in a sentence or two. */
  todo: string;
  /** The working file, and what the final is saved as, by the team's own file numbers. */
  working: string;
  final: string;
  /** Scored items: the most points the grid gives, what the grid asks for, and what earns the best score. */
  points: number | null;
  criteria: string;
  guidance: string;
  rating: Rating | null;
  /** Its place in the order files are uploaded to the donor's portal; null when it is not a file to upload. */
  upload: number | null;
  /** Drafted from the call by AI and not yet checked by a person. */
  unchecked: boolean;
};

export const OUTCOMES = ["drafting", "submitted", "won", "lost", "withdrawn"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABEL: Record<Outcome, string> = { drafting: "In preparation", submitted: "Submitted", won: "Won", lost: "Not funded", withdrawn: "Withdrawn" };

/** A moment on the donor's clock: local date and time, and the IANA time zone it is in. */
export type Moment = { at: string; zone: string };

export type Budget = {
  ceiling: number | null;
  total: number | null;
  direct: number | null;
  support: number | null;
  indirect: number | null;
  /** The call's limits, in percent: support costs of the total, indirect costs of direct costs. */
  supportCap: number | null;
  indirectCap: number | null;
};
export const NO_BUDGET: Budget = { ceiling: null, total: null, direct: null, support: null, indirect: null, supportCap: null, indirectCap: null };

export type FundingProposal = {
  id: string;
  /** The opportunity it came from (lib/opportunities), so the donor and the call are entered once. */
  opportunityId: string | null;
  title: string;
  donor: string;
  /** Where the donor takes the submission (a portal), and the team's shared folder. Links only. */
  portal: string;
  folder: string;
  currency: string;
  deadline: Moment | null;
  /** The team's own targets before the deadline, in the donor's time zone. */
  targets: { label: string; at: string }[];
  /** Up to three reasons to choose this organization, chosen by the people running the proposal. Guidance and ratings are written against them. */
  themes: string[];
  /** How the team works until submission, as agreed. */
  rules: string[];
  budget: Budget;
  /** Staff outside the core who are named on this proposal and can open it, and only it. */
  team: string[];
  /** People outside the organization who hold items on it. The core updates their items for them. */
  outside: Outsider[];
  items: Item[];
  outcome: Outcome;
  /** Where the donor's confirmation of receipt is saved. */
  confirmation: string;
  history: { at: string; by: string; byName: string; what: string }[];
  /** The day it was recorded as won. Older records have none: their history says. */
  decidedAt?: string;
  /** The project set up from it once won (lib/project-origin). */
  projectCode?: string;
};

/* ---------------- Actions ---------------- */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Give the date and the time.");
const person = z.string().trim().min(1).max(60);
const money = z.number().min(0).max(1e11).nullable();
const pct = z.number().min(0).max(100).nullable();

export const headFields = z.object({
  title: z.string().trim().min(3, "Name the proposal.").max(200),
  donor: z.string().trim().min(2, "Name the donor.").max(120),
  portal: z.string().trim().max(600).default(""),
  folder: z.string().trim().max(600).default(""),
  currency: z.string().trim().max(5).default("USD"),
  deadline: z.object({ at: local, zone: z.string().trim().min(3).max(60) }).nullable().default(null),
  targets: z.array(z.object({ label: z.string().trim().min(2).max(120), at: local })).max(6).default([]),
  rules: z.array(z.string().trim().min(2).max(300)).max(8).default([]),
  budget: z.object({ ceiling: money, total: money, direct: money, support: money, indirect: money, supportCap: pct, indirectCap: pct }).default(NO_BUDGET),
});
export type HeadFields = z.infer<typeof headFields>;

export const itemFields = z.object({
  ref: z.string().trim().max(40).default(""),
  title: z.string().trim().min(2, "Name the item.").max(200),
  kind: z.enum(KINDS),
  owner: person.nullable().default(null),
  signer: person.nullable().default(null),
  due: day.nullable().default(null),
  todo: z.string().trim().max(1500).default(""),
  working: z.string().trim().max(200).default(""),
  final: z.string().trim().max(200).default(""),
  points: z.number().min(0).max(1000).nullable().default(null),
  criteria: z.string().trim().max(3000).default(""),
  guidance: z.string().trim().max(3000).default(""),
  upload: z.number().int().min(1).max(200).nullable().default(null),
});
export type ItemFields = z.infer<typeof itemFields>;

export const START = ["standard", "blank"] as const;

export const proposalAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), fields: headFields, opportunityId: z.string().max(40).nullable().default(null), from: z.string().max(40).default("standard") }),
  z.object({ action: z.literal("head"), id: z.string(), fields: headFields }),
  z.object({ action: z.literal("themes"), id: z.string(), themes: z.array(z.string().trim().min(3).max(200)).max(3) }),
  z.object({ action: z.literal("team"), id: z.string(), person, add: z.boolean() }),
  z.object({ action: z.literal("outsider"), id: z.string(), name: z.string().trim().min(2, "Give their name.").max(120), org: z.string().trim().max(120).default(""), email: z.string().trim().max(200).default("") }),
  z.object({ action: z.literal("core"), roles: z.array(z.enum(HR_ROLES)).max(HR_ROLES.length), people: z.array(person).max(60) }),
  z.object({ action: z.literal("addItem"), id: z.string(), fields: itemFields }),
  z.object({ action: z.literal("editItem"), id: z.string(), item: z.string(), fields: itemFields }),
  z.object({ action: z.literal("removeItem"), id: z.string(), item: z.string() }),
  z.object({ action: z.literal("status"), id: z.string(), item: z.string(), status: z.enum(STATUSES), note: z.string().trim().max(600).default("") }),
  z.object({ action: z.literal("rate"), id: z.string(), item: z.string(), band: z.enum(BANDS), why: z.string().trim().min(10, "Say why, in a sentence: the writer needs it.").max(1500), next: z.string().trim().max(1500).default("") }),
  z.object({ action: z.literal("assess"), id: z.string(), item: z.string(), text: z.string().trim().min(200, "Paste the section's draft: at least a few paragraphs.").max(60000) }),
  z.object({ action: z.literal("plan"), id: z.string(), call: z.string().trim().min(400, "Paste the call's requirements and scoring grid: at least a page.").max(120000) }),
  z.object({ action: z.literal("outcome"), id: z.string(), outcome: z.enum(OUTCOMES), confirmation: z.string().trim().max(300).default(""), note: z.string().trim().max(1000).default("") }),
]);
export type ProposalAction = z.infer<typeof proposalAction>;

/* ---------------- What AI is asked for ---------------- */

export const planSchema = z.object({
  items: z
    .array(
      z.object({
        ref: z.string().describe("Where the call asks for it, as the call names it: 'Annex I', 'Section 3', 'Q12'. Empty if the call gives none."),
        title: z.string().describe("What must be produced, in a few words."),
        kind: z.enum(KINDS).describe("checkbox: the donor only checks it is there and correct. scored: evaluators score it against the grid. decision: the applicant must decide something before the work can finish."),
        todo: z.string().describe("What to do, in one or two plain sentences, with any limit the call sets (pages, amounts, formats, signatures)."),
        points: z.number().nullable().describe("Scored items only: the most points the grid gives. Null if the call does not say."),
        criteria: z.string().describe("Scored items only: what the grid says evaluators look for, in the call's own terms. Empty otherwise."),
        guidance: z.string().describe("Scored items only: what kind of information and evidence would earn the best score, written against the organization's win themes where they fit. Do not invent facts about the organization. Empty otherwise."),
      }),
    )
    .describe("Every item the call requires, in the order the call lists them. One item per document, annex, narrative section or decision. Do not merge and do not invent."),
  limits: z.array(z.string()).describe("Hard limits the call sets that apply to the whole proposal: budget ceiling, cost caps, page limits, eligibility. One per line, with the call's reference."),
});

export const assessSchema = z.object({
  band: z.enum(BANDS).describe("How this section would stand against other applicants, judged only against the grid's criteria given."),
  why: z.string().describe("Two or three plain sentences: what the draft does and does not answer in the grid's criteria, with the evidence it gives or lacks."),
  next: z.string().describe("The one or two changes that would move it up a band. Say what kind of evidence is missing; do not write the text."),
});

/* ---------------- Rules ---------------- */

/** May this person mark the item with this status? Null when they may; otherwise why not. */
export function statusRefusal(i: Item, to: Status, by: string, runsIt: boolean, outside: string[] = []): string | null {
  if (!runsIt && i.owner !== by && i.signer !== by) return "Only the item's owner, its signer and the people running the proposal change its status.";
  // A signer outside the organization has no sign-in: the people running the proposal record their signature.
  const recordsForSigner = runsIt && !!i.signer && outside.includes(i.signer);
  if (to === "final" && i.signer && i.signer !== by && !recordsForSigner) return "This one is final when its signer has signed it. Mark it ready to sign.";
  if (to === "sign" && !i.signer) return "Nobody is named to sign this one. Name the signer, or mark it final.";
  if (to === "final" && i.kind === "decision" && i.owner !== by && !runsIt) return "The person named decides.";
  return null;
}

/** Nobody rates a section they wrote. Null when this person may confirm a band on the item. */
export function ratingRefusal(i: Item, by: string, runsIt: boolean): string | null {
  if (i.kind !== "scored") return "Only scored items are rated.";
  if (!runsIt) return "Sections are rated by the people running the proposal.";
  if (i.owner === by) return "You wrote this section, so someone else rates it.";
  return null;
}

/** The band a set of confirmed ratings adds up to, weighted by the grid's points; null when none is confirmed. */
export function overallBand(items: Item[]): Band | null {
  const rated = items.filter((i) => i.kind === "scored" && i.status !== "na" && i.rating && !i.rating.suggested);
  if (!rated.length) return null;
  const weight = (i: Item) => i.points ?? 1;
  const total = rated.reduce((a, i) => a + weight(i), 0) || 1;
  const score = rated.reduce((a, i) => a + BAND_VALUE[i.rating!.band] * weight(i), 0) / total;
  return score >= 2.5 ? "differentiator" : score >= 1.75 ? "competitive" : score >= 1 ? "fringe" : "not_competitive";
}

const fmt = (n: number, currency: string) => `${currency} ${Math.round(n).toLocaleString("en-US")}`;
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Where the budget breaks the call's limits, in words; empty when it is inside them or there is nothing to check. */
export function budgetProblems(b: Budget, currency: string): string[] {
  const out: string[] = [];
  if (b.ceiling != null && b.total != null && b.total > b.ceiling) out.push(`The budget is ${fmt(b.total - b.ceiling, currency)} above the ceiling of ${fmt(b.ceiling, currency)}.`);
  if (b.supportCap != null && b.support != null && b.total) {
    const share = (b.support / b.total) * 100;
    if (share > b.supportCap + 1e-9) out.push(`Support costs are ${one(share)}% of the total; the limit is ${one(b.supportCap)}%.`);
  }
  if (b.indirectCap != null && b.indirect != null && b.direct) {
    const share = (b.indirect / b.direct) * 100;
    if (share > b.indirectCap + 1e-9) out.push(`Indirect costs are ${one(share)}% of direct costs; the limit is ${one(b.indirectCap)}%.`);
  }
  return out;
}

export type Readiness = {
  /** Checkbox items: how many are final of those that apply, and the ones still open. */
  checks: { done: number; of: number; open: Item[] };
  decisions: Item[];
  scored: { rated: number; of: number; suggested: number; band: Band | null; weakest: Item[] };
  budget: string[];
  unchecked: number;
  unowned: Item[];
  /** Everything that stops a submission, most serious first. Empty means it can go. */
  blockers: string[];
  /** The single next step, for the top of the page. */
  next: string;
};

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/**
 * Whether the proposal can be submitted, and how it would stand. The two are kept apart on
 * purpose: checkbox items are pass or fail and stop a submission; the band says how the scored
 * sections compare, and never stops one.
 */
export function readiness(p: FundingProposal): Readiness {
  const live = p.items.filter((i) => i.status !== "na");
  const checks = live.filter((i) => i.kind === "checkbox");
  const openChecks = checks.filter((i) => !isDone(i));
  const decisions = live.filter((i) => i.kind === "decision" && !isDone(i));
  const scored = live.filter((i) => i.kind === "scored");
  const openScored = scored.filter((i) => !isDone(i));
  const confirmed = scored.filter((i) => i.rating && !i.rating.suggested);
  const weakest = confirmed.filter((i) => BAND_VALUE[i.rating!.band] <= 1).sort((a, b) => (b.points ?? 1) - (a.points ?? 1));
  const budget = budgetProblems(p.budget, p.currency);
  const unowned = live.filter((i) => !isDone(i) && !i.owner);
  const unchecked = live.filter((i) => i.unchecked).length;

  const blockers: string[] = [];
  if (!p.items.length) blockers.push("Nothing is listed yet. Build the list from the call.");
  if (decisions.length) blockers.push(`${n(decisions.length, "decision is", "decisions are")} still open: ${decisions.map((i) => i.title).join("; ")}.`);
  blockers.push(...budget);
  if (openChecks.length) blockers.push(`${n(openChecks.length, "checkbox item is", "checkbox items are")} not final: ${openChecks.slice(0, 4).map((i) => i.title).join("; ")}${openChecks.length > 4 ? "; and more" : ""}.`);
  if (openScored.length) blockers.push(`${n(openScored.length, "scored section is", "scored sections are")} not final.`);

  const next = !p.items.length
    ? "Build the list from the call."
    : unchecked
      ? `Check the ${n(unchecked, "item", "items")} drafted from the call by AI.`
      : unowned.length
        ? `Give ${n(unowned.length, "item", "items")} an owner.`
        : decisions.length
          ? `Decide: ${decisions[0].title}.`
          : budget.length
            ? "Bring the budget inside the call's limits."
            : !p.themes.length && scored.length
              ? "Choose the win themes, so the scored sections are written and rated against them."
              : blockers.length
                ? "Finish the open items below."
                : confirmed.length < scored.length
                  ? `Everything is final. ${n(scored.length - confirmed.length, "scored section has", "scored sections have")} no confirmed rating yet.`
                  : "Everything is final. Upload in the order below and submit.";

  return {
    checks: { done: checks.length - openChecks.length, of: checks.length, open: openChecks },
    decisions,
    scored: { rated: confirmed.length, of: scored.length, suggested: scored.filter((i) => i.rating?.suggested).length, band: overallBand(p.items), weakest },
    budget,
    unchecked,
    unowned,
    blockers,
    next,
  };
}

/** One table per person, as the team's tracker has it: their open items, soonest first, with what they must sign. */
export function byPerson(p: FundingProposal): { person: string | null; items: Item[]; toSign: Item[] }[] {
  const open = p.items.filter((i) => !isDone(i));
  const ids = [...new Set([...open.map((i) => i.owner), ...open.filter((i) => i.status === "sign").map((i) => i.signer)])].filter((x) => x !== undefined);
  const soonest = (a: Item, b: Item) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.ref.localeCompare(b.ref, undefined, { numeric: true });
  return ids
    .map((person) => ({ person, items: open.filter((i) => i.owner === person).sort(soonest), toSign: open.filter((i) => i.status === "sign" && i.signer === person && i.owner !== person).sort(soonest) }))
    .filter((g) => g.items.length || g.toSign.length)
    .sort((a, b) => (a.person === null ? 1 : b.person === null ? -1 : b.items.length + b.toSign.length - (a.items.length + a.toSign.length) || a.person.localeCompare(b.person)));
}

/** The files to upload to the donor's portal, in order, with whether each is final. */
export const uploadPlan = (p: FundingProposal): Item[] => p.items.filter((i) => i.upload != null && i.status !== "na").sort((a, b) => a.upload! - b.upload!);

/** What one person has to do across proposals, for Home: items they own that are open, and items waiting for their signature. */
export function mine(list: FundingProposal[], person: string): { proposal: FundingProposal; items: Item[]; toSign: Item[] }[] {
  return list
    .filter((p) => p.outcome === "drafting")
    .map((p) => ({ proposal: p, items: p.items.filter((i) => i.owner === person && !isDone(i) && i.status !== "sign" && i.status !== "review"), toSign: p.items.filter((i) => i.signer === person && i.status === "sign") }))
    .filter((x) => x.items.length || x.toSign.length);
}

/* ---------------- The donor's clock ---------------- */

/** The instant a local date and time in a time zone falls on. Unknown zones are read as UTC. */
export function instantOf(m: Moment): Date {
  const asUtc = new Date(`${m.at}:00Z`);
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: m.zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(asUtc);
    const v = (t: string) => Number(parts.find((x) => x.type === t)?.value);
    const seen = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
    return new Date(asUtc.getTime() - (seen - asUtc.getTime()));
  } catch {
    return asUtc;
  }
}

/** "Kabul" from "Asia/Kabul". */
export const placeOf = (zone: string) => (zone.split("/").pop() ?? zone).replace(/_/g, " ");

/** "Tue 17 Nov, 23:59 Kabul" and, when the reader is elsewhere, "= 12:29 your time" (with the day when it differs). */
export function sayMoment(m: Moment, readerZone: string): string {
  const at = instantOf(m);
  const show = (zone: string, withDay: boolean) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", ...(withDay ? { weekday: "short", day: "numeric", month: "short" } : {}), hour: "2-digit", minute: "2-digit" }).format(at);
  const dayIn = (zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(at);
  let there: string;
  try {
    there = `${show(m.zone, true)} ${placeOf(m.zone)}`;
  } catch {
    return m.at.replace("T", " ");
  }
  try {
    if (readerZone === m.zone || show(readerZone, true) === show(m.zone, true)) return there;
    return `${there} = ${show(readerZone, dayIn(readerZone) !== dayIn(m.zone))} your time`;
  } catch {
    return there;
  }
}

/** Hours from now to the moment, rounded down; negative once it has passed. */
export const hoursLeft = (m: Moment, now: Date) => Math.floor((instantOf(m).getTime() - now.getTime()) / 3_600_000);

/* ---------------- Starting points ---------------- */

type Seed = Pick<Item, "ref" | "title" | "kind" | "todo"> & Partial<Pick<Item, "criteria" | "guidance" | "upload">>;

/**
 * A standard donor package: what most institutional calls ask for. A starting point to edit
 * against the call in hand, not a rule. Scored sections carry what evaluators usually look for
 * and the kind of evidence that scores; the win themes are added when they are chosen.
 */
export const STANDARD: Seed[] = [
  { ref: "", title: "Who applies: alone or with partners", kind: "decision", todo: "Decide whether the organization applies alone or leads a group. With partners, each needs its own declarations and a partnership annex." },
  { ref: "", title: "Who the donor writes to with questions", kind: "decision", todo: "Name the contact for clarifications and check they can sign in to the donor's portal by uploading a test file." },
  { ref: "", title: "Context and the problem", kind: "scored", todo: "Describe the need in the places and for the people the call names, with recent figures and their sources.", criteria: "Understanding of the context and of the people the project serves.", guidance: "Use the organization's own field data from the same places, with dates and sample sizes, before any national statistic. Name what earlier projects there showed did not work." },
  { ref: "", title: "Approach and activities", kind: "scored", todo: "Say what will be done, in what order and why this will change the problem described. Number the activities as in the workplan and the results framework.", criteria: "Technical quality, feasibility and logic of the approach.", guidance: "One line of logic from activity to result, with the evidence that it worked before: which project, what changed, by how much. Say what is different from what other applicants will propose." },
  { ref: "", title: "Results and how they are measured", kind: "scored", todo: "State the results, the targets and how each is measured, matching the results framework annex.", criteria: "Clear, measurable results and a credible way of measuring them.", guidance: "Targets with a baseline and the calculation behind each. Show the data system: who collects, who checks, and that a figure can be traced to its record." },
  { ref: "", title: "Experience and capacity", kind: "scored", todo: "Show the organization has done comparable work at comparable size, in this country or in similar ones.", criteria: "Relevant past performance and presence.", guidance: "Three comparable projects at most: donor, value, years, results achieved against targets, and a reference. Years of unbroken presence and staff already in place count for more than a list." },
  { ref: "", title: "Team and management", kind: "scored", todo: "Give the project's organization chart and why the team is the size it is, matching the staff lines in the budget.", criteria: "Adequate, qualified team and clear management.", guidance: "Named people for key posts with what they delivered before. Every post in the chart is a line in the budget, and the reverse." },
  { ref: "", title: "Sustainability and exit", kind: "scored", todo: "Say what continues after the funding ends, who pays for it and who runs it.", criteria: "Likelihood that results last beyond the project.", guidance: "Name the buyer, the institution or the business that carries on, and the income that pays for it. Evidence from earlier projects still running counts most." },
  { ref: "", title: "Budget narrative and value for money", kind: "scored", todo: "Explain the main costs and why they are the right size for the results.", criteria: "Costs that are justified, reasonable and inside the call's limits.", guidance: "Cost per participant or per result against earlier projects. Show the share that reaches the field." },
  { ref: "", title: "Budget", kind: "checkbox", todo: "Complete the donor's budget form inside the ceiling and the cost limits, with surveys and the audit included where the call asks." },
  { ref: "", title: "Results framework", kind: "checkbox", todo: "Complete the donor's template: results, indicators, baselines, targets and assumptions." },
  { ref: "", title: "Workplan", kind: "checkbox", todo: "Complete the donor's template with the activities, numbered as in the narrative." },
  { ref: "", title: "Risk analysis", kind: "checkbox", todo: "List the main risks with a rating and what will be done about each. Check them against what the field team sees." },
  { ref: "", title: "Environmental and social checklist", kind: "checkbox", todo: "Complete the donor's checklist and name the focal point, with the policy as evidence." },
  { ref: "", title: "Safeguarding declaration and policy", kind: "checkbox", todo: "Sign the donor's safeguarding form and attach the organization's policy." },
  { ref: "", title: "Declarations", kind: "checkbox", todo: "Confirm each answer is correct, then sign and stamp every form the call requires." },
  { ref: "", title: "Registration and incorporation", kind: "checkbox", todo: "Attach current registration in the country of work and at home." },
  { ref: "", title: "Audited accounts", kind: "checkbox", todo: "Attach the audits for the years the call asks for." },
  { ref: "", title: "CVs of key staff", kind: "checkbox", todo: "Format the CVs the call asks for in the donor's layout." },
  { ref: "", title: "Upload and submit", kind: "checkbox", todo: "Enter the proposal's details in the portal, upload the files in order, submit, and save the donor's confirmation." },
];

let seq = 0;
/** A short id that is unique inside one proposal. */
export const itemId = (taken: string[]) => {
  let id = "";
  do id = `I${(++seq + taken.length).toString(36).toUpperCase().padStart(3, "0")}`;
  while (taken.includes(id));
  return id;
};

const blank = (id: string, s: Seed): Item => ({ id, ref: s.ref, title: s.title, kind: s.kind, owner: null, signer: null, due: null, status: "todo", todo: s.todo, working: "", final: "", points: null, criteria: s.criteria ?? "", guidance: s.guidance ?? "", rating: null, upload: s.upload ?? null, unchecked: false });

/** The standard list as fresh items, with files to upload numbered in order. */
export function standardItems(): Item[] {
  const ids: string[] = [];
  let k = 0;
  return STANDARD.map((s) => {
    const id = itemId(ids);
    ids.push(id);
    return blank(id, { ...s, upload: s.kind === "decision" || s.title === "Upload and submit" ? null : ++k });
  });
}

/**
 * The items of an earlier proposal as the start of a new one: what was asked, what to do and what
 * scored, without who did it, when, its status or its rating. The donor's grid may have changed,
 * so every copied item is marked to be checked against the new call.
 */
export function itemsFrom(earlier: FundingProposal): Item[] {
  return earlier.items.map((i) => ({ ...i, owner: null, signer: null, due: null, status: "todo" as const, working: "", final: "", rating: null, unchecked: true }));
}

/** Items drafted from a call by AI, to add to the list: marked unchecked until a person edits or confirms each. */
export function itemsFromPlan(plan: z.infer<typeof planSchema>, taken: string[]): Item[] {
  const ids = [...taken];
  let k = 0;
  return plan.items.slice(0, 80).map((x) => {
    const id = itemId(ids);
    ids.push(id);
    const scored = x.kind === "scored";
    return { ...blank(id, { ref: x.ref.slice(0, 40), title: x.title.slice(0, 200), kind: x.kind, todo: x.todo.slice(0, 1500), criteria: scored ? x.criteria.slice(0, 3000) : "", guidance: scored ? x.guidance.slice(0, 3000) : "", upload: x.kind === "decision" ? null : ++k }), points: scored ? x.points : null, unchecked: true };
  });
}
