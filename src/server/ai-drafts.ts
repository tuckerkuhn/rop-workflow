import { currentInstalment, expectedUsd, invoiceUsd, orderUsd, scheduleOf, withholding } from "@/lib/payments";
import { z } from "zod";
import { bidUsd, holderFor, levelFor, rulesInForce, stepsFor, valueOf, type Draft, type Procurement, supplierPaidThisYear } from "@/lib/procurement";
import { lastScreening, type Supplier } from "@/lib/suppliers";
import { today } from "@/lib/clock";
import { asIs, askAi, DRAFT_MODEL, DraftingUnavailable } from "@/server/ai";

// Kept here for the routes that import them from this file.
export { DRAFT_MODEL, DraftingUnavailable };

/** Why the purchase record goes to the AI as it is. */
const RECORD = "the purchase record; staff and supplier names are part of the document, and no farmer is named in it";

/**
 * AI drafting of procurement documents with Claude. Drafts only: procurement reads and corrects
 * every draft, and nothing is approved, scored or decided by the model (blueprint, AI limits).
 */


export const DRAFT_KINDS = {
  rfq: "Request for quotation",
  solicitation: "Solicitation (RFQ/RFP)",
  sole: "Sole source justification",
  package: "Procurement package",
} as const;
export type DraftKind = keyof typeof DRAFT_KINDS;


const draftSchema = z.object({
  sections: z
    .array(z.object({ heading: z.string(), body: z.string() }))
    .describe("The document, section by section, in the order it is read."),
  questions: z.array(z.string()).describe("Facts the record does not settle that a person must fill in or confirm before the document is used. Empty if none."),
});

/** A threshold from the rules in force for the project, as "$5,000". */
const dollars = (key: string, fallback: number) => {
  const v = rulesInForce()[key];
  return "$" + (typeof v === "number" ? v : fallback).toLocaleString("en-US");
};
/**
 * The rules the model is given. The level thresholds are read from the rules in force (the
 * organization's policy with the donor's layered on), the same ones `levelFor` uses for the
 * record's level, so the prompt and the record never state different amounts.
 */
export const policyText = () => `You draft procurement documents for Roots of Peace (ROP), an international NGO, under its procurement policy (Afghanistan, April 2025). Rules that apply:
- Levels by estimated value in USD: Micro up to ${dollars("microMaxUsd", 500)}; Small ${dollars("microMaxUsd", 500)} to ${dollars("smallMaxUsd", 5000)}; Medium ${dollars("smallMaxUsd", 5000)} to ${dollars("largeAboveUsd", 25000)}; Large over ${dollars("largeAboveUsd", 25000)}.
- A request for quotation (RFQ) is awarded to the lowest-priced quotation that meets every requirement (lowest price technically acceptable). An RFP is best value. Never mix the two.
- Pass/fail requirements are listed separately from anything priced or scored; a price never stands in for a minimum requirement.
- Submission terms are stated once: deadline (date and time), where and how to submit, bid validity period, currency. A quotation is only rejected on grounds the request states.
- Every solicitation states: eligibility (no debarred or sanctioned party; ROP screens the selected supplier against donor lists and the OFAC list before any order), a related-party declaration, how to raise a complaint or protest, and a confidential channel to report fraud or misconduct. The English text governs.
- Specifications describe what is needed without naming a brand unless "or equivalent" is accepted, and must not restrict competition.
- Sole source (any value) needs a written justification approved by the approving authority before the procurement begins. Acceptable grounds: only one supplier can provide it (unique capability, proprietary or exclusive rights); compatibility with existing equipment; an unforeseeable emergency where competition would cause harm; the donor named or approved the supplier; or competition was tried and failed. The justification states the grounds, why others cannot supply, what market check was done, why the price is reasonable without competition, and the risks.

How to write:
- Use only facts from the record given. Where a fact is missing, write a clearly marked placeholder in square brackets, e.g. [submission deadline], and list it in questions. Never invent supplier names, prices, dates, standards or legal terms.
- Plain, direct English that translates well into Dari and Pashto. Short sentences. No marketing language.
- Do not decide anything that belongs to a person: you do not approve, score, select a supplier or judge eligibility.`;

/** What the drafter is told beyond the record itself: who asked for the draft and the supplier's register entry. */
type Context = { preparedBy?: string; supplier?: Supplier | null };

