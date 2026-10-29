/**
 * Procurement workspace: roles, steps, checks and synthetic records.
 * Rules come from docs/ROP-PROCUREMENT-BLUEPRINT.md. Policy Draft 1.0 is not approved,
 * so every check carries its source tag and the rules stay easy to change here.
 */

export type StatusKind = "CUR" | "D1" | "D1*" | "TS" | "OPEN" | "PA";

import { formatMoney, holderOf, type ProcRole } from "@/lib/demo";

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

/** USD thresholds: same in the April 2025 policy and Draft 1.0. */
export function levelFor(value: number): Level {
  if (value <= 500) return "Micro";
  if (value <= 5000) return "Small";
  if (value <= 25000) return "Medium";
  return "Large";
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

export type Procurement = {
  id: string;
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
  supplier?: { name: string; screenedOn: string };
  advertisedDays?: number;
  closingDate?: string;
  grn?: { qty: number; place: string };
  invoice?: { amount: number; qty: number };
  ai?: Record<string, string[]>;
  issues: Issue[];
  timeline: TimelineEvent[];
};

export const valueOf = (p: Procurement) => p.qty * p.unitPrice;
export const lineOf = (p: Procurement) => budgetLines.find((b) => b.code === p.budgetLine);

/** Fixed "today" so the synthetic dates stay meaningful. */
export const TODAY = "2027-03-04";
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
};

