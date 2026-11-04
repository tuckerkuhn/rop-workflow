import { z } from "zod";
import { workplanFor, type BudgetLine, type WorkplanItem } from "@/lib/budget";
import { AFN_PER_USD, type AppUser } from "@/lib/demo";
import { levelFor, type Level } from "@/lib/procurement";

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
};

/** Rough USD value, for choosing the policy level. */
export const USD_PER: Record<string, number> = { USD: 1, AFN: 1 / AFN_PER_USD };
export const toUsd = (value: number, currency: string) => value * (USD_PER[currency] ?? 1);

/** Typical days from starting a procurement to having the goods, per level. A starting guess; change it per item. */
export const LEAD_DAYS: Record<Level, number> = { Micro: 7, Small: 21, Medium: 45, Large: 90 };

/** How each level is bought (ROP procurement policy Draft 1.0; thresholds in USD). */
export const METHOD: Record<Level, { title: string; detail: string }> = {
  Micro: { title: "Direct purchase", detail: "Up to $500: buy at a fair price after checking prices from three suppliers." },
  Small: { title: "Request for quotation", detail: "$500 to $5,000: three written quotations; the lowest that meets the specification wins." },
  Medium: { title: "Open competition", detail: "$5,000 to $25,000: an advertised RFQ (lowest price) or RFP (best value), evaluated by a bid committee." },
  Large: { title: "Open competition with Home Office review", detail: "Over $25,000: advertised solicitation, bid plan and committee, and Home Office reviews the package before award." },
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
    startBy: addDays(neededBy, -leadDays),
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
  for (const line of lines) {
    const had = existing.find((i) => i.budgetCode === line.code);
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

/* ---------------- Actions ---------------- */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const planActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), as: z.enum(["manager", "lead"]) }),
  z.object({ action: z.literal("return"), note: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("reopen") }),
  /** The technical lead made the procurement request. */
  z.object({ action: z.literal("start"), procurementKey: z.string().regex(/^[A-Z0-9-]{3,40}$/) }),
  z.object({
    action: z.literal("edit"),
    title: z.string().trim().min(1).max(500).optional(),
    neededBy: isoDate.optional(),
    leadDays: z.number().int().min(0).max(365).optional(),
    techLead: z.string().min(1).max(40).nullable().optional(),
    quantity: z.number().min(0).max(1e9).nullable().optional(),
  }),
]);
export type PlanAction = z.infer<typeof planActionSchema>;

export const isManager = (u: AppUser) => u.procurement.includes("procurement");
/** The procurement manager: the procurement person titled manager, else the first procurement person. */
export const procurementManager = (people: AppUser[]) => people.find((u) => isManager(u) && /manager/i.test(u.title)) ?? people.find(isManager);

/** Applies an action, or returns why the person cannot. */
export function applyAction(item: PlanItem, a: PlanAction, u: AppUser, people: AppUser[], today: string): PlanItem | string {
  const sign = (role: string, holder?: AppUser): Sign => ({ by: u.id, name: u.name, at: today, ...(holder && holder.id !== u.id ? { for: `${holder.name} (${role})` } : {}) });
  if (item.status === "started") return "This purchase has started; change it in Procurement.";
  switch (a.action) {
    case "approve": {
      if (item.status === "approved") return "Already approved.";
      if (a.as === "manager") {
        if (!isManager(u) && !u.admin) return "Only the procurement manager approves for procurement.";
        const holder = procurementManager(people);
        const approvals = { ...item.approvals, manager: sign("Procurement manager", isManager(u) ? u : holder) };
        return settle({ ...item, approvals, returnNote: null });
      }
      if (u.id !== item.techLead && !u.admin) return "Only this line's technical lead approves it.";
      if (!item.techLead) return "Choose the technical lead first.";
      const lead = people.find((p) => p.id === item.techLead);
      return settle({ ...item, approvals: { ...item.approvals, lead: sign("Technical lead", lead) }, returnNote: null });
    }
    case "return":
      if (!isManager(u) && u.id !== item.techLead && !u.admin) return "Only the procurement manager or the technical lead can send it back.";
      return { ...item, status: "returned", approvals: {}, returnNote: `${a.note} (${u.name}, ${today})` };
    case "start":
      if (u.id !== item.techLead && !u.admin) return "Only this line's technical lead starts the request.";
      if (item.status !== "approved") return "It needs both approvals before the request starts.";
      return { ...item, status: "started", procurementKey: a.procurementKey };
    case "reopen":
      if (!isManager(u) && !u.admin) return "Only the procurement manager can reopen an approved item.";
      return { ...item, status: "draft", approvals: {} };
    case "edit": {
      if (!isManager(u) && u.id !== item.techLead && !u.admin) return "Only the procurement manager or the technical lead can change it.";
      if (item.status === "approved") return "Reopen it before changing it.";
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
  asManager: isManager(u) ? items.filter((i) => i.status === "draft" && !i.approvals.manager) : [],
  asLead: items.filter((i) => i.status === "draft" && i.techLead === u.id && !i.approvals.lead),
});
