import { HAND_WRITTEN, bidUsd, levelFor, valueOf, type Draft, type Procurement } from "@/lib/procurement";

/**
 * A procurement document written by a person instead of drafted by AI (review round 1, ISS-01).
 * A purchase must never wait on AI or on one outside service being up: the same document opens
 * here with everything the record already holds filled in, and each fact only a person can
 * supply left as a blank in [square brackets]. The step's checks treat it like any draft, and it
 * counts as read only once every blank is filled (lib/procurement `draftRead`).
 *
 * The sections are the ones the AI is asked for (server/ai-drafts ASK), so a hand-written and an
 * AI-drafted document read the same. Nothing here states a rule the policy text does not.
 *
 * Pure: the record in, the draft out.
 */

export type HandKind = "rfq" | "solicitation" | "sole" | "package";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
/** A fact from the record, or a blank that says what is wanted. */
const or = (v: string | number | null | undefined, blank: string) => (v !== null && v !== undefined && String(v).trim() ? String(v).trim() : `[${blank}]`);
const ORG = "[organization name]";

const required = (p: Procurement) =>
  `${or(p.title, "item")}.\nQuantity: ${p.qty > 0 ? `${p.qty} ${p.unit}`.trim() : "[quantity and unit]"}.\nSpecification: ${or(p.specification, "specification")}\nDeliver to: ${or(p.place, "delivery place")}.\nDeliver by: ${or(p.neededBy, "delivery date")}.\nWhere a brand is named it is an example only: an equivalent that meets the specification is accepted.`;

const eligibility = `No debarred or sanctioned party may supply. ${ORG} screens the selected supplier against sanctions and donor lists before any order.\nWith your offer, declare any family or business relationship with ${ORG} staff, or state that there is none.`;
const complaints = `To raise a complaint about this request: [who to write to and how].\nTo report fraud or misconduct in confidence: [confidential channel].\nThe English text of this document governs.`;

function rfq(p: Procurement) {
  return [
    { heading: "Introduction and purpose", body: `${ORG} invites your quotation for the item below, under request ${p.id}. This is a request for quotation. It is not an order.` },
    { heading: "What is required", body: required(p) },
    { heading: "Pass/fail requirements", body: "A quotation is considered only if it meets every one of these:\n- The item meets the specification in full.\n- Delivery to the place and by the date stated.\n- [any other minimum requirement, or delete this line]" },
    { heading: "How quotations are evaluated", body: "The order goes to the lowest-priced quotation that meets every requirement above. Price is compared only among the quotations that pass." },
    { heading: "How and when to submit", body: "Deadline: [date and time].\nSend to: [email or address].\nYour quotation must stay valid for [number of days] days.\nQuote in: [currency].\nInclude: the unit price and the total, the delivery date, and any delivery cost.\nA quotation is rejected only on grounds stated in this request." },
    { heading: "Eligibility, screening and related parties", body: eligibility },
    { heading: "Complaints and reporting misconduct", body: complaints },
  ];
}

function solicitation(p: Procurement) {
  const best = p.evaluation === "bestValue";
  return [
    { heading: "Introduction", body: `${ORG} invites offers in open competition for the item below, under request ${p.id}. ${best ? "This is a request for proposals, evaluated on best value." : "This is a request for quotation, awarded to the lowest price that meets every requirement."}` },
    { heading: "Scope and specification", body: required(p) },
    { heading: "Pass/fail qualification", body: "An offer is considered only if it meets every one of these:\n- The item meets the specification in full.\n- Delivery to the place and by the date stated.\n- [any other minimum requirement, or delete this line]" },
    {
      heading: "Evaluation method",
      body: best
        ? "Offers that pass every requirement above are scored on these criteria and weights: [criteria and weights, adding up to 100]. Price is one of the criteria. No pass/fail requirement is scored."
        : "The award goes to the lowest-priced offer that meets every requirement above. Price is compared only among the offers that pass.",
    },
    { heading: "Submission", body: "Deadline: [date and time].\nSubmit sealed to: [address or secure mailbox].\nOffers are opened on [date and time] at [place].\nYour offer must stay valid for [number of days] days.\nPrice in: [currency].\nAn offer is rejected only on grounds stated in this document." },
    { heading: "Eligibility, screening, due diligence and related parties", body: eligibility },
    { heading: "Clarifications", body: "Send questions in writing to [email] by [date]. Every answer goes to all bidders." },
    { heading: "Complaints and reporting misconduct", body: complaints },
  ];
}

