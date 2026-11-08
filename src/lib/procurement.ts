/**
 * Procurement workspace: roles, steps, checks and synthetic records.
 * Rules come from docs/ROP-PROCUREMENT-BLUEPRINT.md. Policy Draft 1.0 is not approved,
 * so every check carries its source tag and the rules stay easy to change here.
 */

export type StatusKind = "CUR" | "D1" | "D1*" | "TS" | "OPEN" | "PA";

import { formatMoney, holderOf, users, type ProcRole } from "@/lib/demo";
import { holdersOfType, holdsType } from "@/lib/authority";
import type { HrRole } from "@/lib/hr";
import { ROP, type Value } from "@/lib/policy";
import { DEMO_DATE, today } from "@/lib/clock";
import { lastScreening, sameSupplierName, supplierGaps, type Supplier } from "@/lib/suppliers";
import {
  closeInstalment,
  contractCurrency,
  duplicateInvoices,
  invoiceMatches,
  licenceValid,
  moreToPay,
  paidSoFar,
  receiptCovers,
  setPaymentRules,
  scheduleOf,
  scheduleTotal,
  taxOutstanding,
  withholding,
  type Currency,
  type Instalment,
  type Invoice,
  type Paid,
  type PaymentRecord,
} from "@/lib/payments";

export type Role = ProcRole;
export type Money = (usd: number) => string;
const usdFmt: Money = (n) => formatMoney(n, "USD");

export const roles: { id: Role; label: string; short: string }[] = [
  { id: "holder", label: "Budget holder", short: "Budget holder" },
  { id: "procurement", label: "Procurement officer", short: "Procurement" },
  { id: "committee", label: "Bid committee", short: "Committee" },
  { id: "ho", label: "Home Office reviewer", short: "HO review" },
  { id: "approver", label: "Approving authority", short: "Approver" },
  { id: "finance", label: "Finance", short: "Finance" },
];

export const roleLabel = (r: Role) => roles.find((x) => x.id === r)!.label;
/** "Karim Ahmadi (Approving authority)" for a role. */
export const rolePerson = (r: Role) => {
  const u = holderOf("procurement", r);
  return u ? `${u.name} (${roleLabel(r)})` : roleLabel(r);
};

export type Level = "Micro" | "Small" | "Medium" | "Large";

/**
 * The rules in force: the project's organization policy combined with its donor's
 * (lib/policy.ts), set when a project's rules load. Until then, ROP's own policy.
 */
const DEFAULT_RULES: Record<string, Value> = Object.fromEntries(Object.entries(ROP.values).map(([k, c]) => [k, c.value]));
let rules: Record<string, Value> = DEFAULT_RULES;
export function setProcurementRules(values?: Record<string, Value> | null) {
  // A rule the organization turned off (null) is off, not the built-in default.
  rules = { ...DEFAULT_RULES, ...(values ?? {}) };
  setPaymentRules(rules);
}
export const rulesInForce = () => rules;
const rule = (k: string, fallback: number) => (typeof rules[k] === "number" ? (rules[k] as number) : fallback);
const ruleList = (k: string) => (Array.isArray(rules[k]) ? (rules[k] as string[]) : []);

/** The level a value falls in, by the thresholds in force (ROP: $500 / $5,000 / $25,000, April 2025 Table 1). */
export function levelFor(value: number): Level {
  if (value <= rule("microMaxUsd", 500)) return "Micro";
  if (value <= rule("smallMaxUsd", 5000)) return "Small";
  if (value <= rule("largeAboveUsd", 25000)) return "Medium";
  return "Large";
}

/** A bid committee: always for best value; for lowest price above the committee threshold (below it, programme management may waive it). */
export const committeeNeeded = (p: Procurement) => (p.evaluation === "bestValue" && rules.committeeForBestValue !== false) || valueOf(p) > rule("committeeAboveUsd", 25000);

/** Goods on the donor's restricted list that this request seems to cover. */
export function restrictedHits(p: Pick<Procurement, "title" | "specification">) {
  const text = ` ${p.title} ${p.specification} `.toLowerCase();
  const stems: Record<string, string[]> = {
    "agricultural commodities": ["seed", "grain", "wheat", "commodit"],
    fertilizer: ["fertili", "urea", " dap "],
    pesticides: ["pesticid", "insecticid", "herbicid", "fungicid"],
    "motor vehicles": ["vehicle", "motorbike", "motorcycle", "truck", " car "],
    pharmaceuticals: ["pharma", "medicine", " drug"],
    "used equipment": [" used ", "second-hand", "second hand", "refurbished"],
  };
  return ruleList("restrictedGoods").filter((g) => (stems[g.toLowerCase()] ?? [g.toLowerCase()]).some((w) => text.includes(w)));
}

/** Screening lists in force, for the screening check. */
export const screeningLists = () => ruleList("screeningLists");

/* ---------------- Split purchases ---------------- */

/** Every procurement in the project, so a check can look across them (set by the workspace). */
/** The organization's supplier register, once loaded: checks read the supplier's live record. */
let supplierRegister: Supplier[] | null = null;
export function setSupplierRegister(list: Supplier[] | null) {
  supplierRegister = list;
}
/** The chosen supplier's register record, when it is linked and the register is loaded. */
export const registered = (p: Procurement) => (p.supplier?.id && supplierRegister ? (supplierRegister.find((x) => x.id === p.supplier!.id) ?? null) : null);

let everyProcurement: Procurement[] = [];
export function setProcurementSet(items: Procurement[]) {
  everyProcurement = items;
}
const LEVELS: Level[] = ["Micro", "Small", "Medium", "Large"];
/** When a request was made: its first recorded step, else when it is needed. */
const madeOn = (p: Procurement) => p.timeline[0]?.date ?? p.neededBy;
const vendorOf = (p: Procurement) => (p.supplier?.name ?? p.sole?.supplier ?? "").trim();
const sameVendor = (a: string, b: string) => !!a && !!b && (a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "") || sameSupplierName(a, b));
/** Two titles name the same item when they share a meaningful word (four letters or more, not a filler word). */
const FILLER = new Set(["with", "from", "second", "first", "third", "batch", "items", "lot", "lots", "pcs", "set", "sets", "for", "and", "the", "kit", "kits", "type", "size"]);
const words = (t: string) => new Set(t.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !FILLER.has(w)));
export const sameItem = (a: string, b: string) => {
  const wb = words(b);
  return [...words(a)].some((w) => wb.has(w));
};
/** Window for treating separate requests for the same budget line and activity as one need. Not set by the policy; the app's choice. */
export const SPLIT_WINDOW_DAYS = 30;

/**
 * Requests for the same budget line and activity made within the window whose combined value
 * reaches a higher level than this one alone: a possible split to stay under a threshold
 * (ROP April 2025 §3.2.2 p14, p26–27).
 */
export function splitRequests(p: Procurement) {
  const line = p.plan?.budgetCode ?? p.budgetLine;
  const others = everyProcurement.filter(
    (q) =>
      q.id !== p.id &&
      (q.plan?.budgetCode ?? q.budgetLine) === line &&
      q.activity === p.activity &&
      // The same item: a different item on the same line is a different need, not a split.
      ((!!p.plan && q.plan?.key === p.plan.key) || sameItem(q.title, p.title)) &&
      Math.abs(daysBetween(madeOn(q), madeOn(p))) <= SPLIT_WINDOW_DAYS,
  );
  const combined = others.reduce((s, q) => s + valueOf(q), valueOf(p));
  const alone = levelFor(valueOf(p));
  const together = levelFor(combined);
  return { others, combined, alone, together, split: LEVELS.indexOf(together) > LEVELS.indexOf(alone) };
}

/**
 * Micro purchases from this supplier within the tracking period (ROP: 12 months), this one
 * included. Repeated micro buys from one supplier must not add up past the threshold
 * (ROP April 2025 p26: tracked "so they do not reach the Small threshold").
 */
