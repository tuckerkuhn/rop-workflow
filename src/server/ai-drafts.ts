import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { TODAY } from "@/lib/demo";
import { levelFor, valueOf, type Draft, type Procurement } from "@/lib/procurement";

/**
 * AI drafting of procurement documents with Claude. Drafts only: procurement reads and corrects
 * every draft, and nothing is approved, scored or decided by the model (blueprint, AI limits).
 */

export const DRAFT_MODEL = "claude-opus-5-5";

export const DRAFT_KINDS = {
  rfq: "Request for quotation",
  solicitation: "Solicitation (RFQ/RFP)",
  sole: "Sole source justification",
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
    requested_by: p.plan?.requestedBy ?? null,
    sole_source: p.sole ?? null,
    today: TODAY,
  };
}

const ASK: Record<DraftKind, string> = {
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
