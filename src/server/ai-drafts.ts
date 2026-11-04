import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { TODAY } from "@/lib/demo";
import { holderFor, levelFor, valueOf, type Draft, type Procurement } from "@/lib/procurement";

/**
 * AI drafting of procurement documents with Claude. Drafts only: procurement reads and corrects
 * every draft, and nothing is approved, scored or decided by the model (blueprint, AI limits).
 */

export const DRAFT_MODEL = "claude-opus-5-5";

export const DRAFT_KINDS = {
  rfq: "Request for quotation",
  solicitation: "Solicitation (RFQ/RFP)",
  sole: "Sole source justification",
  package: "Procurement package",
} as const;
export type DraftKind = keyof typeof DRAFT_KINDS;

export class DraftingUnavailable extends Error {}

const draftSchema = z.object({
  sections: z
    .array(z.object({ heading: z.string(), body: z.string() }))
    .describe("The document, section by section, in the order it is read."),
  questions: z.array(z.string()).describe("Facts the record does not settle that a person must fill in or confirm before the document is used. Empty if none."),
});

const POLICY = `You draft procurement documents for Roots of Peace (ROP), an international NGO, under its procurement policy (Draft 1.0). Rules that apply:
- Levels by estimated value in USD: Micro up to $500; Small $500 to $5,000; Medium $5,000 to $25,000; Large over $25,000.
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

function recordOf(p: Procurement) {
  const usd = valueOf(p);
  return {
    procurement_id: p.id,
    project: p.plan?.project ?? null,
    item: p.title,
    specification: p.specification || null,
    quantity: p.qty,
    unit: p.unit,
    estimated_value_usd: Math.round(usd),
    estimated_value_budget_currency: p.plan ? { amount: p.plan.left, currency: p.plan.currency } : null,
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
    invoice: p.invoice ? { amount_usd: p.invoice.amount, qty: p.invoice.qty } : null,
    order_value_usd: Math.round(usd * 100) / 100,
    signatures: p.signatures,
    checks_done: Object.keys(p.checks).filter((k) => p.checks[k]),
    open_issues: p.issues.filter((i) => i.status === "open").map((i) => ({ type: i.type, note: i.note, blocking: i.blocking })),
    history: p.timeline,
    documents_drafted: Object.keys(p.drafts ?? {}),
    voucher: p.voucher ?? null,
    today: TODAY,
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

/** Drafts one document from the procurement record. Throws DraftingUnavailable when no API key is set. */
export async function draftDocument(p: Procurement, kind: DraftKind, by: string): Promise<Draft> {
  if (!process.env.ANTHROPIC_API_KEY) throw new DraftingUnavailable("AI drafting is not set up on this server: add ANTHROPIC_API_KEY.");
  // Streamed, so the connection never sits idle while the model thinks; stopped at 100 s to stay
  // within the server's 2-minute limit, with a clear message to try again.
  const client = new Anthropic({ maxRetries: 1 });
  const stream = client.beta.messages.stream({
    model: DRAFT_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(draftSchema) },
    system: POLICY,
    messages: [{ role: "user", content: `${ASK[kind]}\n\nThe procurement record (JSON):\n${JSON.stringify(recordOf(p), null, 2)}` }],
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stream.abort();
  }, 100_000);
  let response;
  try {
    response = await stream.finalMessage();
  } catch (e) {
    if (timedOut || e instanceof Anthropic.APIConnectionTimeoutError) throw new Error("Drafting took too long. Try again.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Too many drafts at once. Wait a minute and try again.");
    if (e instanceof Anthropic.AuthenticationError) throw new Error("The AI key on this server was not accepted. An administrator needs to replace ANTHROPIC_API_KEY.");
    if (e instanceof Anthropic.APIConnectionError) throw new Error("Could not reach the AI service. Try again.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (response.stop_reason === "refusal") throw new Error("The drafting model declined this request. Write this document by hand.");
  if (response.stop_reason === "max_tokens") throw new Error("The draft was cut off. Try again.");
  const out = response.parsed_output;
  if (!out || !out.sections.length) throw new Error("The draft came back empty. Try again.");
  return { sections: out.sections, questions: out.questions, model: response.model, at: TODAY, by, edited: false };
}

/* ---------------- AI checks ---------------- */

const CHECKS: Record<string, string> = {
  package:
    "Check the procurement package for completeness and consistency before it goes to Finance. Look for: documents the route and level require that are missing; approvals missing or signed out of order (requisition approved before any supplier contact; sole source approved before the supplier was engaged; award before contract); order value above what was left on the budget line; received quantity or place different from the order; invoice different from the order or the receipt; screening missing or older than six months; open issues.",
  payReady:
    "Review this procurement as Finance does before payment. Compare the order value, the goods received note and the invoice (amount and quantity); check the budget line and funding; check approvals and signatures are present and in order; check supplier screening is current (six months); note open issues and anything that would stop payment.",
  contract:
    "Check the contract record for conformity with the request and the award: supplier, value, quantity, delivery place and date, funding source and required clauses. Only what the record shows.",
  hoReview:
    "Check the solicitation for internal consistency: pass/fail requirements separate from scored criteria, weights that add up, deadlines and validity stated once and the same everywhere, annexes referred to that exist, and the instrument matching the method (RFQ with lowest price, RFP with best value).",
};

export const CHECKABLE_STEPS = Object.keys(CHECKS);

const findingsSchema = z.object({
  findings: z
    .array(z.string())
    .describe("Each finding in one or two sentences: what is wrong or missing, where in the record, and what would fix it. Most serious first. Empty if nothing is wrong."),
});

/** Runs an AI check for one step. Returns the findings for a person to read; it decides nothing. */
export async function checkProcurement(p: Procurement, step: string): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) throw new DraftingUnavailable("AI checks are not set up on this server: add ANTHROPIC_API_KEY.");
  const ask = CHECKS[step];
  if (!ask) throw new Error("This step has no AI check.");
  const client = new Anthropic({ maxRetries: 1 });
  const stream = client.beta.messages.stream({
    model: DRAFT_MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(findingsSchema) },
    system: `${POLICY}\n\nYou are checking, not drafting. Report problems you can see in the record. Do not repeat what is fine. Never say a check passed on a person's behalf.`,
    messages: [{ role: "user", content: `${ask}\n\nThe procurement record (JSON):\n${JSON.stringify(recordOf(p), null, 2)}` }],
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stream.abort();
  }, 100_000);
  try {
    const response = await stream.finalMessage();
    if (response.stop_reason === "refusal") throw new Error("The model declined this check. Do it by hand.");
    const out = response.parsed_output;
    if (!out) throw new Error("The check came back empty. Try again.");
    return out.findings.length ? out.findings : ["No problems found in the record. Check the documents themselves before you confirm."];
  } catch (e) {
    if (timedOut || e instanceof Anthropic.APIConnectionTimeoutError) throw new Error("The check took too long. Try again.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Too many AI requests at once. Wait a minute and try again.");
    if (e instanceof Anthropic.AuthenticationError) throw new Error("The AI key on this server was not accepted. An administrator needs to replace ANTHROPIC_API_KEY.");
    if (e instanceof Anthropic.APIConnectionError) throw new Error("Could not reach the AI service. Try again.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