function recordOf(p: Procurement, ctx: Context = {}) {
  const usd = valueOf(p);
  const chosen = p.bids?.find((b) => b.id === p.selectedBid);
  const reg = ctx.supplier;
  const screened = reg ? lastScreening(reg) : null;
  return {
    procurement_id: p.id,
    prepared_by: ctx.preparedBy ?? null,
    steps_this_purchase_goes_through: stepsFor(p).map((s) => s.title),
    project: p.plan?.project ?? null,
    item: p.title,
    specification: p.specification || null,
    quantity: p.qty,
    unit: p.unit,
    estimated_value_usd: Math.round(usd),
    budget_line_left_before_this_purchase: p.plan ? { amount: p.plan.left, currency: p.plan.currency } : null,
    level_rule: "The level is set by the app from the policy thresholds; a value exactly at a threshold is in the lower level.",
    policy_notes: [
      "Micro purchases need no purchase order or contract (Procurement Policy D1 §3.4, §4.11): the order is placed when procurement clears the screened supplier to deliver, so that date is the order date.",
      "The requester, not procurement, performs the physical check and signs the goods received note (D1 §4.12). The requester receiving the goods is correct; procurement receiving them would not be.",
      "Goods handed out farmer by farmer in Field activities are checked handout by handout (signed note, photo, the project manager's approval); no recipient sample is required by any ROP manual.",
    ],
    order_date: levelFor(usd) === "Micro" ? (p.signatures["Screening record"]?.[0]?.date ?? null) : null,
    quotations: (p.bids ?? []).filter((b) => b.supplier.trim()).map((b) => ({ supplier: b.supplier, amount: b.amount, currency: b.currency, amount_usd: bidUsd(b), received: b.receivedAt, technically_acceptable: b.passes, chosen: b.id === p.selectedBid })),
    chosen_quotation_usd: chosen ? bidUsd(chosen) : null,
    supplier_register: reg
      ? { id: reg.id, status: reg.status, licence_expiry: reg.licenceExpiry, last_screening: screened ? { date: screened.date, lists: screened.lists, result: screened.result, by: screened.byName } : null, no_staff_link_declared: !!reg.noStaffLink }
      : null,
    level: levelFor(usd),
    budget_line: p.plan ? `${p.plan.budgetCode} ${p.plan.budgetName}` : p.budgetLine,
    activity: p.activity,
    funding: p.funding,
    needed_by: p.neededBy,
    delivery_place: p.place,
    price_basis: p.priceBasis || null,
    environmental_social_risk: p.esRisk || null,
    requested_by: p.plan?.requestedBy ?? holderFor(p, "holder")?.name ?? null,
    sole_source: p.sole ?? null,
    route: p.route ?? null,
    current_step: p.step,
    supplier: p.supplier ?? null,
    advertised_days: p.advertisedDays ?? null,
    closing_date: p.closingDate ?? null,
    goods_received: p.grn ?? null,
    // "rate" alone reads as a unit price: name it as the exchange rate it is.
    invoice: p.invoice ? { number: p.invoice.number, date: p.invoice.date, total_amount: p.invoice.amount, quantity: p.invoice.qty, currency: p.invoice.currency ?? "USD", afghani_per_us_dollar: p.invoice.rate ?? null, amount_usd: invoiceUsd(p.invoice) } : null,
    payment_schedule: scheduleOf(p),
    contract_currency: p.contractCurrency ?? "USD",
    instalment_under_way: currentInstalment(p),
    due_this_instalment_usd: expectedUsd(p),
    tax_to_withhold: withholding(p, today()),
    // The AFN 500,000 threshold counts the supplier's payments over the tax year, not one contract.
    supplier_paid_this_tax_year_afn: supplierPaidThisYear(p, today()),
    payments_already_made: (p.payments ?? []).map((r) => ({ n: r.n, label: r.label, pct: r.pct, grn: r.grn, invoice: r.invoice, tax: r.tax, net: r.net, paid: r.paid })),
    order_value_usd: Math.round(orderUsd(p) * 100) / 100,
    estimated_value_note: "estimated_value_usd is the request's estimate, which sets the level; order_value_usd is what was agreed (the chosen quotation or the contract).",
    signatures: p.signatures,
    checks_done: Object.keys(p.checks).filter((k) => p.checks[k]),
    open_issues: p.issues.filter((i) => i.status === "open").map((i) => ({ type: i.type, note: i.note, blocking: i.blocking })),
    history: p.timeline,
    documents_drafted: Object.keys(p.drafts ?? {}),
    voucher: p.voucher ?? null,
    today: today(),
  };
}

const ASK: Record<DraftKind, string> = {
  package:
    "Draft the cover memo of the procurement package sent to Finance. Sections: what was bought and for which activity and budget line; how it was bought (route, method, level) and why; supplier and screening; approvals with who and when (from signatures); contract or order value against the budget line; receipt (goods received note) against the order; invoice against the order and receipt; open issues and anything still outstanding. State facts from the record only; where a document or figure is missing, say so.",
  rfq: "Draft the request for quotation to send to at least three suppliers. Sections: introduction and purpose; what is required (specification, quantity, delivery place and date); pass/fail requirements; how quotations are evaluated (lowest price that meets every requirement); how and when to submit (deadline, method, validity, currency, what to include); eligibility, screening and related-party declaration; complaints and reporting misconduct.",
  solicitation:
    "Draft the solicitation for open competition (advertised). Use an RFQ with lowest price technically acceptable unless the record says best value is needed, and say which. Sections: introduction; scope and specification; pass/fail qualification; evaluation method; submission (deadline, sealed submission, opening, validity, currency); eligibility, screening, due diligence and related-party declaration; clarifications (in writing, answered to all bidders); complaints and reporting misconduct.",
  sole: "Draft the sole source justification for the approving authority. Sections: what is being bought and why it is needed; the proposed supplier; the grounds for sole source (name which ground applies); why no other supplier can meet the need; market check done; why the price is reasonable without competition; risks and how they are managed; recommendation for the approver's decision. Base the grounds only on the sole_source facts given; if they do not support an acceptable ground, say so plainly in the draft and in questions.",
};