const ALL: Level[] = ["Micro", "Small", "Medium", "Large"];
const SMALL_UP: Level[] = ["Small", "Medium", "Large"];
const OPEN_COMP: Level[] = ["Medium", "Large"];
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
          return { ok: valueOf(p) <= l.remainingValue, detail: `Needs ${money(valueOf(p))} · ${money(l.remainingValue)} left on ${l.code}` };
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
    ],
  },
  {
    id: "quotes",
    stage: 3,
    title: "Get quotations and pick the supplier",
    owner: "procurement",
    levels: ["Micro", "Small"],
    action: "Record selection",
    done: "Supplier selected from quotations",
    produces: ["Quotations", "Screening record", "Source selection memo"],
    signs: { doc: "Source selection memo", as: "Prepared by (procurement)" },
    checks: [
      { id: "three", label: "Three suppliers priced (written quotes above $500)", why: "Micro: market pricing from three suppliers. Small: three written quotations, or a memo explaining why fewer.", tag: "D1 §5.1, §5.2" },
      { id: "lowest", label: "Lowest price that meets the specification chosen", why: "Small purchases are awarded to the lowest compliant quotation.", tag: "D1 §5.2" },
      { id: "screened", label: "Supplier screened and the result reviewed by a person", why: "No order or payment to any party before screening. A person reviews every result.", tag: "D1 §4.8; TS" },
    ],
  },
  {
    id: "solicitation",
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
        why: "At least 10 days for Medium and 14 for Large, from first publication.",
        tag: "D1 §4.5",
        auto: (p) =>
          p.advertisedDays === undefined
            ? null
            : { ok: p.advertisedDays >= (levelFor(valueOf(p)) === "Large" ? 14 : 10), detail: `Advertised ${p.advertisedDays} days` },
      },
      {
        id: "sealed",
        label: "Bids held sealed until closing",
        why: "Held by two senior managers outside procurement. Nothing opened before closing.",
        tag: "D1 §4.6",
        auto: (p) => (p.closingDate ? { ok: daysBetween(p.closingDate, TODAY) >= 0, detail: `Closing ${p.closingDate}` } : null),
      },
      { id: "opening", label: "Opening record signed, with each bid's receipt time", why: "A signed record in its own right, not a table inside the selection memo.", tag: "D1 §4.6" },
    ],
  },
  {
    id: "evaluate",
    stage: 3,
    title: "Evaluate the bids",
    owner: "committee",
    levels: OPEN_COMP,
    action: "Sign selection memo",
    done: "Source selection memo signed",
    produces: ["Committee declarations", "Evaluation sheets", "Source selection memo"],
    signs: { doc: "Source selection memo", as: "Committee chair" },
    checks: [
      { id: "declare", label: "Every member declared against the named bidder list", why: "Signed before anyone sees a bid. A member connected to a bidder withdraws.", tag: "D1 §4.7" },
      { id: "qualify", label: "Pass/fail checked before any scoring", why: "A bid that fails a minimum requirement is not scored or ranked.", tag: "D1 §4.4" },
      { id: "lowbid", label: "Unusually low bids investigated", why: "Roughly 20–30% under the price basis: ask for proof the supplier can deliver.", tag: "D1 §4.7" },
    ],
  },
  {
    id: "screen",
    stage: 3,
    title: "Screen the chosen supplier",
    owner: "procurement",
    levels: OPEN_COMP,
    action: "Send for award",
    done: "Supplier screened",
    produces: ["Screening record", "Due diligence"],
    signs: { doc: "Screening record", as: "Screened and reviewed by" },
    checks: [
      { id: "lists", label: "Checked against the donor's lists and the OFAC plan", why: "Which lists depends on the funding source.", tag: "D1 §4.8" },
      { id: "human", label: "Result reviewed by a person; any match resolved with reasons", why: "Every screening result is reviewed before the workflow continues.", tag: "TS" },
      { id: "dd", label: "Legal existence, capacity and no staff connection confirmed", why: "Due diligence at Medium and above, from evidence submitted with the bid.", tag: "D1 §4.8" },
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
    note: "The requester inspects, not procurement.",
    checks: [
      {
        id: "qtyMatch",
        label: "Quantity received matches the order",
        why: "Certification is a real check. Discrepancies go to procurement before payment.",
        tag: "D1 §4.12",
        fix: "Short delivery: notify the supplier in writing within 15 days.",
        resolve: "Record that the balance was delivered",
        auto: (p) => (p.grn ? { ok: p.grn.qty === p.qty, detail: `Received ${fmt(p.grn.qty)} of ${fmt(p.qty)} ${p.unit}` } : null),
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
    id: "payReady",
    stage: 6,
    title: "Make it payment-ready",
    owner: "finance",
    levels: ALL,
    action: "Mark payment-ready",
    done: "Payment-ready (Gate E): handed to Finance for approval and release",
    gate: "E",
    produces: ["Invoice match", "Payee verification", "Checklist pass 2"],
    signs: { doc: "Checklist pass 2", as: "Verified by (finance)" },
    note: "Payment approval and release happen in Finance's own process, outside this tool.",
    checks: [
      {
        id: "match",
        label: "Invoice matches the order and the received note",
        why: "Three-way match on amount and quantity.",
        tag: "TS",
        resolve: "Record corrected invoice or credit note",
        auto: (p, money) =>
          p.invoice
            ? { ok: p.invoice.amount === valueOf(p) && p.invoice.qty === (p.grn?.qty ?? p.qty), detail: `Invoice ${money(p.invoice.amount)} for ${fmt(p.invoice.qty)} ${p.unit}` }
            : null,
      },
      {
        id: "rescreen",
        label: "Supplier screening is current",
        why: "Re-screen before payment when the last screening is more than six months old (proposed interval).",
        tag: "D1* §4.8",
        fix: "Re-screen the supplier before payment.",
        resolve: "Record new screening: no match",
        auto: (p) => {
          if (!p.supplier) return null;
          const d = daysBetween(p.supplier.screenedOn, TODAY);
          return { ok: d <= 183, detail: `Last screened ${p.supplier.screenedOn} (${d} days ago)` };
        },
      },
      { id: "payee", label: "Bank account verified against the contract and the supplier's own evidence", why: "A changed account is confirmed through a different channel from the one that asked for it.", tag: "D1 §4.13" },
      { id: "pass2", label: "Checklist pass 2 complete (file, receipt, screening, tax)", why: "No payment without a complete file, a certified receipt and screening evidence.", tag: "D1 §4.13, §4.17" },
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
      { id: "closeout", label: "Closeout checklist complete (contracts over $5,000)", why: "New work: not done in any country office today.", tag: "D1 §4.15; CUR" },
      { id: "vendor", label: "Vendor performance recorded", why: "Scores feed future sourcing.", tag: "D1 §4.15" },
    ],
  },
];

export const stepById = Object.fromEntries(steps.map((s) => [s.id, s])) as Record<string, Step>;
export const stepsFor = (p: Procurement) => steps.filter((s) => s.levels.includes(levelFor(valueOf(p))));
export const DONE = "done";

export function nextStep(p: Procurement): string {
  const list = stepsFor(p);
  const i = list.findIndex((s) => s.id === p.step);
  return i >= 0 && i < list.length - 1 ? list[i + 1].id : DONE;
}
export function prevStep(p: Procurement): string {
  const list = stepsFor(p);
  const i = list.findIndex((s) => s.id === p.step);
  return i > 0 ? list[i - 1].id : p.step;
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
