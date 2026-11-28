import { z } from "zod";
import { workplanFor, type BudgetLine, type WorkplanItem } from "@/lib/budget";
import { AFN_PER_USD, users, type AppUser } from "@/lib/demo";
import { LEAD_DAYS, levelFor, rulesInForce, type Level } from "@/lib/procurement";
import { isDay } from "@/lib/clock";
import { lineFigure, lineFigureText } from "@/lib/line-money";
import { perUsd } from "@/lib/fx";

/**
 * The procurement calendar: one planned purchase per budget line marked to procure, built from
 * the budget and workplan when a project starts. The procurement manager and the line's
 * technical lead both approve it; approved items go on the Tasks calendar on their start date.
 */

export type Sign = { by: string; name: string; at: string; /** Set when an admin signed for someone else. */ for?: string };

export const PLAN_STATUSES = ["draft", "approved", "returned", "started"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export type PlanItem = {
  key: string;
  /** The budget line it buys from. */
  budgetCode: string | null;
  activityCode: string | null;
  /** The workplan sub-activity it serves, when one matches. */
  workplanCode: string | null;
  /** Who chose that row. Absent: the app matched it from the budget line's activity and wording, and nobody has confirmed it. */
  workplanBy?: string | null;
  title: string;
  quantity: number | null;
  unit: string | null;
  /** What is still to buy: the line total less what is already spent. */
  value: number;
  currency: string;
  usd: number;
  level: Level;
  /** When the goods or service are needed: the first quarter the line is budgeted in. */
  neededBy: string;
  /** Why that date. */
  neededWhy: string;
  leadDays: number;
  startBy: string;
  techLead: string | null;
  status: PlanStatus;
  approvals: { manager?: Sign; lead?: Sign };
  returnNote: string | null;
  /** Changed by a person since it was built, so a rebuild leaves it alone. */
  edited: boolean;
  procurementKey: string | null;
  /**
   * Set when someone asked for it outside the calendar (not built from the budget): who asked,
   * why it was not planned, and whether it is urgent. It needs the same two approvals as any other.
   */
  unplanned?: Unplanned;
};

export type Unplanned = {
  by: string;
  name: string;
  at: string;
  reason: string;
  urgent: boolean;
  /** Set when the line's planned purchases already use what is left on it: says how much is left after them, for the approvers. */
  overPlan?: string;
  /** Set when, with other asks on the same line in the same month, it reaches a higher procurement level: a possible split, for the approvers. */
  split?: string;
};

/** Rough USD value, for choosing the policy level. */
/** Dollars per one unit of each currency, at this month's rate (lib/fx, MF-11). */
export const USD_PER: Record<string, number> = new Proxy({} as Record<string, number>, {
  get: (_t, c: string) => {
    if (c === "USD") return 1;
    const r = perUsd(c);
    return r ? 1 / r : c === "AFN" ? 1 / AFN_PER_USD : undefined;
  },
});
export const toUsd = (value: number, currency: string) => value * (USD_PER[currency] ?? 1);

/** Typical days from starting a procurement to having the goods, per level (kept in lib/procurement, which its checks read too). */
export { LEAD_DAYS };

/** A threshold from the rules in force (the organization's policy with the donor's layered on), as "$5,000". */
const dollars = (key: string, fallback: number) => {
  const v = rulesInForce()[key];
  return "$" + (typeof v === "number" ? v : fallback).toLocaleString("en-US");
};
/**
 * How each level is bought (ROP procurement policy; thresholds in USD). The amounts are read from
 * the rules in force each time, so the words on screen always match the level the app works out.
 */
export const METHOD: Record<Level, { title: string; readonly detail: string }> = {
  Micro: {
    title: "Direct purchase",
    get detail() {
      return "Up to " + dollars("microMaxUsd", 500) + ": buy at a fair price after checking prices from three suppliers.";
    },
  },
  Small: {
    title: "Request for quotation",
    get detail() {
      return dollars("microMaxUsd", 500) + " to " + dollars("smallMaxUsd", 5000) + ": three written quotations; the lowest that meets the specification wins.";
    },
  },
  Medium: {
    title: "Open competition",
    get detail() {
      return dollars("smallMaxUsd", 5000) + " to " + dollars("largeAboveUsd", 25000) + ": an advertised RFQ (lowest price) or RFP (best value), evaluated by a bid committee.";
    },
  },
  Large: {
    title: "Open competition with Home Office review",
    get detail() {
      return "Over " + dollars("largeAboveUsd", 25000) + ": advertised solicitation, bid plan and committee, and Home Office reviews the package before award.";
    },
  },
};

export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** The technical lead for a line: the person whose activity numbers match it most closely. */
export function leadFor(line: Pick<BudgetLine, "activityCode" | "kind">, people: AppUser[]): string | null {
  if (line.kind === "operations") return people.find((u) => u.leads?.includes("operations"))?.id ?? null;
  const code = line.activityCode ?? "";
  let best: { id: string; len: number } | null = null;
  for (const u of people)
    for (const p of u.leads ?? []) if (p !== "operations" && code.startsWith(p) && (!best || p.length > best.len)) best = { id: u.id, len: p.length };
  return best?.id ?? null;
}

/**
 * Who approves a purchase as technical lead when the line's own lead is the person asking for it
 * (review round 1, ISS-03): nobody approves what they proposed. In order: another lead of the
 * same line, then the requester's line manager. Null when there is neither: the procurement
 * manager or an administrator then names someone.
 */
export function leadOtherThan(line: Pick<BudgetLine, "activityCode" | "kind">, people: AppUser[], requester: AppUser): string | null {
  const others = people.filter((p) => p.id !== requester.id);
  const boss = others.find((p) => p.id === requester.reportsTo && p.kind === "employee");
  return leadFor(line, others) ?? boss?.id ?? null;
}
/** The words for it, wherever the requester meets the rule. */
export const OWN_REQUEST = "You asked for this purchase, so someone else approves it. Nobody approves what they asked for.";

const pad = (n: number) => String(n).padStart(3, "0");

/** A plan item for one budget line, or null when nothing is left to buy on it. */
export function itemFor(line: BudgetLine, currency: string, workplan: WorkplanItem[], projectStart: string, people: AppUser[], key: string): PlanItem | null {
  const left = Math.round((line.total - (line.spent ?? 0)) * 100) / 100;
  if (!line.procure || left <= 0) return null;
  const wp = workplanFor(line, workplan);
  const quarters = Object.keys(line.schedule).filter((q) => line.schedule[q] > 0).sort();
  const [neededBy, neededWhy] = quarters.length
    ? [quarters[0], "First quarter this line is budgeted in."]
    : wp?.start
      ? [wp.start, `Workplan ${wp.code} starts then.`]
      : [projectStart, "No budget quarter or workplan date; the project start."];
  const usd = toUsd(left, currency);
  const level = levelFor(usd);
  const leadDays = LEAD_DAYS[level];
  return {
    key,
    budgetCode: line.code,
    activityCode: line.activityCode,
    workplanCode: wp?.code ?? null,
    title: line.description,
    // A partly spent line has an unknown quantity left.
    quantity: line.spent ? null : line.quantity,
    unit: line.unit,
    value: left,
    currency,
    usd: Math.round(usd),
    level,
    neededBy,
    neededWhy,
    leadDays,
    // Never before the project exists: a large purchase needed at the start is "late" from day one,
    // not due to start months before the agreement was signed.
    startBy: [addDays(neededBy, -leadDays), projectStart].filter(Boolean).sort().at(-1)!,
    techLead: leadFor(line, people),
    status: "draft",
    approvals: {},
    returnNote: null,
    edited: false,
    procurementKey: null,
  };
}

/**
 * Builds or refreshes the plan from the budget. Items people have touched (approved, returned,
 * started or edited) are kept as they are; untouched drafts follow the budget; lines no longer
 * to procure lose their untouched draft.
 */
export function buildPlan(opts: { lines: BudgetLine[]; currency: string; workplan: WorkplanItem[]; projectStart: string; people: AppUser[]; existing: PlanItem[] }) {
  const { lines, currency, workplan, projectStart, people, existing } = opts;
  const touched = (i: PlanItem) => i.edited || i.status !== "draft" || !!i.approvals.manager || !!i.approvals.lead;
  let next = Math.max(0, ...existing.map((i) => Number(i.key.replace(/\D/g, "")) || 0)) + 1;
  const out: PlanItem[] = [];
  const removed: string[] = [];
  // Items asked for outside the calendar are not built from the budget: a rebuild keeps them as they are.
  for (const i of existing) if (i.unplanned) out.push(i);
  for (const line of lines) {
    const had = existing.find((i) => !i.unplanned && i.budgetCode === line.code);
    if (had && touched(had)) {
      out.push(had);
      continue;
    }
    const item = itemFor(line, currency, workplan, projectStart, people, had?.key ?? `PP-${pad(next)}`);
    if (item) {
      if (!had) next++;
      out.push(item);
    } else if (had) removed.push(had.key);
  }
  // Items whose budget line has gone: keep touched ones so nothing approved disappears.
  for (const i of existing) {
    if (out.includes(i) || removed.includes(i.key) || lines.some((l) => l.code === i.budgetCode)) continue;
    if (touched(i)) out.push(i);
    else removed.push(i.key);
  }
  return { items: out.sort((a, b) => a.startBy.localeCompare(b.startBy) || a.key.localeCompare(b.key)), removed };
}

/* ---------------- Asking for something not on the calendar ---------------- */

/** A real calendar date (lib/clock isDay), so "2026-02-31" is refused rather than stored. */
const strictDay = (message: string) => z.string({ message }).refine(isDay, message);

/** What a person fills in to ask for a purchase that is not on the calendar. */
export const askSchema = z.object({
  title: z.string().trim().min(3, "Say what is needed.").max(500),
  budgetCode: z.string().trim().min(1, "Choose the budget line it is charged to.").max(40),
  /** Estimated cost, in the budget's currency. */
  value: z.number({ message: "Give an estimated cost." }).positive("Give an estimated cost.").max(1e9),
  neededBy: strictDay("Give the date it is needed by."),
  reason: z.string().trim().min(10, "Say in a short sentence why it was not planned, or why it is urgent.").max(500),
  urgent: z.boolean().optional(),
});
export type AskInput = z.infer<typeof askSchema>;

/** Who can ask for something not on the calendar: staff who can change procurement (not view-only), and admins. */
export const canAsk = (u: AppUser) => (u.kind === "employee" && u.procurementAccess === "edit") || !!u.admin;

/** Keys of items asked for outside the calendar: "UP-001", apart from the "PP-" items built from the budget. */
export const askKey = (n: number) => `UP-${pad(n)}`;

const round2 = (v: number) => Math.round(v * 100) / 100;
const money = (v: number, currency: string) => `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;

/**
 * What is left on a budget line for a new purchase. `spent` already counts what has been paid,
 * and a started item's money goes there once paid, so only items not started yet are counted on
 * top of it (there is no cancelled status: a dropped ask is deleted).
 * - `afterAsks`: total less spent less the other open asks on the line. Asks are firm amounts
 *   someone chose, so a new ask past this over-commits the line and is refused.
 * - `afterPlanned`: that less the planned (built) items not started yet. A planned item is the
 *   line's whole remainder by construction (an estimate of what is still to buy), so going past
 *   it is allowed but marked for the approvers rather than refused.
 */
export function lineRoom(line: BudgetLine, items: PlanItem[], exceptKey?: string, committed = 0) {
  // A returned item holds nothing until it is sent again (code review of ISS-07): nobody may be
  // working on it, and it would hold the line's money for ever.
  const open = items.filter((i) => i.budgetCode === line.code && i.status !== "started" && i.status !== "returned" && i.key !== exceptKey);
  const sum = (xs: PlanItem[]) => xs.reduce((t, i) => t + (i.value || 0), 0);
  // The one figure for the line (lib/line-money): budget, less spent, less what purchases under way
  // are committed to and have not paid (`committed`, in the budget's currency), less other open asks.
  const figure = lineFigure(line.code, line.total, line.spent ?? 0, committed, sum(open.filter((i) => i.unplanned)));
  return { figure, afterAsks: figure.available, afterPlanned: round2(figure.available - sum(open.filter((i) => !i.unplanned))) };
}
/** Open asks made outside the calendar, by budget line: what `lineFigure` takes off as "asked". */
export const openAsks = (items: PlanItem[]) => items.filter((i) => i.unplanned && i.status !== "started" && i.status !== "returned").map((i) => ({ key: i.key, code: i.budgetCode ?? "", value: i.value, currency: i.currency }));

/** How many days apart two asks on one budget line still count as one need (the same window the requisition's split check uses). */
export const SPLIT_ASK_DAYS = 30;
/**
 * A possible split purchase, seen when it is asked for and not only when the requisition reaches
 * the approver (review round 1, ISS-17): other asks on the same budget line within the window
 * that, added to this one, reach a higher procurement level than this one alone. Null when none.
 * Splitting a purchase to stay under a threshold is not allowed, so the people approving the
 * calendar item are told.
 */
export function splitAsk(ask: { key?: string; budgetCode: string; value: number; currency: string; at: string }, items: PlanItem[]): { others: PlanItem[]; combinedUsd: number; alone: Level; together: Level; text: string } | null {
  const near = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) <= SPLIT_ASK_DAYS * 86400000;
  const others = items.filter((i) => i.unplanned && i.key !== ask.key && i.budgetCode === ask.budgetCode && i.status !== "returned" && near(i.unplanned.at, ask.at));
  if (!others.length) return null;
  const own = toUsd(ask.value, ask.currency);
  const combinedUsd = own + others.reduce((t, i) => t + toUsd(i.value, i.currency), 0);
  const alone = levelFor(own);
  const together = levelFor(combinedUsd);
  if (alone === together) return null;
  const list = others.map((i) => `${i.key} (${money(i.value, i.currency)})`).join(", ");
  const text = `Possible split purchase. With ${list} asked for on budget line ${ask.budgetCode} within ${SPLIT_ASK_DAYS} days, this makes $${Math.round(combinedUsd).toLocaleString("en-US")} together: a ${together} purchase, not ${alone}. Combine them and buy at the ${together} level, or be ready to say why they are separate needs.`;
  return { others, combinedUsd, alone, together, text };
}

/**
 * A calendar item for a purchase asked for outside the calendar, or the reason it cannot be made.
 * It is urgent when the person says so or when it is needed sooner than the usual lead time for
 * its size. It starts as a draft: the procurement manager and the line's technical lead approve it
 * exactly as they approve a planned item, before anyone can start a request.
 * `items`: what is on the calendar already, so the line is not promised twice (lineRoom).
 */
export function unplannedItem(a: AskInput, o: { line: BudgetLine | undefined; currency: string; workplan: WorkplanItem[]; people: AppUser[]; user: AppUser; today: string; key: string; items?: PlanItem[]; /** Unpaid commitments of purchases under way on this line, in the budget's currency. */ committed?: number }): PlanItem | string {
  const { line, currency, workplan, people, user, today: now, key, items = [], committed = 0 } = o;
  if (!canAsk(user)) return "You can view Procurement but not ask for purchases.";
  if (!line) return "That budget line is not in this project's budget. Choose one from the list.";
  if (a.neededBy < now) return "The needed-by date has passed. Choose today or a later date.";
  const room = lineRoom(line, items, key, committed);
  if (a.value > room.afterAsks) return `That is more than the ${lineFigureText(room.figure, (n) => money(n, currency))}. Choose another line or ask Finance about moving money first.`;
  const overPlan =
    a.value > room.afterPlanned
      ? `Budget line ${line.code} has ${money(Math.max(0, room.afterPlanned), currency)} left after the purchases already planned on it, and this asks for ${money(a.value, currency)}. Approving it means buying less of what is planned on the line, or moving money first.`
      : undefined;
  const usd = toUsd(a.value, currency);
  const level = levelFor(usd);
  // Told to the approvers now, not first to whoever approves the requisition.
  const split = splitAsk({ key, budgetCode: line.code, value: a.value, currency, at: now }, items);
  const leadDays = LEAD_DAYS[level];
  const due = addDays(a.neededBy, -leadDays);
  const urgent = !!a.urgent || due < now;
  return {
    key,
    budgetCode: line.code,
    activityCode: line.activityCode,
    workplanCode: workplanFor(line, workplan)?.code ?? null,
    title: a.title,
    quantity: null,
    unit: null,
    value: a.value,
    currency,
    usd: Math.round(usd),
    level,
    neededBy: a.neededBy,
    neededWhy: `Asked for by ${user.name}: not on the calendar.`,
    leadDays,
    // Never in the past: it is asked for today.
    startBy: due < now ? now : due,
    // The line's lead approves it, unless they are the one asking: then another lead, or their line manager.
    techLead: leadFor(line, people) === user.id ? leadOtherThan(line, people, user) : leadFor(line, people),
    status: "draft",
    approvals: {},
    returnNote: null,
    edited: true,
    procurementKey: null,
    unplanned: { by: user.id, name: user.name, at: now, reason: a.reason, urgent, ...(overPlan ? { overPlan } : {}), ...(split ? { split: split.text } : {}) },
  };
}

/* ---------------- Actions ---------------- */

export const planActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), as: z.enum(["manager", "lead"]) }),
  z.object({ action: z.literal("return"), note: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("reopen") }),
  /** The technical lead made the procurement request. */
  z.object({ action: z.literal("start"), procurementKey: z.string().regex(/^[A-Z0-9-]{3,40}$/) }),
  z.object({
    action: z.literal("edit"),
    title: z.string().trim().min(1).max(500).optional(),
    neededBy: strictDay("Give a real date.").optional(),
    leadDays: z.number().int().min(0).max(365).optional(),
    techLead: z.string().min(1).max(40).nullable().optional(),
    quantity: z.number().min(0).max(1e9).nullable().optional(),
    /** The workplan row this purchase serves, chosen by a person (null to clear it). */
    workplanCode: z.string().trim().min(1).max(40).nullable().optional(),
  }),
]);
export type PlanAction = z.infer<typeof planActionSchema>;

export const isManager = (u: AppUser) => u.procurement.includes("procurement");
/** The procurement manager: the procurement person titled manager, else the first procurement person. */
export const procurementManager = (people: AppUser[]) => people.find((u) => isManager(u) && /manager/i.test(u.title)) ?? people.find(isManager);
/**
 * The one person who approves a calendar line for procurement (owner's decision, 24 Nov 2026): the
 * procurement manager, not every procurement officer. An administrator may still sign for them.
 */
export const isProcurementManager = (u: AppUser, people: AppUser[] = users) => procurementManager(people)?.id === u.id;

/** Why one person cannot approve in both seats. */
export const BOTH_SEATS = "You approved this in the other seat. A second person approves here, so two people have looked at it.";

/** Applies an action, or returns why the person cannot. */
/**
 * `rows`: the workplan's row codes, when the project has a workplan. With one, a purchase must
 * name the row it serves before the procurement manager can approve it, and only a real row can
 * be named: what a purchase is for is chosen by a person, never left to a match on wording.
 */
export function applyAction(item: PlanItem, a: PlanAction, u: AppUser, people: AppUser[], today: string, rows?: string[]): PlanItem | string {
  const sign = (role: string, holder?: AppUser): Sign => ({ by: u.id, name: u.name, at: today, ...(holder && holder.id !== u.id ? { for: `${holder.name} (${role})` } : {}) });
  if (item.status === "started") return "This purchase has started; change it in Procurement.";
  switch (a.action) {
    case "approve": {
      if (item.status === "approved") return "Already approved.";
      // In either seat, and for an administrator too: the person who asked does not approve it.
      if (item.unplanned?.by === u.id) return OWN_REQUEST;
      // Two seats, two people (code review of D-13): whoever signed one seat does not sign the other,
      // an administrator or a line manager standing in as technical lead included.
      const other = a.as === "manager" ? item.approvals?.lead : item.approvals?.manager;
      if (other?.by === u.id) return BOTH_SEATS;
      if (a.as === "manager") {
        const holder = procurementManager(people);
        if (!isProcurementManager(u, people) && !u.admin) return `Only the procurement manager${holder ? ` (${holder.name})` : ""} approves for procurement.`;
        if (rows?.length && !(item.workplanCode && rows.includes(item.workplanCode))) return "Choose the workplan row this purchase serves before approving it.";
        const approvals = { ...item.approvals, manager: sign("Procurement manager", isProcurementManager(u, people) ? u : holder) };
        return settle({ ...item, approvals, returnNote: null });
      }
      if (u.id !== item.techLead && !u.admin) return "Only this line's technical lead approves it.";
      if (!item.techLead) return "Choose the technical lead first.";
      const lead = people.find((p) => p.id === item.techLead);
      if (lead && isManager(lead)) return "The technical lead is from the programme side, not procurement: the procurement manager names someone else.";
      return settle({ ...item, approvals: { ...item.approvals, lead: sign("Technical lead", lead) }, returnNote: null });
    }
    case "return":
      if (!isManager(u) && u.id !== item.techLead && !u.admin) return "Only the procurement manager or the technical lead can send it back.";
      return { ...item, status: "returned", approvals: {}, returnNote: `${a.note} (${u.name}, ${today})` };
    case "start":
      if (u.id !== item.techLead && u.id !== item.unplanned?.by && !u.admin) return "Only this line's technical lead, or the person who asked for it, starts the request.";
      if (item.status !== "approved") return "It needs both approvals before the request starts.";
      return { ...item, status: "started", procurementKey: a.procurementKey };
    case "reopen":
      if (!isProcurementManager(u, people) && !u.admin) return "Only the procurement manager can reopen an approved item.";
      return { ...item, status: "draft", approvals: {} };
    case "edit": {
      if (!isManager(u) && u.id !== item.techLead && !u.admin) return "Only the procurement manager or the technical lead can change it.";
      if (item.status === "approved") return "Reopen it before changing it.";
      if (a.workplanCode && rows && !rows.includes(a.workplanCode)) return "That row is not in this project's workplan. Choose one from the list.";
      if (a.techLead && a.techLead === item.unplanned?.by) return "The person who asked for a purchase cannot be the one who approves it as technical lead. Choose someone else.";
      // R2-02: the technical lead is the programme side's check of the need. Only the procurement
      // manager or an administrator changes who it is, never to a procurement person or to themselves.
      if (a.techLead !== undefined && a.techLead !== item.techLead) {
        if (!isProcurementManager(u, people) && !u.admin) return "Only the procurement manager changes the technical lead.";
        const next = a.techLead ? people.find((p) => p.id === a.techLead) : null;
        if (a.techLead && !next) return "Choose the technical lead from the staff list.";
        if (next && isManager(next)) return "The technical lead is from the programme side, not procurement: choose someone else.";
        if (a.techLead === u.id) return "You cannot name yourself technical lead: choose someone else.";
      }
      const neededBy = a.neededBy ?? item.neededBy;
      const leadDays = a.leadDays ?? item.leadDays;
      // A change needs both approvals again.
      return {
        ...item,
        title: a.title ?? item.title,
        neededBy,
        neededWhy: a.neededBy && a.neededBy !== item.neededBy ? `Set by ${u.name}.` : item.neededWhy,
        leadDays,
        startBy: addDays(neededBy, -leadDays),
        techLead: a.techLead === undefined ? item.techLead : a.techLead,
        quantity: a.quantity === undefined ? item.quantity : a.quantity,
        ...(a.workplanCode === undefined ? {} : { workplanCode: a.workplanCode, workplanBy: a.workplanCode ? u.id : null }),
        status: "draft",
        approvals: {},
        edited: true,
      };
    }
  }
}

const settle = (i: PlanItem): PlanItem => ({ ...i, status: i.approvals.manager && i.approvals.lead ? "approved" : i.status === "returned" ? "draft" : i.status });

/** What a person still has to approve. */
export const awaiting = (items: PlanItem[], u: AppUser) => ({
  asManager: isProcurementManager(u) ? items.filter((i) => i.status === "draft" && !i.approvals.manager && i.unplanned?.by !== u.id) : [],
  asLead: items.filter((i) => i.status === "draft" && i.techLead === u.id && !i.approvals.lead && i.unplanned?.by !== u.id),
});