export function microWithVendor(p: Procurement) {
  const vendor = vendorOf(p);
  const months = rule("splitTrackMonths", 12);
  const since = (() => {
    const d = new Date(`${madeOn(p)}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - months);
    return d.toISOString().slice(0, 10);
  })();
  const buys = vendor ? everyProcurement.filter((q) => q.id !== p.id && levelFor(valueOf(q)) === "Micro" && sameVendor(vendorOf(q), vendor) && madeOn(q) >= since && madeOn(q) <= madeOn(p)) : [];
  const total = buys.reduce((s, q) => s + valueOf(q), valueOf(p));
  return { vendor, months, buys, total };
}

export const stages = ["Need", "Requisition", "Authorize", "Select", "Contract", "Receive", "Pay-ready", "Close"];

export type BudgetLine = { code: string; name: string; remainingValue: number; remainingQty?: number; unit?: string };

export const budgetLines: BudgetLine[] = [
  { code: "2.1", name: "Seed and planting material", remainingValue: 42000, remainingQty: 6000, unit: "kg" },
  { code: "2.2", name: "Fertilizer", remainingValue: 36000, remainingQty: 14, unit: "t" },
  { code: "2.3", name: "Crop protection equipment", remainingValue: 11000 },
  { code: "2.4", name: "Post-harvest equipment", remainingValue: 26000 },
  { code: "2.5", name: "Soil testing", remainingValue: 1500, remainingQty: 20, unit: "kits" },
  { code: "3.1", name: "Mechanization", remainingValue: 34000 },
];

export type Issue = {
  id: string;
  type: "Operational issue" | "Policy exception request" | "Post-facto action" | "Objection memo";
  note: string;
  by: Role;
  blocking: boolean;
  status: "open" | "resolved";
  resolution?: string;
};

export type TimelineEvent = { date: string; who: Role; what: string };

export type Signature = { as: string; name: string; role: Role; date: string };

/** A quotation or bid as received: who, when, how much, the file, and how it was judged. */
export type Bid = {
  id: string;
  supplier: string;
  /** Its supplier register record, when it is there. */
  supplierId?: string;
  /** Date and time received (local time, as on the receipt). */
  receivedAt: string;
  amount: number;
  currency: Currency;
  /** Afghani per dollar, for an afghani bid. */
  rate?: number;
  /** The signed quotation or bid in SharePoint. */
  evidence: string;
  /** Pass/fail on the minimum requirements; null until judged. */
  passes: boolean | null;
  failWhy: string;
  /** Best value: the committee's total score. */
  score?: number;
  /** For an unusually low bid: what the supplier showed to prove it can deliver. */
  lowNote: string;
};
/** One signed distribution list: who received the goods, where and when. */
export type DistributionList = { date: string; place: string; recipients: number; women: number; qty: number; evidence: string; by: string; byName: string };
/** Someone other than the distributors contacted a sample of recipients to confirm they received it. */
export type DistributionCheck = { on: string; sampled: number; confirmed: number; issues: string; evidence: string; by: string; byName: string };
/**
 * Goods that go to participants: the signed distribution lists, what is left in stock, and an
 * independent check on a sample (UNDP audit finding: no verification of what beneficiaries received).
 */
export type Distribution = { forParticipants: boolean; lists: DistributionList[]; inStock: number; checks: DistributionCheck[] };

/** A bid committee member and their declaration against the named bidders, signed before seeing a bid. */
export type CommitteeMember = { name: string; role: "chair" | "member"; declaredOn: string; declaration: string; conflict: boolean };

export type Procurement = {
  id: string;
  /** Version, raised by the server on every save: a save made from an older copy is refused. */
  rev?: number;
  title: string;
  qty: number;
  unit: string;
  unitPrice: number;
  budgetLine: string;
  activity: string;
  funding: string;
  neededBy: string;
  place: string;
  urgent: boolean;
  feeds?: string;
  specification: string;
  priceBasis: string;
  esRisk: string;
  signatures: Record<string, Signature[]>;
  step: string;
  checks: Record<string, boolean>;
  /** The licence is checked again on each payment date: an expired one changes the tax withheld. */
  supplier?: { name: string; screenedOn: string; licenceNo?: string; licenceExpiry?: string; /** Its record in the supplier register. */ id?: string };
  advertisedDays?: number;
  closingDate?: string;
  /** Received for the instalment under way; for works, the verified progress percentage. */
  grn?: { qty: number; place: string; progressPct?: number };
  /** Invoice for the instalment under way. */
  invoice?: Invoice;
  /** Currency the contract is priced and paid in. */
  contractCurrency?: Currency;
  /** For an afghani contract: its value in afghani, as signed. Instalments are due in afghani from it. */
  contractAfn?: number;
  /** For a dollar contract: its value in dollars, as signed. Invoices are matched to it, not to the request's estimate. */
  contractUsd?: number;
  /** Payment schedule, set with the contract. Missing: one payment of 100%. */
  schedule?: Instalment[];
  /** Instalments already paid, each with its own documents and signatures. */
  payments?: PaymentRecord[];
  /** Proof of payment for the instalment under way. */
  paid?: Paid;
  ai?: Record<string, string[]>;
  issues: Issue[];
  timeline: TimelineEvent[];
  /**
   * Started from the procurement calendar: the plan item and the project budget line it buys
   * from, as they stood when the request was made.
   */
  plan?: PlanLink;
  /** How it is bought, chosen by procurement after the request is approved. */
  route?: Route;
  /** For goods handed on to participants: distribution lists, stock and verification. */
  distribution?: Distribution;
  /** Quotations or bids received. */
  bids?: Bid[];
  /** The bid chosen. */
  selectedBid?: string;
  /** Bid committee, with each member's declaration. */
  committee?: CommitteeMember[];
  /** The bid opening: when, who was present, and the signed record. */
  opening?: { at: string; present: string; evidence: string };
  /** Sole source: the supplier and why only they can supply it. */
  sole?: { supplier: string; reason: string };
  /** AI drafts of generated documents, by document name. A person reads and corrects each one. */
  drafts?: Record<string, Draft>;
  /**
   * Documents kept in SharePoint and linked to the record: signed bids, the bid analysis, the
   * contract, delivery photos, anything filed outside the app. Each says which step it belongs to.
   */
  links?: DocLink[];
  /** Expense voucher prepared by Finance, filed in SharePoint and posted in NetSuite. */
  voucher?: Voucher;
  /** How bids are evaluated: lowest price technically acceptable, or best value. */
  evaluation?: "lowest" | "bestValue";
};

export type DocLink = { title: string; url: string; step: string; by: string; date: string };

export type Voucher = {
  number: string;
  /** Month it belongs to for monthly closeout, "2027-03". */
  month: string;
  sharepointUrl: string;
  netsuiteRef: string;
};

export const isSharePointUrl = (u: string) => /^https:\/\/[a-z0-9-]+\.sharepoint\.com\/\S+$/i.test(u.trim());

export type Route = "direct" | "rfq" | "sole";
export const ROUTES: { id: Route; title: string; detail: string }[] = [
  { id: "direct", title: "Buy directly", detail: "Micro purchases (up to $500): buy at a fair price after checking prices from three suppliers." },
  { id: "rfq", title: "Request for quotation", detail: "The app drafts the RFQ from the request; procurement checks it before it goes to suppliers." },
  { id: "sole", title: "Sole source", detail: "One supplier is uniquely placed. The app drafts the justification; the approving authority approves it before any supplier is engaged." },
];
/**
 * Routes allowed: direct purchase for Micro, competition otherwise; sole source only above its
 * threshold in force (ROP: over $5,000, April 2025 Table 1), since below it the micro and quotation rules apply.
 */
export const routesFor = (level: Level, value?: number): Route[] => {
  const base: Route[] = level === "Micro" ? ["direct"] : ["rfq"];
  return value === undefined || value > rule("soleSourceAboveUsd", 5000) ? [...base, "sole"] : base;
};

export type Draft = {
  sections: { heading: string; body: string }[];
  /** Points the drafter could not settle from the record; a person answers them. */
  questions: string[];
  model: string;
  at: string;
  by: string;
  /** Changed by a person after drafting. */
  edited: boolean;
};

export type PlanLink = {
  key: string;
  project: string;
  budgetCode: string;
  budgetName: string;
  /** Left on the line when the request was made, in USD and in the budget currency. */
  leftUsd: number;
  left: number;
  currency: string;
  approvedBy: string[];
  /** The technical lead who made the request: name, and person id. */
  requestedBy: string;
  requestedById?: string;
};

/**
 * The person holding a role on this procurement. Requests started from the procurement calendar
 * belong to their technical lead, and their procurement steps to the procurement manager;
 * otherwise the role's holder in the demo team.
 */
export function holderFor(p: Procurement, role: Role) {
  if (p.plan && role === "holder") return users.find((u) => u.id === p.plan!.requestedById) ?? users.find((u) => u.name === p.plan!.requestedBy);
  // The authority table names who holds each role type; the old per-person roles are the fallback.
  const type = typeFor(p, role);
  const ids = type ? holdersOfType(type) : [];
  if (ids.length) {
    const holders = ids.map((id) => users.find((u) => u.id === id)).filter((u): u is (typeof users)[number] => !!u);
    const manager = role === "procurement" ? holders.find((u) => /manager/i.test(u.title)) : undefined;
    if (manager ?? holders[0]) return manager ?? holders[0];
  }
  if (p.plan && role === "procurement") return users.find((u) => u.procurement.includes("procurement") && /manager/i.test(u.title)) ?? holderOf("procurement", role);
  return holderOf("procurement", role);
}

/**
 * The role type a step needs. Award approval follows the policy levels: programme management
 * up to the large threshold; the executive head for large awards and any sole source.
 */
export function typeFor(p: Pick<Procurement, "route"> & Partial<Procurement>, role: Role): HrRole | null {
  switch (role) {
    case "holder":
      return "technical";
    case "procurement":
      return "procurement";
    case "finance":
      return "finance";
    case "ho":
      return "compliance";
    case "approver":
      // Payments are approved by programme management (the team lead), whatever the award needed.
      if (p.step === "approvePay") return "management";
      return p.route === "sole" || (p.qty !== undefined && levelFor(valueOf(p as Procurement)) === "Large") ? "ceo" : "management";
    default:
      return null;
  }
}

/** A person's procurement roles: from the authority table, plus any set on their profile. */
export function procRolesFor(u: { id: string; procurement: ProcRole[] } | null | undefined): Role[] {
  if (!u) return [];
  const out = new Set<Role>(u.procurement);
  if (holdsType(u.id, "procurement")) out.add("procurement");
  if (holdsType(u.id, "finance")) out.add("finance");
  if (holdsType(u.id, "compliance")) out.add("ho");
  if (holdsType(u.id, "management") || holdsType(u.id, "ceo")) out.add("approver");
  if (holdsType(u.id, "technical")) out.add("holder");
  return [...out];
}

/** Whether this person may sign the step for this role on this procurement (an award may need the executive head). */
export function maySign(u: { id: string; procurement: ProcRole[] } | null | undefined, p: Procurement, role: Role): boolean {
  if (!u || !procRolesFor(u).includes(role)) return false;
  const type = typeFor(p, role);
  if (!type || !holdersOfType(type).length) return true;
  return holdsType(u.id, type) || (role === "holder" && holderFor(p, role)?.id === u.id);
}
/** "Farid Sultani (Budget holder)" for a role on this procurement. */
export const rolePersonFor = (p: Procurement, r: Role) => {
  const u = holderFor(p, r);
  return u ? `${u.name} (${roleLabel(r)})` : roleLabel(r);
};

export const valueOf = (p: Procurement) => p.qty * p.unitPrice;
/** The budget line a procurement buys from: the project budget when started from the calendar, else the demo budget. */
/* ---------- distribution ---------- */

/** Received so far, in the order's unit: earlier instalments plus the one under way. */
export const receivedQty = (p: Procurement) => (p.payments ?? []).reduce((s, r) => s + (r.grn?.qty ?? 0), 0) + (p.grn?.qty ?? 0);
/** Smallest sample that counts as a check: 10% of recipients, at least 5 (or all, if fewer). */
export const sampleNeeded = (recipients: number) => Math.min(recipients, Math.max(5, Math.ceil(recipients * 0.1)));

export function distributionState(p: Procurement): { ok: boolean; detail: string } | null {
  const d = p.distribution;
  if (!d?.forParticipants) return null;
  const given = d.lists.reduce((s, l) => s + l.qty, 0);
  const people = d.lists.reduce((s, l) => s + l.recipients, 0);
  const got = receivedQty(p);
  const fmt = (n: number) => n.toLocaleString("en-US");
  if (!d.lists.length) return { ok: false, detail: "No distribution list recorded yet" };
  const gap = got - given - d.inStock;
  if (Math.abs(gap) > 1e-9) return { ok: false, detail: `Received ${fmt(got)} ${p.unit}, distributed ${fmt(given)}, in stock ${fmt(d.inStock)}: ${fmt(Math.abs(gap))} ${gap > 0 ? "unaccounted for" : "more than received"}` };
  const distributors = new Set(d.lists.map((l) => l.by));
  const valid = d.checks.filter((c) => !distributors.has(c.by));
  const sampled = valid.reduce((s, c) => s + c.sampled, 0);
  const confirmed = valid.reduce((s, c) => s + c.confirmed, 0);
  const need = sampleNeeded(people);
  if (!valid.length) return { ok: false, detail: `${fmt(people)} recipients on ${d.lists.length} ${d.lists.length === 1 ? "list" : "lists"}; not yet verified by someone who did not distribute (sample of ${need} needed)` };
  if (sampled < need) return { ok: false, detail: `${sampled} of ${need} recipients contacted so far` };
  if (confirmed < sampled) return { ok: false, detail: `${sampled - confirmed} of ${sampled} contacted did not confirm receipt: ${valid.map((c) => c.issues).filter(Boolean).join("; ") || "record what was found"}` };
  return { ok: true, detail: `${fmt(given)} ${p.unit} to ${fmt(people)} people; ${confirmed} of ${sampled} sampled confirmed; ${fmt(d.inStock)} in stock` };
}

/* ---------- bids ---------- */

/** On a real project (the register is loaded) bids are records, not ticks: missing records fail. */
const recordsRequired = () => supplierRegister !== null;
const none = (what: string) => (recordsRequired() ? { ok: false, detail: what } : null);

/** A bid's amount in dollars, or null when an afghani bid has no rate. */
export const bidUsd = (b: Bid) => (b.currency === "AFN" ? (b.rate && b.rate > 0 ? b.amount / b.rate : null) : b.amount);
// An afghani bid needs its exchange rate, or it cannot be compared with the others.
const recordedBids = (p: Procurement) => (p.bids ?? []).filter((b) => b.supplier.trim() && b.amount > 0 && isSharePointUrl(b.evidence) && (b.currency !== "AFN" || (b.rate ?? 0) > 0));
/** The lowest-priced bid that passed the minimum requirements. */
export function lowestPassing(p: Procurement): Bid | null {
  const ok = (p.bids ?? []).filter((b) => b.passes === true && bidUsd(b) !== null);
  return ok.sort((a, b) => bidUsd(a)! - bidUsd(b)!)[0] ?? null;
}
/** Bids received after closing: rejected, never considered. */
export const lateBids = (p: Procurement) => (p.closingDate ? (p.bids ?? []).filter((b) => b.receivedAt.slice(0, 10) > p.closingDate!) : []);
/** Bids under 75% of the estimate: the supplier must show it can deliver. */
export const lowBids = (p: Procurement) => (p.bids ?? []).filter((b) => b.passes !== false && (bidUsd(b) ?? Infinity) < valueOf(p) * 0.75);

function quotesCheck(p: Procurement) {
  const n = recordedBids(p).length;
  const micro = levelFor(valueOf(p)) === "Micro";
  const need = micro ? rule("microPriceChecks", 3) : rule("quotesSmall", 3);
  if (!(p.bids ?? []).length) return none("Record each quotation with its file below");
  return { ok: n >= need, detail: `${n} of ${need} ${micro ? "prices" : "written quotations"} recorded with the file${n < need && !micro ? ": file a memo explaining why fewer" : ""}` };
}
function lowestCheck(p: Procurement, money: Money) {
  if (!(p.bids ?? []).length) return none("Record the bids below, then mark the one chosen");
  const low = lowestPassing(p);
  const chosen = (p.bids ?? []).find((b) => b.id === p.selectedBid);
  if (!chosen) return { ok: false, detail: "Mark the bid chosen" };
  if (!low) return { ok: false, detail: "No bid has passed the minimum requirements" };
  return { ok: chosen.id === low.id, detail: chosen.id === low.id ? `${chosen.supplier}: ${money(bidUsd(chosen)!)}, the lowest that passed` : `${chosen.supplier} chosen, but ${low.supplier} passed at ${money(bidUsd(low)!)}, lower` };
}
function qualifyCheck(p: Procurement) {
  const bids = p.bids ?? [];
  if (!bids.length) return none("Record the bids below and judge each against the minimum requirements");
  const open = bids.filter((b) => b.passes === null);
  const unexplained = bids.filter((b) => b.passes === false && !b.failWhy.trim());
  const late = lateBids(p).filter((b) => b.passes !== false);
  const noRate = bids.filter((b) => b.currency === "AFN" && !((b.rate ?? 0) > 0));
  if (noRate.length) return { ok: false, detail: `Add the exchange rate for ${noRate.map((b) => b.supplier || "the afghani bid").join(", ")}, so it can be compared` };
  if (late.length) return { ok: false, detail: `Received after closing and not rejected: ${late.map((b) => b.supplier).join(", ")}` };
  return { ok: !open.length && !unexplained.length, detail: open.length ? `${open.length} not judged yet` : unexplained.length ? `Say why ${unexplained.map((b) => b.supplier).join(", ")} failed` : `${bids.filter((b) => b.passes).length} of ${bids.length} passed` };
}
function lowBidCheck(p: Procurement) {
  if (!(p.bids ?? []).length) return none("Record the bids first");
  const low = lowBids(p);
  const open = low.filter((b) => !b.lowNote.trim());
  return { ok: !open.length, detail: !low.length ? "No bid under 75% of the estimate" : open.length ? `Under 75% of the estimate, not yet explained: ${open.map((b) => b.supplier).join(", ")}` : `Explained: ${low.map((b) => b.supplier).join(", ")}` };
}
function openingCheck(p: Procurement) {
  const o = p.opening;
  if (!o) return (p.bids ?? []).length ? { ok: false, detail: "Record the opening: when, who was present, and the signed record" } : none("Record the bids and the opening below");
  if (!isSharePointUrl(o.evidence)) return { ok: false, detail: "Link the signed opening record in SharePoint" };
  if (p.closingDate && o.at.slice(0, 10) < p.closingDate) return { ok: false, detail: `Opened ${o.at.slice(0, 10)}, before closing on ${p.closingDate}` };
  const missing = (p.bids ?? []).filter((b) => !b.receivedAt);
  return { ok: !missing.length && recordedBids(p).length === (p.bids ?? []).length, detail: missing.length ? "Every bid needs its receipt time" : `Opened ${o.at.replace("T", " ")} with ${o.present}; ${(p.bids ?? []).length} bids` };
}
function declareCheck(p: Procurement) {
  const c = p.committee ?? [];
  if (!c.length) return none("Name the committee members and link each declaration below");
  const sitting = c.filter((m) => !m.conflict);
  const undeclared = c.filter((m) => !m.declaredOn || !isSharePointUrl(m.declaration));
  const late = p.opening ? c.filter((m) => m.declaredOn && m.declaredOn > p.opening!.at.slice(0, 10)) : [];
  const chair = sitting.some((m) => m.role === "chair");
  if (undeclared.length) return { ok: false, detail: `Declaration missing: ${undeclared.map((m) => m.name || "unnamed").join(", ")}` };
  if (late.length) return { ok: false, detail: `Declared after the bids were opened: ${late.map((m) => m.name).join(", ")}` };
  return { ok: sitting.length >= 3 && chair, detail: `${sitting.length} members sitting${c.length > sitting.length ? `, ${c.length - sitting.length} withdrawn (conflict)` : ""}${chair ? "" : ", no chair"}${sitting.length < 3 ? ": at least three needed" : ""}` };
}

/**
 * Money other open procurements on the same budget line are committed to, not yet paid: the
 * contract value once recorded, or the estimate, less instalments already paid. Without it two
 * requests could each pass against the same money.
 */
export function committedOn(p: Procurement) {
  const line = p.plan?.budgetCode ?? p.budgetLine;
  const others = everyProcurement
    .filter((q) => q.id !== p.id && q.step !== DONE && (q.plan?.budgetCode ?? q.budgetLine) === line && (!p.plan || q.plan?.project === p.plan.project))
    .map((q) => {
      const value = contractCurrency(q) === "USD" && q.contractUsd && q.contractUsd > 0 ? q.contractUsd : valueOf(q);
      const paid = (q.payments ?? []).reduce((s, r) => s + (r.invoice.currency === "AFN" ? (r.invoice.rate ? r.invoice.amount / r.invoice.rate : 0) : r.invoice.amount), 0);
      return { id: q.id, open: Math.max(0, value - paid) };
    })
    .filter((o) => o.open > 0);
  return { others, total: others.reduce((s, o) => s + o.open, 0) };
}

export const lineOf = (p: Procurement): BudgetLine | undefined =>
  p.plan ? { code: p.plan.budgetCode, name: p.plan.budgetName, remainingValue: p.plan.leftUsd } : budgetLines.find((b) => b.code === p.budgetLine);

/** The demo projects' fixed date, for their synthetic procurements. Checks use `today()`. */
export const TODAY = DEMO_DATE;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export type CheckResult = { ok: boolean; detail: string };

export type Check = {
  id: string;
  label: string;
  why: string;
  tag: string;
  /** System-checked from the record. Returning null falls back to a manual tick. */
  auto?: (p: Procurement, money: Money) => CheckResult | null;
  /** AI pre-check: findings shown, a person confirms they reviewed them. */
  ai?: boolean;
  /** Suggested issue when an automatic check fails. */
  fix?: string;
  /** One-click record of the fix that clears a failed automatic check. */
  resolve?: string;
};

export type Step = {
  id: string;
  stage: number;
  title: string;
  owner: Role;
  levels: Level[];
  action: string;
  done: string;
  gate?: string;
  canReturn?: boolean;
  produces: string[];
  /** The generated document this step's owner signs on completing it. */
  signs?: { doc: string; as: string };
  note?: string;
  checks: Check[];
  /** Included only when this holds, e.g. competitive steps only when not sole source. */
  when?: (p: Procurement) => boolean;
};

const ALL: Level[] = ["Micro", "Small", "Medium", "Large"];
const SMALL_UP: Level[] = ["Small", "Medium", "Large"];
const OPEN_COMP: Level[] = ["Medium", "Large"];
/** Competitive steps are skipped on the sole-source route. */
const competitive = (p: Procurement) => p.route !== "sole";
/** The committee's evaluation: competition, and a sole source too where the policy keeps the normal process (ROP April 2025 §4.6). */
const evaluated = (p: Procurement) => competitive(p) || (p.route === "sole" && rules.soleSourceKeepsSteps === true);
const fmt = (n: number) => n.toLocaleString("en-US");

export const steps: Step[] = [
  {
    id: "need",
    stage: 0,
    title: "Confirm the need",
    owner: "holder",
    levels: ALL,
    action: "Confirm need",
    done: "Need confirmed",
    produces: [],
    checks: [
      { id: "activity", label: "Tied to an activity in the approved workplan", why: "A purchase that cannot be tied to a workplan activity and its result is not procured.", tag: "D1 §2.7" },
      { id: "spec", label: "Specification confirmed with technical staff", why: "Specifications describe what is needed without restricting competition. Brand names only with equivalents accepted.", tag: "D1 §2.7, §4.1" },
      { id: "leadtime", label: "Lead time fits the activity date", why: "If the market cannot deliver in time, re-plan the activity. Do not shorten the procurement.", tag: "D1 §2.7" },
    ],
  },
  {
    id: "requisition",
    stage: 1,
    title: "Submit the requisition",
    owner: "holder",
    levels: ALL,
    action: "Submit requisition",
    done: "Requisition submitted",
    produces: ["Purchase requisition", "Price reasonableness"],
    signs: { doc: "Purchase requisition", as: "Submitted by (budget holder)" },
    checks: [
      {
        id: "budgetValue",
        label: "Budget line has enough value left",
        why: "Check what remains on the line, not whether the line exists. A shortfall is agreed with the funder before approval.",
        tag: "D1 §4.1",
        fix: "Budget revision needed: agree with the funder before approval.",
        resolve: "Record funder-approved revision",
        auto: (p, money) => {
          const l = lineOf(p);
          if (!l) return null;
          // Other open requests on the line have a claim on the same money.
          const c = committedOn(p);
          const free = l.remainingValue - c.total;
          const held = c.others.length ? ` less ${money(c.total)} committed to ${c.others.map((o) => o.id).join(", ")}` : "";
          return { ok: valueOf(p) <= free, detail: `Needs ${money(valueOf(p))} · ${money(l.remainingValue)} left on ${l.code}${held}${held ? ` = ${money(free)} free` : ""}` };
        },
      },
      {
        id: "budgetQty",
        label: "Budget line has enough quantity left",
        why: "Where the funder budgets quantities, quantity is checked too. A funder can reject a cost on unit cost, quantity or total.",
        tag: "D1 §4.1; OPEN scope",
        fix: "Quantity exceeds what the funder approved: agree a revision before approval.",
        resolve: "Record funder-approved revision",
        auto: (p) => {
          const l = lineOf(p);
          if (!l || l.remainingQty === undefined) return { ok: true, detail: "Funder does not budget quantity on this line" };
          return { ok: p.qty <= l.remainingQty, detail: `Needs ${fmt(p.qty)} ${p.unit} · ${fmt(l.remainingQty)} ${l.unit} left` };
        },
      },
      {
        id: "price",
        label: "Price basis recorded",
        why: "Past purchases, agreement prices, catalogs or a market survey, with the source. Without it the requisition is returned.",
        tag: "D1 §4.2",
        auto: (p) => ({ ok: p.priceBasis.trim().length > 0, detail: p.priceBasis.trim() || "Add it in the requisition form above" }),
      },
      {
        id: "esrisk",
        label: "Environmental or social risk recorded (or none)",
        why: "Chemicals, fuel, works, waste, safety-relevant equipment or supplier labor must be flagged on the requisition.",
        tag: "D1 §2.8",
        auto: (p) => ({ ok: p.esRisk.trim().length > 0, detail: p.esRisk.trim() || "Add it in the requisition form above" }),
      },
    ],
  },
  {
    id: "approveReq",
    stage: 2,
    title: "Approve the requisition",
    owner: "approver",
    levels: ALL,
    action: "Approve requisition",
    done: "Requisition approved (Gate A)",
    gate: "A",
    canReturn: true,
    produces: [],
    signs: { doc: "Purchase requisition", as: "Approved by" },
    note: "No supplier may be approached until this is approved.",
    checks: [
      { id: "noContact", label: "No supplier has been approached yet", why: "Requisition approval comes before any supplier is approached, at every level. Otherwise it is a post-facto action.", tag: "D1 §3.2" },
      { id: "reviewed", label: "Requisition reviewed and complete", why: "The approver relies on the budget, price basis and activity link shown above.", tag: "D1 §3.2" },
      {
        id: "notSplit",
        label: "Not split from a larger need",
        why: `Requests for the same budget line and activity made within ${SPLIT_WINDOW_DAYS} days are added together; if together they reach a higher level, they are one purchase at that level.`,
        tag: "ROP April 2025 §3.2.2 p14, p26–27",
        fix: "Possible split purchase: combine the requests and buy at the combined level, or record why they are separate needs.",
        resolve: "Separate needs, recorded",
        auto: (p, money) => {
          const s = splitRequests(p);
          if (!s.others.length) return { ok: true, detail: "No other request for this line and activity nearby" };
          const list = s.others.map((q) => `${q.id} ${money(valueOf(q))}`).join(", ");
          return s.split
            ? { ok: false, detail: `With ${list}: ${money(s.combined)} together, a ${s.together} purchase, not ${s.alone}` }
            : { ok: true, detail: `With ${list}: ${money(s.combined)} together, still ${s.together}` };
        },
      },
      {
        id: "donorApproval",
        label: "Donor prior approval, where the donor requires it",
        get why() {
          const above = rules.donorApprovalAboveUsd;
          const goods = ruleList("restrictedGoods");
          return `Needed above ${typeof above === "number" ? `$${above.toLocaleString("en-US")}` : "no set amount"}${goods.length ? ` and for restricted goods (${goods.join(", ")})` : ""}, before any supplier is approached.`;
        },
        tag: "Donor rules",
        auto: (p) => {
          const above = rules.donorApprovalAboveUsd;
          const hits = restrictedHits(p);
          const overLimit = typeof above === "number" && valueOf(p) > above;
          // Not needed: passes on its own. Needed: a person ticks it once the donor's written approval is on file.
          return hits.length || overLimit ? null : { ok: true, detail: "Not needed under the donor's rules" };
        },
      },
    ],
  },
  {
    id: "route",
    stage: 3,
    title: "Choose how to buy",
    owner: "procurement",
    levels: ALL,
    action: "Confirm the route",
    done: "Route chosen",
    produces: [],
    note: "Direct purchase is for Micro only. Sole source needs a written justification approved before any supplier is engaged.",
    checks: [
      {
        id: "chosen",
        label: "Route chosen and allowed at this level",
        why: "Micro: direct purchase after market pricing. Small and above: competition by request for quotation. Sole source at any level with an approved justification.",
        tag: "D1 §5.1–5.5",
        auto: (p) =>
          !p.route
            ? { ok: false, detail: "Choose a route above" }
            : { ok: routesFor(levelFor(valueOf(p)), valueOf(p)).includes(p.route), detail: `${ROUTES.find((r) => r.id === p.route)!.title} · ${levelFor(valueOf(p))} level` },
      },
    ],
  },
  {
    id: "rfq",
    stage: 3,
    title: "Prepare the request for quotation",
    owner: "procurement",
    levels: ["Small"],
    when: (p) => p.route === "rfq",
    action: "Issue to suppliers",
    done: "Request for quotation ready",
    produces: ["Request for quotation"],
    signs: { doc: "Request for quotation", as: "Prepared by (procurement)" },
    checks: [
      { id: "draft", label: "Request for quotation drafted", why: "Drafted from the approved request so nothing is typed twice.", tag: "TS", auto: (p) => ({ ok: !!p.drafts?.["Request for quotation"], detail: p.drafts?.["Request for quotation"] ? `Drafted ${p.drafts["Request for quotation"].at}` : "Draft it above" }) },
      { id: "read", label: "Draft read and corrected by a person", why: "AI drafts; procurement decides what goes to suppliers.", tag: "TS" },
      { id: "terms", label: "Deadline, validity and lowest-compliant-price basis stated once", why: "A quotation is only rejected on grounds the request stated.", tag: "D1 §4.4, §5.2" },
    ],
  },
  {
    id: "soleSource",
    stage: 3,
    title: "Justify the sole source",
    owner: "procurement",
    levels: ALL,
    when: (p) => p.route === "sole",
    action: "Send for approval",
    done: "Sole source justification prepared",
    produces: ["Sole source justification"],
    signs: { doc: "Sole source justification", as: "Prepared by (procurement)" },
    checks: [
      { id: "facts", label: "Supplier named and the reason only they can supply it recorded", why: "The justification rests on facts procurement can show.", tag: "D1 §5.5", auto: (p) => ({ ok: !!p.sole?.supplier.trim() && (p.sole?.reason.trim().length ?? 0) > 20, detail: p.sole?.supplier ? `${p.sole.supplier}` : "Add them above" }) },
      { id: "draft", label: "Justification drafted", why: "Drafted from the request and the facts above.", tag: "TS", auto: (p) => ({ ok: !!p.drafts?.["Sole source justification"], detail: p.drafts?.["Sole source justification"] ? `Drafted ${p.drafts["Sole source justification"].at}` : "Draft it above" }) },
      { id: "read", label: "Draft read and corrected by a person", why: "AI drafts; procurement stands behind every statement in it.", tag: "TS" },
      { id: "price", label: "Price shown to be reasonable without competition", why: "Past prices, market data or a cost breakdown. Without competition, this is the only price check.", tag: "D1 §4.2, §5.5" },
    ],
  },
  {
    id: "approveSole",
    stage: 3,
    title: "Approve the sole source",
    owner: "approver",
    levels: ALL,
    when: (p) => p.route === "sole",
    action: "Approve sole source",
    done: "Sole source approved",
    produces: [],
    signs: { doc: "Sole source justification", as: "Approved by" },
    canReturn: true,
    note: "Approved before the supplier is engaged, at any value.",
    checks: [
      { id: "before", label: "No order placed with the supplier yet", why: "Sole source approval comes before the procurement begins. Otherwise it is a post-facto action.", tag: "D1 §3.2, §5.5" },
      { id: "grounds", label: "The grounds hold up", why: "Read the justification: is this supplier really the only one, and is the price reasonable?", tag: "D1 §5.5" },
      {
        id: "donorSole",
        label: "The donor's written agreement is on file",
        why: "Where the donor requires it (UNDP: competition unless it agrees otherwise in writing, RPA Art. 8.1), on top of the organization's own approval.",
        tag: "Donor rules",
        auto: () => (rules.soleSourceDonorApproval === true ? null : { ok: true, detail: "Not required by this project's donor" }),
      },
    ],
  },
  {
    id: "quotes",
    when: competitive,
    stage: 3,
    title: "Get quotations and pick the supplier",
    owner: "procurement",
    levels: ["Micro", "Small"],
    action: "Record selection",
    done: "Supplier selected from quotations",
    produces: ["Quotations", "Screening record", "Source selection memo"],
    signs: { doc: "Source selection memo", as: "Prepared by (procurement)" },
    checks: [
      { id: "three", label: "Three suppliers priced (written quotes above $500)", why: "Micro: market pricing from three suppliers. Small: three written quotations, or a memo explaining why fewer.", tag: "D1 §5.1, §5.2", resolve: "Memo explaining fewer quotations filed", auto: (p) => quotesCheck(p) },
      { id: "lowest", label: "Lowest price that meets the specification chosen", why: "Small purchases are awarded to the lowest compliant quotation.", tag: "D1 §5.2", auto: (p, money) => lowestCheck(p, money) },
      { id: "screened", label: "Supplier screened and the result reviewed by a person", why: "No order or payment to any party before screening. A person reviews every result.", tag: "D1 §4.8; TS" },
    ],
  },
  {
    id: "solicitation",
    when: competitive,
    stage: 2,
    title: "Prepare the solicitation",
    owner: "procurement",
    levels: OPEN_COMP,
    action: "Send for approval",
    done: "Solicitation prepared",
    produces: ["Solicitation (RFQ/RFP)", "Evaluation plan"],
    signs: { doc: "Solicitation (RFQ/RFP)", as: "Prepared by (procurement)" },
    checks: [
      { id: "method", label: "Instrument and method match (RFQ with lowest price, RFP with best value)", why: "The two go together so they are never mixed in one solicitation.", tag: "D1 §4.3" },
      { id: "passfail", label: "Pass/fail requirements kept separate from scored criteria", why: "A total score never stands in for a minimum requirement.", tag: "D1 §4.4" },
      { id: "terms", label: "Submission terms, bid validity, protest route and reporting channel stated once", why: "A bid is only rejected on submission grounds the solicitation stated.", tag: "D1 §4.4" },
    ],
  },
  {
    id: "hoReview",
    when: competitive,
    stage: 2,
    title: "Home Office compliance review",
    owner: "ho",
    levels: ["Large"],
    action: "Clear for issue",
    done: "Cleared by Home Office",
    canReturn: true,
    produces: ["HO review clearance"],
    signs: { doc: "Solicitation (RFQ/RFP)", as: "Compliance cleared by (Home Office)" },
    note: "Target: 3 working days from a complete submission.",
    checks: [
      { id: "aiSol", label: "AI consistency pre-check reviewed", why: "Weights sum as stated, every annex exists, thresholds read the same everywhere. AI flags; the reviewer decides.", tag: "D1 §5.4; TS", ai: true },
      { id: "fixes", label: "Required corrections confirmed as applied", why: "The reviewer who required a correction confirms it in writing.", tag: "D1 §4.17" },
    ],
  },
  {
    id: "approveSol",
    when: competitive,
    stage: 2,
    title: "Approve the solicitation",
    owner: "approver",
    levels: OPEN_COMP,
    action: "Approve solicitation",
    done: "Solicitation approved (Gate B)",
    gate: "B",
    canReturn: true,
    produces: [],
    signs: { doc: "Solicitation (RFQ/RFP)", as: "Approved for issue by" },
    note: "Criteria are locked once approved.",
    checks: [
      { id: "plan", label: "Evaluation plan (and bid plan for Large) approved", why: "Approved before issue. Large also fixes the committee membership.", tag: "D1 §3.2, §5.4" },
    ],
  },
  {
    id: "bids",
    when: competitive,
    stage: 3,
    title: "Advertise and open bids",
    owner: "procurement",
    levels: OPEN_COMP,
    action: "Hand to committee",
    done: "Bids opened",
    produces: ["Proof of advertising", "Bid opening record"],
    signs: { doc: "Bid opening record", as: "Recorded by (procurement)" },
    checks: [
      {
        id: "advert",
        label: "Advertised long enough",
        get why() {
          return `At least ${rule("advertisingDays", 10)} days, or ${rule("advertisingDaysLarge", 14)} for Large, from first publication, and no more than ${rule("bidPeriodMaxDays", 30)}: the stricter of the organization's and the donor's rules.`;
        },
        tag: "ROP April 2025 §3.2.9, §4.5; donor rules",
        auto: (p) => {
          if (p.advertisedDays === undefined) return null;
          const need = levelFor(valueOf(p)) === "Large" ? rule("advertisingDaysLarge", 14) : rule("advertisingDays", 10);
          const cap = rule("bidPeriodMaxDays", 30);
          return { ok: p.advertisedDays >= need && p.advertisedDays <= cap, detail: `Advertised ${p.advertisedDays} days; the rules in force need ${need} to ${cap}` };
        },
      },
      {
        id: "sealed",
        label: "Bids held sealed until closing",
        why: "Held by two senior managers outside procurement. Nothing opened before closing.",
        tag: "D1 §4.6",
        auto: (p) => (p.closingDate ? { ok: daysBetween(p.closingDate, today()) >= 0, detail: `Closing ${p.closingDate}` } : null),
      },
      { id: "opening", label: "Opening record signed, with each bid's receipt time", why: "A signed record in its own right, not a table inside the selection memo.", tag: "D1 §4.6", auto: (p) => openingCheck(p) },
    ],
  },
  {
    id: "evaluateWaived",
    // Below the committee threshold, on lowest price, programme management may waive the committee (ROP April 2025 §3.2.6).
    when: (p) => competitive(p) && !committeeNeeded(p),
    stage: 3,
    title: "Evaluate the bids (committee waived)",
    owner: "procurement",
    levels: OPEN_COMP,
    action: "Sign selection memo",
    done: "Source selection memo signed",
    produces: ["Committee waiver", "Evaluation sheet", "Source selection memo"],
    signs: { doc: "Source selection memo", as: "Evaluated by (procurement)" },
    checks: [
      { id: "waiver", label: "Programme management signed the committee waiver", why: "Allowed only for lowest-price evaluations at or below the committee threshold; best value always needs a committee.", tag: "ROP April 2025 §3.2.6" },
      { id: "qualify", label: "Pass/fail checked before choosing", why: "A bid that fails a minimum requirement is not considered.", tag: "ROP April 2025 §3.2.7", auto: (p) => qualifyCheck(p) },
      { id: "lowest", label: "Lowest price that meets every requirement chosen", why: "Lowest price technically acceptable.", tag: "ROP April 2025 §3.2.7", auto: (p, money) => lowestCheck(p, money) },
    ],
  },
  {
    id: "evaluate",
    // A committee for best value and above the threshold; a sole source keeps its committee review where the policy says so.
    when: (p) => evaluated(p) && (committeeNeeded(p) || p.route === "sole"),
    stage: 3,
    title: "Evaluate the bids",
    owner: "committee",
    levels: OPEN_COMP,
    action: "Sign selection memo",
    done: "Source selection memo signed",
    produces: ["Committee declarations", "Evaluation sheets", "Source selection memo"],
    signs: { doc: "Source selection memo", as: "Committee chair" },
    checks: [
      { id: "declare", label: "Every member declared against the named bidder list", why: "Signed before anyone sees a bid. A member connected to a bidder withdraws.", tag: "D1 §4.7", auto: (p) => declareCheck(p) },
      { id: "qualify", label: "Pass/fail checked before any scoring", why: "A bid that fails a minimum requirement is not scored or ranked.", tag: "D1 §4.4", auto: (p) => qualifyCheck(p) },
      { id: "lowbid", label: "Unusually low bids investigated", why: "Roughly 20–30% under the price basis: ask for proof the supplier can deliver.", tag: "D1 §4.7", auto: (p) => lowBidCheck(p) },
    ],
  },
  {
    id: "screen",
    stage: 3,
    title: "Screen the chosen supplier",
    owner: "procurement",
    levels: ALL,
    // Screening and vendor documents at every level where the policy says so (ROP April 2025 checklists p26–39).
    when: (p) => rules.dueDiligenceAllLevels === true || OPEN_COMP.includes(levelFor(valueOf(p))) || p.route === "sole",
    action: "Send for award",
    done: "Supplier screened",
    produces: ["Screening record", "Due diligence"],
    signs: { doc: "Screening record", as: "Screened and reviewed by" },
    checks: [
      {
        id: "lists",
        label: "Checked against every list the rules require",
        get why() {
          const lists = screeningLists();
          return lists.length ? `Lists in force for this project: ${lists.join("; ")}.` : "Which lists depends on the funding source.";
        },
        tag: "ROP April 2025 §3.2.12; donor rules",
      },
      { id: "human", label: "Result reviewed by a person; any match resolved with reasons", why: "Every screening result is reviewed before the workflow continues. A match means exclusion.", tag: "TS" },
      {
        id: "vendorTotal",
        label: "Micro buys from this supplier within the limit",
        get why() {
          return `Micro purchases from one supplier are added up over ${rule("splitTrackMonths", 12)} months. Past the micro limit, spread purchases across suppliers or ask for quotations.`;
        },
        tag: "ROP April 2025 p26",
        fix: "Repeat micro purchases from one supplier are over the limit: get quotations for this one, or use another supplier.",
        resolve: "Quotations obtained or supplier changed",
        auto: (p, money) => {
          if (levelFor(valueOf(p)) !== "Micro") return { ok: true, detail: "Not a micro purchase" };
          const v = microWithVendor(p);
          if (!v.vendor) return { ok: false, detail: "Name the supplier above" };
          const limit = rule("microMaxUsd", 500);
          const detail = `${v.vendor}: ${money(v.total)} in ${v.buys.length + 1} micro ${v.buys.length ? "purchases" : "purchase"} over ${v.months} months`;
          if (v.total > rule("smallMaxUsd", 5000)) return { ok: false, detail: `${detail}, past the quotation limit too` };
          return { ok: v.total <= limit, detail: v.total <= limit ? detail : `${detail}, past the ${money(limit)} micro limit` };
        },
      },
      {
        id: "dd",
        label: "Licence, ID (tazkira) and bank details on file; no staff connection",
        get why() {
          return rules.dueDiligenceAllLevels === true ? "Vendor documents at every level, including Micro." : "Due diligence at Medium and above, from evidence submitted with the bid.";
        },
        tag: "ROP April 2025 checklists p26–39",
        auto: (p) => {
          if (!supplierRegister) return null;
          const r = registered(p);
          if (!r) return { ok: false, detail: "Pick the supplier from the supplier register" };
          const gaps = supplierGaps(r, today(), rule("rescreenMonths", 6)).filter((g) => !/screen/i.test(g));
          return { ok: !gaps.length, detail: gaps.length ? `${r.name}: ${gaps.join("; ")}` : `${r.name}: licence ${r.licenceNo} to ${r.licenceExpiry}, bank confirmed ${r.bank!.on}, declaration on file` };
        },
      },
    ],
  },
  {
    id: "approveAward",
    stage: 3,
    title: "Approve the award",
    owner: "approver",
    levels: SMALL_UP,
    action: "Approve award",
    done: "Award approved (Gate C)",
    gate: "C",
    canReturn: true,
    produces: ["Unsuccessful bidder notices"],
    signs: { doc: "Source selection memo", as: "Award approved by" },
    note: "Nothing is committed to a supplier before this.",
    checks: [
      { id: "ssm", label: "Selection memo matches the published criteria", why: "The basis for award is stated exactly as in the solicitation.", tag: "D1 §4.9" },
      { id: "hoPackage", label: "Large only: Home Office approved the full package", why: "Incomplete packages are returned unreviewed.", tag: "D1 §5.4" },
    ],
  },
  {
    id: "contract",
    stage: 4,
    title: "Prepare the contract",
    owner: "procurement",
    levels: SMALL_UP,
    action: "Send for signature",
    done: "Contract checked (checklist pass 1)",
    produces: ["Contract / PO", "Conformity check", "Checklist pass 1"],
    signs: { doc: "Contract / PO", as: "Prepared and checked by (procurement)" },
    checks: [
      { id: "clauses", label: "Required clauses present", why: "Audit, records, anti-corruption, safeguarding, labor, E&S, data, IP, termination, subcontracting.", tag: "D1 §4.11" },
      { id: "aiConform", label: "AI conformity check reviewed", why: "Contract compared with the solicitation, winning bid and donor annex before signature. AI flags; a person records the check.", tag: "D1 §4.11; TS", ai: true },
      { id: "pass1", label: "Checklist pass 1 complete", why: "The first of two points where a procurement can still be stopped.", tag: "D1 §4.17" },
      {
        id: "schedule",
        label: "Payment schedule matches the contract and adds up to 100%",
        why: "Each instalment is paid only against work or goods received for it, with its own received note, invoice and approval.",
        tag: "Finance Manual; ACRP payment packages",
        auto: (p) => {
          const s = scheduleOf(p);
          const t = scheduleTotal(p);
          const valueMissing = contractCurrency(p) === "AFN" ? !(p.contractAfn && p.contractAfn > 0) : !(p.contractUsd && p.contractUsd > 0);
          return {
            ok: t === 100 && s.every((i) => i.pct > 0) && !valueMissing,
            detail: `${s.length === 1 ? "One payment" : s.map((i) => `${i.label} ${i.pct}%`).join(" · ")} · in ${contractCurrency(p)}${t === 100 ? "" : ` · adds up to ${t}%`}${valueMissing ? " · enter the contract value as signed" : ""}`,
          };
        },
      },
    ],
  },
  {
    id: "sign",
    stage: 4,
    title: "Approve signature",
    owner: "approver",
    levels: SMALL_UP,
    action: "Approve and sign",
    done: "Contract signed (Gate D)",
    gate: "D",
    canReturn: true,
    produces: [],
    signs: { doc: "Contract / PO", as: "Signed for Roots of Peace" },
    note: "Signing is the commitment.",
    checks: [
      { id: "corrections", label: "No required correction outstanding", why: "A contract is not signed while a correction is outstanding.", tag: "D1 §4.17" },
      { id: "manager", label: "Contract manager named", why: "Tracks delivery, timelines and supplier performance after award.", tag: "D1 §4.15" },
    ],
  },
  {
    id: "receive",
    stage: 5,
    title: "Receive and inspect",
    owner: "holder",
    levels: ALL,
    action: "Sign received note",
    done: "Goods received note signed",
    produces: ["Goods received note"],
    signs: { doc: "Goods received note", as: "Received and inspected by" },
    note: "The requester inspects, not procurement. With instalments, each payment has its own received note for what was delivered or completed since the last one.",
    checks: [
      {
        id: "qtyMatch",
        label: "What was received covers this payment",
        why: "Certification is a real check. Goods are counted; works are measured by progress verified on site. Discrepancies go to procurement before payment.",
        tag: "D1 §4.12",
        fix: "Short delivery: notify the supplier in writing within 15 days.",
        resolve: "Record that the balance was delivered",
        auto: (p) => receiptCovers(p),
      },
      {
        id: "placeMatch",
        label: "Received at the contract delivery point, or the reason is on the note",
        why: "A different place, the reason and who verifies on arrival are written on the GRN itself.",
        tag: "D1 §4.12",
        resolve: "Reason and verifier recorded on the note",
        auto: (p) => (p.grn ? { ok: p.grn.place === p.place, detail: `Received at ${p.grn.place}` } : null),
      },
      { id: "inspected", label: "Quality inspected against the specification", why: "Once receipt is certified, little remedy is left.", tag: "D1 §4.12" },
    ],
  },
  {
    id: "package",
    stage: 6,
    title: "Assemble the procurement package",
    owner: "procurement",
    levels: ALL,
    action: "Send to Finance",
    done: "Procurement package sent to Finance",
    produces: ["Procurement package"],
    signs: { doc: "Procurement package", as: "Prepared by (procurement)" },
    note: "One file for Finance: every document, approval and check, with a cover memo.",
    checks: [
      {
        id: "memo",
        label: "Cover memo drafted and corrected",
        why: "Summarises what was bought, how, from whom, for how much, and anything outstanding.",
        tag: "TS",
        auto: (p) => ({ ok: !!p.drafts?.["Procurement package"]?.edited, detail: !p.drafts?.["Procurement package"] ? "Draft it above" : p.drafts["Procurement package"].edited ? "Corrected" : "Drafted: read and correct it" }),
      },
      { id: "aiPackage", label: "AI completeness check reviewed", why: "Missing documents, approvals out of order and figures that do not match. AI flags; procurement decides.", tag: "D1 §4.17; TS", ai: true },
      { id: "filed", label: "Every document filed under the procurement ID", why: "Finance and auditors find the whole record in one place.", tag: "D1 §4.16" },
    ],
  },
  {
    id: "payForm",
    stage: 6,
    title: "Prepare the payment approval form",
    owner: "procurement",
    levels: ALL,
    action: "Send to Finance",
    done: "Payment approval form prepared",
    produces: ["Payment approval form"],
    signs: { doc: "Payment approval form", as: "Prepared by (procurement)" },
    note: "Enter the invoice and the supplier's licence. The form works out the tax to withhold and the amount to pay.",
    checks: [
      {
        id: "invoice",
        label: "Invoice recorded: number, date, amount and currency",
        why: "The form is built from the invoice; nothing is typed twice.",
        tag: "Finance Manual",
        auto: (p) => {
          const i = p.invoice;
          const ok = !!i && !!i.number?.trim() && !!i.date && i.amount > 0 && ((i.currency ?? "USD") === "USD" || (i.rate ?? 0) > 0);
          return { ok, detail: i ? `Invoice ${i.number || "[number]"} of ${i.date || "[date]"} · ${i.currency ?? "USD"} ${i.amount.toLocaleString("en-US")}${(i.currency ?? "USD") === "AFN" && !i.rate ? " · add the exchange rate" : ""}` : "Enter the invoice above" };
        },
      },
      {
        id: "duplicate",
        label: "This invoice has not been paid before",
        why: "UNDP's spot checks flagged invoices that could be paid twice. Every paid invoice is marked against its procurement and payment number.",
        tag: "UNDP spot check 2022, 2025",
        auto: (p) => {
          if (!p.invoice?.number?.trim()) return null;
          const d = duplicateInvoices(p, everyProcurement.some((q) => q.id === p.id) ? everyProcurement.map((q) => (q.id === p.id ? p : q)) : [...everyProcurement, p]);
          return { ok: !d.length, detail: d.length ? `Invoice ${p.invoice.number} from this supplier is already on ${d.join(", ")}` : `No other payment of invoice ${p.invoice.number}` };
        },
        fix: "Possible duplicate invoice: stop and check with the supplier and Finance.",
      },
      {
        id: "licence",
        label: "Supplier's business licence checked on the payment date",
        why: "The tax withheld depends on it: 2% with a valid licence, 7% without. UNDP's 2022 spot check found tax under-withheld from a supplier whose licence had expired before payment.",
        tag: "Income Tax Law 2009 Art. 72; UNDP spot check 2022",
        auto: (p) => {
          const e = p.supplier?.licenceExpiry;
          if (!e) return { ok: false, detail: "Record the licence expiry date above (from the licence copy on file)" };
          return { ok: true, detail: licenceValid(e, today()) ? `Valid until ${e}` : `Expired ${e}: withhold at the unlicensed rate` };
        },
      },
    ],
  },
  {
    id: "payReady",
    stage: 6,
    title: "Check the payment",
    owner: "finance",
    levels: ALL,
    action: "Send for approval",
    done: "Payment checked and verified by Finance (Gate E)",
    gate: "E",
    produces: ["Invoice match", "Payee verification", "Checklist pass 2"],
    signs: { doc: "Payment approval form", as: "Checked by (finance)" },
    checks: [
      {
        id: "match",
        label: "Invoice matches the contract, this instalment and the received note",
        why: "Three-way match on amount and quantity, instalment by instalment.",
        tag: "TS",
        resolve: "Record corrected invoice or credit note",
        auto: (p) => invoiceMatches(p),
      },
      {
        id: "taxRate",
        label: "Withholding rate certified",
        why: "Finance certifies the rate on each payment: ROP's corrective action after the 2022 spot check.",
        tag: "ROP response to UNDP spot check 2022",
        auto: (p) => {
          const t = withholding(p, today());
          return t ? null : { ok: false, detail: "No invoice recorded" };
        },
      },
      {
        id: "rescreen",
        label: "Supplier screening is current",
        get why() {
          return `Re-screen before payment when the last screening is more than ${rule("rescreenMonths", 6)} months old.`;
        },
        tag: "D1* §4.8",
        fix: "Re-screen the supplier before payment.",
        resolve: "Record new screening: no match",
        auto: (p) => {
          if (!p.supplier) return null;
          const r = registered(p);
          if (r) {
            const sc = lastScreening(r);
            if (!sc) return { ok: false, detail: `${r.name} has no screening in the register` };
            if (r.status === "suspended") return { ok: false, detail: `${r.name} is suspended: ${r.suspendedWhy}` };
            const months = rule("rescreenMonths", 6);
            const d = daysBetween(sc.date, today());
            return { ok: sc.result === "clear" && d <= Math.round(months * 30.44), detail: `Last screened ${sc.date} by ${sc.byName}: ${sc.result} (${d} days ago; re-screen after ${months} months)` };
          }
          const d = daysBetween(p.supplier.screenedOn, today());
          const months = rule("rescreenMonths", 6);
          return { ok: d <= Math.round(months * 30.44), detail: `Last screened ${p.supplier.screenedOn} (${d} days ago; re-screen after ${months} months)` };
        },
      },
      {
        id: "payee",
        label: "Bank account verified against the contract and the supplier's own evidence",
        why: "A changed account is confirmed through a different channel from the one that asked for it.",
        tag: "D1 §4.13",
        auto: (p) => {
          if (!supplierRegister || !p.supplier) return null;
          const r = registered(p);
          if (!r) return { ok: false, detail: "Link the supplier to the register, where Finance confirms its bank details" };
          if (!r.bank) return { ok: false, detail: `${r.name}: bank details not confirmed by Finance in the register` };
          const changed = r.history.some((h) => h.what.startsWith("Bank details CHANGED") && h.at >= madeOn(p));
          return { ok: true, detail: `${r.bank.bank} …${r.bank.accountEnd}, confirmed by ${r.bank.confirmedByName} on ${r.bank.on} (${r.bank.how})${changed ? ". Changed since this request: check the confirmation" : ""}` };
        },
      },
      { id: "pass2", label: "Checklist pass 2 complete (file, receipt, screening, tax)", why: "No payment without a complete file, a certified receipt and screening evidence.", tag: "D1 §4.13, §4.17" },
      { id: "aiFinance", label: "AI finance review read", why: "Order, received note, invoice, budget line, approvals and screening compared. AI flags; Finance decides.", tag: "TS", ai: true },
    ],
  },
  {
    id: "verifyPay",
    stage: 6,
    title: "Verify the payment",
    owner: "finance",
    levels: ALL,
    action: "Send for approval",
    done: "Payment verified by a second Finance person",
    canReturn: true,
    produces: [],
    signs: { doc: "Payment approval form", as: "Verified by (finance)" },
    note: "For larger contracts: a different Finance person from the one who checked it.",
    when: (p) => typeof rules.paymentVerifyAboveUsd === "number" && valueOf(p) > (rules.paymentVerifyAboveUsd as number),
    checks: [
      { id: "figures", label: "Gross, tax and net agree with the invoice, the received note and the contract", why: "A second pair of eyes on the larger payments.", tag: "Finance Manual" },
      { id: "rate", label: "Withholding rate agrees with the licence on the payment date", why: "2% with a valid licence, 7% without.", tag: "Income Tax Law 2009 Art. 72" },
    ],
  },
  {
    id: "approvePay",
    stage: 6,
    title: "Approve the payment",
    owner: "approver",
    levels: ALL,
    action: "Approve payment",
    done: "Payment approved",
    canReturn: true,
    produces: [],
    signs: { doc: "Payment approval form", as: "Approved by" },
    note: "Programme management approves. Read the form: gross amount, tax withheld and net to pay.",
    checks: [
      { id: "read", label: "Gross, tax and net read against the invoice and the received note", why: "The approver relies on the figures on the form; Finance has checked them.", tag: "Finance Manual" },
    ],
  },
  {
    id: "voucher",
    stage: 6,
    title: "Prepare the expense voucher and file it",
    owner: "finance",
    levels: ALL,
    action: "Record as filed",
    done: "Expense voucher filed in SharePoint and posted in NetSuite",
    produces: ["Expense voucher"],
    signs: { doc: "Expense voucher", as: "Prepared by (finance)" },
    note: "The voucher is generated from the record. File it in SharePoint, then post it in NetSuite.",
    checks: [
      { id: "matches", label: "Payee, amount and budget line match the package", why: "The voucher is the accounting record of this purchase.", tag: "Finance Manual" },
      {
        id: "sharepoint",
        label: "Filed in SharePoint",
        why: "The voucher and the package are kept together where auditors look.",
        tag: "CUR",
        auto: (p) => ({ ok: !!p.voucher && isSharePointUrl(p.voucher.sharepointUrl), detail: p.voucher?.sharepointUrl ? (isSharePointUrl(p.voucher.sharepointUrl) ? "Link recorded" : "That is not a SharePoint link") : "Paste the SharePoint link above" }),
      },
      {
        id: "netsuite",
        label: "Posted in NetSuite",
        why: "NetSuite is the ledger; the reference ties this record to it.",
        tag: "CUR",
        auto: (p) => ({ ok: !!p.voucher?.netsuiteRef.trim(), detail: p.voucher?.netsuiteRef.trim() ? `NetSuite ${p.voucher.netsuiteRef.trim()}` : "Add the NetSuite reference above" }),
      },
    ],
  },
  {
    id: "paid",
    stage: 6,
    title: "Record the payment",
    owner: "finance",
    levels: ALL,
    action: "Record as paid",
    done: "Paid; invoice marked paid",
    produces: [],
    note: "Record the bank transfer, mark the invoice file paid, and the withheld tax once it is paid to the Ministry of Finance.",
    checks: [
      {
        id: "proof",
        label: "Proof of payment recorded (date and bank reference)",
        why: "The payment package is complete only with proof that the supplier was paid what the form approved.",
        tag: "Finance Manual",
        auto: (p) => ({ ok: !!p.paid?.date && !!p.paid.ref.trim(), detail: p.paid?.ref.trim() ? `Paid ${p.paid.date} · ref ${p.paid.ref}` : "Enter the payment date and bank reference above" }),
      },
      {
        id: "mark",
        label: "Invoice file marked paid with the project and payment number",
        why: "UNDP's spot check found invoices without the project-code stamp, which risks paying them again or charging them to another project.",
        tag: "UNDP spot check 2025",
      },
    ],
  },
  {
    id: "close",
    stage: 7,
    title: "Close out",
    owner: "procurement",
    levels: ALL,
    action: "Close procurement",
    done: "Closed",
    produces: ["Closeout checklist", "Vendor evaluation"],
    signs: { doc: "Closeout checklist", as: "Closed by (procurement)" },
    checks: [
      {
        id: "distributed",
        label: "Goods that go to participants reached them: distribution reconciled and independently verified",
        why: "Received = distributed + in stock, on signed lists, and a sample of recipients confirmed by someone who did not hand the goods out.",
        tag: "UNDP audit finding (beneficiary verification)",
        auto: (p) => distributionState(p) ?? { ok: true, detail: "Not handed on to participants" },
      },
      {
        id: "allPaid",
        label: "Every instalment paid and its withheld tax remitted",
        why: "A contract closes once nothing is owed either way: every instalment paid, and the tax withheld paid to the Ministry of Finance by the 10th of the next month.",
        tag: "Income Tax Law 2009 Art. 72",
        auto: (p) => {
          if (!p.payments) return null;
          const left = scheduleOf(p).length - paidSoFar(p).length;
          const owed = taxOutstanding(p);
          return { ok: left <= 0 && !owed.length, detail: left > 0 ? `${left} instalment${left === 1 ? "" : "s"} still to pay` : owed.length ? `Tax remittance still to record for ${owed.map((r) => `payment ${r.n} (due ${r.taxDue})`).join(", ")}` : `${paidSoFar(p).length} paid · tax remitted` };
        },
      },
      { id: "closeout", label: "Closeout checklist complete (contracts over $5,000)", why: "New work: not done in any country office today.", tag: "D1 §4.15; CUR" },
      { id: "vendor", label: "Vendor performance recorded", why: "Scores feed future sourcing.", tag: "D1 §4.15" },
    ],
  },
];

export const stepById = Object.fromEntries(steps.map((s) => [s.id, s])) as Record<string, Step>;
/** The steps this procurement goes through under the rules in force. A step already under way stays in its path even if the rules have since changed. */
export const stepsFor = (p: Procurement) => steps.filter((s) => s.id === p.step || (s.levels.includes(levelFor(valueOf(p))) && (!s.when || s.when(p))));
export const DONE = "done";

export function nextStep(p: Procurement): string {
  // After an instalment is paid, the next one starts again at receipt.
  if (p.step === "paid" && moreToPay(p)) return "receive";
  const list = stepsFor(p);
  const i = list.findIndex((s) => s.id === p.step);
  if (i >= 0) return i < list.length - 1 ? list[i + 1].id : DONE;
  // A step that no longer applies (the rules changed while it was in progress): carry on from where it sits in the full sequence.
  const at = steps.findIndex((s) => s.id === p.step);
  return list.find((s) => steps.indexOf(s) > at)?.id ?? DONE;
}
export function prevStep(p: Procurement): string {
  const list = stepsFor(p);
  const i = list.findIndex((s) => s.id === p.step);
  return i > 0 ? list[i - 1].id : p.step;
}

/**
 * Completes the step under way: signs its document, moves on, and when an instalment has just
 * been paid, files it away so the next one starts clean.
 */
export function completeStep(p: Procurement, sig: { name: string; date: string }): Procurement {
  const s = stepById[p.step];
  if (!s) return p;
  const signatures = s.signs ? { ...p.signatures, [s.signs.doc]: [...(p.signatures[s.signs.doc] ?? []), { as: s.signs.as, name: sig.name, role: s.owner, date: sig.date }] } : p.signatures;
  const signed = { ...p, signatures };
  const step = nextStep(signed);
  return s.id === "paid" ? { ...closeInstalment(signed), step } : { ...signed, step };
}


export function checkState(p: Procurement, c: Check, money: Money = usdFmt): { ok: boolean; auto: boolean; detail?: string } {
  const r = c.auto?.(p, money);
  if (r && !r.ok && p.checks[`fix.${p.step}.${c.id}`]) return { ok: true, auto: true, detail: `${r.detail} · ${c.resolve}` };
  if (r) return { ok: r.ok, auto: true, detail: r.detail };
  return { ok: !!p.checks[`${p.step}.${c.id}`], auto: false };
}

export const blockingIssues = (p: Procurement) => p.issues.filter((i) => i.status === "open" && i.blocking);

/** Key that records the step owner reviewed the generated document they are about to sign. */
export const reviewKey = (p: Procurement) => `review.${p.step}`;

export function ready(p: Procurement) {
  const s = stepById[p.step];
  if (!s) return false;
  const reviewed = !s.signs || !!p.checks[reviewKey(p)];
  return reviewed && s.checks.every((c) => checkState(p, c).ok) && blockingIssues(p).length === 0;
}

/** Every signature line a document will carry for this procurement, filled where already signed. */
export function signatureLines(p: Procurement, doc: string) {
  const signed = p.signatures[doc] ?? [];
  return stepsFor(p)
    .filter((s) => s.signs?.doc === doc)
    .map((s) => ({ as: s.signs!.as, role: s.owner, signed: signed.find((x) => x.as === s.signs!.as) }));
}

export const ownerOf = (p: Procurement): Role | null => stepById[p.step]?.owner ?? null;

export function documentsOf(p: Procurement): string[] {
  const list = stepsFor(p);
  const i = p.step === DONE ? list.length : list.findIndex((s) => s.id === p.step);
  const docs = list.slice(0, i).flatMap((s) => s.produces);
  // The document being prepared in the current step is already viewable as a draft.
  const draft = stepById[p.step]?.signs?.doc;
  return [...new Set(draft ? [...docs, draft] : docs)];
}

/* ---------- Synthetic records ---------- */

function seed(
  base: Omit<Procurement, "checks" | "timeline" | "issues" | "signatures" | "specification" | "priceBasis" | "esRisk"> &
    Partial<Pick<Procurement, "specification" | "priceBasis" | "esRisk">> & { issues?: Issue[]; doneChecks?: string[] },
): Procurement {
  const p = {
    specification: "As per the technical specification agreed with the agronomist.",
    priceBasis: "Last two purchases (PR-2026-031, PR-2026-044) and a market survey of three suppliers.",
    esRisk: "None identified",
    ...base,
    checks: {} as Record<string, boolean>,
    signatures: {} as Record<string, Signature[]>,
    issues: base.issues ?? [],
    timeline: [] as TimelineEvent[],
  };
  const list = stepsFor(p as Procurement);
  const i = list.findIndex((s) => s.id === p.step);
  list.slice(0, i).forEach((s, k) => {
    s.checks.forEach((c) => (p.checks[`${s.id}.${c.id}`] = true));
    const d = new Date(Date.parse(TODAY) - (i - k) * 4 * 86400000).toISOString().slice(0, 10);
    p.timeline.push({ date: d, who: s.owner, what: s.done });
    if (s.signs) {
      const name = holderOf("procurement", s.owner)?.name ?? roleLabel(s.owner);
      p.signatures[s.signs.doc] = [...(p.signatures[s.signs.doc] ?? []), { as: s.signs.as, name, role: s.owner, date: d }];
    }
  });
  (base.doneChecks ?? []).forEach((c) => (p.checks[`${p.step}.${c}`] = true));
  delete (p as { doneChecks?: string[] }).doneChecks;
  return p as Procurement;
}

const common = { activity: "1.2 Maize demonstration plots, 2027 Spring", funding: "Award A-2027 (fictional) · body rules apply" };

export function seedProcurements(): Procurement[] {
  return [
    seed({
      ...common,
      id: "PR-2027-016",
      title: "Soil test kits",
      qty: 25,
      unit: "kits",
      unitPrice: 38,
      budgetLine: "2.5",
      neededBy: "2027-03-25",
      place: "Village B collection point",
      urgent: false,
      step: "requisition",
      specification: "Field soil test kit: pH, N, P, K; at least 50 tests per kit; instructions in Dari.",
      esRisk: "",
    }),
    seed({
      ...common,
      id: "PR-2027-014",
      title: "Certified maize seed (OPV)",
      qty: 2400,
      unit: "kg",
      unitPrice: 7.75,
      budgetLine: "2.1",
      neededBy: "2027-04-10",
      place: "Village B collection point",
      urgent: false,
      feeds: "Season input package · seasonal step 5A",
      step: "approveReq",
      doneChecks: ["reviewed"],
    }),
    seed({
      ...common,
      id: "PR-2027-015",
      title: "NPK fertilizer 17-17-17",
      qty: 12,
      unit: "t",
      unitPrice: 2600,
      budgetLine: "2.2",
      neededBy: "2027-04-02",
      place: "Village B collection point",
      urgent: false,
      feeds: "Season input package · seasonal step 5A",
      step: "contract",
      supplier: { name: "Green Valley Agro Ltd (fictional)", screenedOn: "2027-02-22" },
      advertisedDays: 14,
      closingDate: "2027-02-15",
      doneChecks: ["clauses"],
      ai: {
        contract: [
          "Funding clause names a different donor than Award A-2027.",
          "Liquidated damages set at 30%; the standard cap is 10%. Needs a correction or an exception.",
          "Delivery point reads “District store”; the solicitation said “Village B collection point”.",
        ],
      },
    }),
    seed({
      ...common,
      id: "PR-2027-017",
      title: "Two-wheel tractors with trailers",
      qty: 4,
      unit: "units",
      unitPrice: 7400,
      budgetLine: "3.1",
      neededBy: "2027-05-15",
      place: "District office yard",
      urgent: false,
      step: "hoReview",
      ai: {
        hoReview: [
          "Technical scoring weights add up to 95, not 100.",
          "Section 6 refers to Annex 4, which is not attached.",
          "Bid validity is 60 days in the instructions and 90 days on the bid form.",
        ],
      },
    }),
    seed({
      ...common,
      id: "PR-2027-013",
      title: "Drying tarpaulins, 4 × 6 m",
      qty: 1200,
      unit: "pcs",
      unitPrice: 16,
      budgetLine: "2.4",
      neededBy: "2027-06-01",
      place: "Village B collection point",
      urgent: false,
      step: "evaluate",
      advertisedDays: 12,
      closingDate: "2027-02-28",
      doneChecks: ["declare"],
    }),
    seed({
      ...common,
      id: "PR-2027-012",
      title: "Hermetic grain storage bags",
      qty: 3000,
      unit: "bags",
      unitPrice: 1.4,
      budgetLine: "2.4",
      neededBy: "2027-03-01",
      place: "Village B collection point",
      urgent: false,
      step: "receive",
      supplier: { name: "SafeStore Supplies (fictional)", screenedOn: "2027-01-30" },
      grn: { qty: 2850, place: "Village B collection point" },
      contractUsd: 4200,
    }),
    seed({
      ...common,
      id: "PR-2027-009",
      title: "Knapsack sprayers, 16 L",
      qty: 60,
      unit: "units",
      unitPrice: 130,
      budgetLine: "2.3",
      neededBy: "2027-02-20",
      place: "Village B collection point",
      urgent: false,
      step: "payReady",
      supplier: { name: "FarmTools Co. (fictional)", screenedOn: "2026-08-20" },
      advertisedDays: 10,
      closingDate: "2026-12-10",
      grn: { qty: 60, place: "Village B collection point" },
      contractUsd: 7800,
      invoice: { amount: 7800, qty: 60 },
      issues: [
        {
          id: "I-1",
          type: "Operational issue",
          note: "Supplier emailed new bank details after award. Confirm by phone on the number in the contract.",
          by: "finance",
          blocking: true,
          status: "open",
        },
      ],
    }),
  ];
}

export const issueTypes: Issue["type"][] = ["Operational issue", "Policy exception request", "Post-facto action", "Objection memo"];

export const issueHelp: Record<Issue["type"], string> = {
  "Operational issue": "A delay, mismatch or missing item the owner can resolve.",
  "Policy exception request": "Needs written approval from the exception authority before any commitment.",
  "Post-facto action": "Something was done without the approval it needed. Write what happened, why, the cost and the prevention.",
  "Objection memo": "You think this should be delayed, changed or cancelled. It stays on file; the approver still decides.",
};