function sole(p: Procurement) {
  return [
    { heading: "What is being bought and why it is needed", body: `${or(p.title, "item")}, ${p.qty > 0 ? `${p.qty} ${p.unit}`.trim() : "[quantity and unit]"}, estimated at ${usd(valueOf(p))}, for activity ${or(p.activity, "activity")} on budget line ${or(p.budgetLine, "budget line")}.\nWhy it is needed: [the need this purchase meets].` },
    { heading: "The proposed supplier", body: or(p.sole?.supplier, "supplier name") },
    { heading: "The grounds for sole source", body: `[Name the one ground that applies: only one supplier can provide it; compatibility with existing equipment; an emergency that could not be foreseen, where competition would cause harm; the donor named or approved the supplier; or competition was tried and failed.]\nThe reason recorded on the request: ${or(p.sole?.reason, "reason")}` },
    { heading: "Why no other supplier can meet the need", body: "[which other suppliers were considered, and why each cannot supply]" },
    { heading: "Market check done", body: "[what was checked, with whom and on what date]" },
    { heading: "Why the price is reasonable without competition", body: "[earlier prices paid, published prices or comparable quotations]" },
    { heading: "Risks and how they are managed", body: "[the risks of buying without competition, and what is done about each]" },
    { heading: "Recommendation", body: "Procurement asks the approving authority to decide on this sole source before the supplier is engaged." },
  ];
}

function cover(p: Procurement) {
  const level = levelFor(valueOf(p));
  const chosen = p.bids?.find((b) => b.id === p.selectedBid);
  const chosenUsd = chosen ? bidUsd(chosen) : null;
  const order = p.contractUsd ?? chosenUsd;
  const signed = Object.entries(p.signatures ?? {})
    .filter(([, l]) => l.length)
    .map(([doc, l]) => `- ${doc}: ${l.map((x) => `${x.name} (${x.as}), ${x.date}`).join("; ")}`);
  const open = p.issues.filter((i) => i.status === "open").map((i) => `- ${i.type}${i.blocking ? " (blocking)" : ""}: ${i.note}`);
  const route = p.route === "sole" ? "sole source" : p.route === "direct" ? "bought directly" : p.route === "rfq" ? "request for quotation" : "[how it was bought]";
  return [
    { heading: "What was bought", body: `${or(p.title, "item")}, ${p.qty > 0 ? `${p.qty} ${p.unit}`.trim() : "[quantity and unit]"}, for activity ${or(p.activity, "activity")} on budget line ${or(p.budgetLine, "budget line")}${p.funding ? `, funded by ${p.funding}` : ""}.` },
    { heading: "How it was bought", body: `Level: ${level} (estimated value ${usd(valueOf(p))}). Route: ${route}.\nWhy this route: [reason, or "as the level requires"].` },
    { heading: "Supplier and screening", body: p.supplier?.name ? `${p.supplier.name}. Screened on ${or(p.supplier.screenedOn, "screening date")}.` : "[supplier name]. Screened on [screening date]." },
    { heading: "Approvals", body: signed.length ? signed.join("\n") : "[who approved what, and when]" },
    {
      heading: "Order value against the budget line",
      body: `Order value: ${order !== null && order !== undefined ? usd(order) : "[order or contract value]"}. ${p.plan ? `Left on the budget line before this purchase: ${Math.round(p.plan.left).toLocaleString("en-US")} ${p.plan.currency}.` : "Left on the budget line before this purchase: [amount]."}`,
    },
    { heading: "Receipt against the order", body: p.grn ? `Received: ${p.grn.qty} ${p.unit} at ${or(p.grn.place, "place of receipt")}, against ${p.qty} ${p.unit} ordered.` : "[what was received, where, and how it compares with the order]" },
    { heading: "Invoice against the order and the receipt", body: p.invoice ? `Invoice ${or(p.invoice.number, "invoice number")} dated ${or(p.invoice.date, "invoice date")}: ${Math.round(p.invoice.amount).toLocaleString("en-US")} ${p.invoice.currency ?? "USD"} for ${p.invoice.qty} ${p.unit}.` : "No invoice is recorded yet." },
    { heading: "Open issues and anything outstanding", body: open.length ? open.join("\n") : "No open issues on the record." },
  ];
}

const WRITERS: Record<HandKind, (p: Procurement) => { heading: string; body: string }[]> = { rfq, solicitation, sole, package: cover };

/** The document for a person to finish: the record's facts filled in, the rest as blanks. `by` is who started it, `at` the day. */
export function handDraft(p: Procurement, kind: HandKind, by: string, at: string): Draft {
  return { sections: WRITERS[kind](p), questions: [], model: HAND_WRITTEN, at, by, edited: false };
}