/** Drafts one document from the procurement record. Throws DraftingUnavailable when no API key is set. `by` is the person's name, kept on the draft; `byId` is who asked, for the audit row. */
export async function draftDocument(p: Procurement, kind: DraftKind, by: string, byId: string = by, supplier: Supplier | null = null): Promise<Draft> {
  const { out, model } = await askAi({
    job: "procurementDraft",
    by: byId,
    system: policyText(),
    task: ASK[kind],
    facts: asIs(recordOf(p, { preparedBy: by, supplier }), RECORD),
    factsLabel: "The procurement record (JSON)",
    schema: draftSchema,
    maxTokens: 16000,
    timeoutMs: 100_000,
    say: { refused: "The drafting model declined this request. Write this document by hand.", cutOff: "The draft was cut off. Try again.", empty: "The draft came back empty. Try again.", tooLong: "Drafting took too long. Try again." },
  });
  if (!out.sections.length) throw new Error("The draft came back empty. Try again.");
  return { sections: out.sections, questions: out.questions, model, at: today(), by, edited: false };
}

/* ---------------- AI checks ---------------- */

const CHECKS: Record<string, string> = {
  package:
    "Check the procurement package for completeness and consistency before it goes to Finance. Look for: documents the route and level require that are missing; approvals missing or signed out of order (requisition approved before any supplier contact; sole source approved before the supplier was engaged; award before contract); order value above what was left on the budget line; received quantity or place different from the order; invoice different from the order or the receipt; screening missing or older than six months; open issues.",
  payReady:
    "Review this procurement as Finance does before payment. It may be paid in instalments: compare the invoice with the amount due for the instalment under way (due_this_instalment_usd), and the goods received or verified progress with what this instalment pays for, counting earlier payments. Check the tax to withhold against the supplier's licence expiry on the payment date (2% licensed, 7% without a valid licence), and against what this supplier has been paid this tax year (supplier_paid_this_tax_year_afn): below AFN 500,000 nothing is withheld unless the year's payments with this one pass it. Compare the order value, the goods received note and the invoice (amount and quantity); check the budget line and funding; check approvals and signatures are present and in order; check supplier screening is current (six months); note open issues and anything that would stop payment.",
  contract:
    "Check the contract record for conformity with the request and the award: supplier, value, quantity, delivery place and date, funding source and required clauses. Only what the record shows.",
  hoReview:
    "Check the solicitation for internal consistency: pass/fail requirements separate from scored criteria, weights that add up, deadlines and validity stated once and the same everywhere, annexes referred to that exist, and the instrument matching the method (RFQ with lowest price, RFP with best value).",
};

export const CHECKABLE_STEPS = Object.keys(CHECKS);

const findingsSchema = z.object({
  findings: z
    .array(z.string())
    .describe("Each finding in one or two plain sentences for a finance or procurement officer: what is wrong or missing and what would fix it. No field names or programming words. Most serious first. Empty if nothing is wrong."),
});

/** Runs an AI check for one step. Returns the findings for a person to read; it decides nothing. */
export async function checkProcurement(p: Procurement, step: string, by: string): Promise<string[]> {
  const ask = CHECKS[step];
  if (!ask) throw new Error("This step has no AI check.");
  const { out } = await askAi({
    job: "procurementCheck",
    by,
    system: `${policyText()}\n\nYou are checking, not drafting. Report problems you can see in the record. Do not repeat what is fine. Never say a check passed on a person's behalf.\n\nThe reader is a finance or procurement officer, not a programmer. Write each finding in plain words about the purchase and its papers (supplier, order, goods received note, invoice, signatures, screening, tax). Never name the record's fields or keys, and never write null, empty object, array, JSON, true or false: say "no supplier is recorded", not "supplier is null".`,
    task: ask,
    facts: asIs(recordOf(p), RECORD),
    factsLabel: "The procurement record (JSON)",
    schema: findingsSchema,
    maxTokens: 8000,
    timeoutMs: 100_000,
    say: { refused: "The model declined this check. Do it by hand.", empty: "The check came back empty. Try again.", tooLong: "The check took too long. Try again." },
  });
  return out.findings.length ? out.findings : ["No problems found in the record. Check the documents themselves before you confirm."];
}
