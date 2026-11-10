import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { FREQUENCIES, RULE_KEYS } from "@/lib/agreement";
import { COUNTRIES } from "@/lib/project-setup";
import { DRAFT_MODEL, DraftingUnavailable } from "@/server/ai-drafts";

/**
 * Project setup from the documents: the agreement (PDF or Word), the logframe or results framework
 * (Excel, Word or PDF) and the budget. Three readers: the design (name, donor, dates, goal, every
 * indicator with its donor code, unit and targets); the agreement's terms (reporting obligations
 * and checkable donor rules, lib/agreement); and a budget in Word or PDF. Every value says where it
 * came from. Proposals only: the person confirms each section in setup before anything is saved.
 */

export type SetupFile = { name: string; kind: "pdf"; data: string } | { name: string; kind: "text"; text: string };

const schema = z.object({
  name: z.string().describe("The project's full title as the agreement gives it, with its acronym in brackets if it has one."),
  donor: z.string().describe("The donor or funding agency, e.g. UNDP. Empty if not stated."),
  country: z.string().describe("ISO 3166-1 alpha-2 code of the main country, e.g. AF."),
  crop: z.string().describe("The main crop or value chain, if the project has one. Empty if none."),
  startDate: z.string().describe("YYYY-MM-DD; empty if not stated."),
  endDate: z.string().describe("YYYY-MM-DD; empty if not stated."),
  goal: z.string().describe("The project's goal or overall objective, one or two sentences, as written."),
  indicators: z
    .array(
      z.object({
        donorCode: z.string().describe("The donor's number for the indicator, e.g. 1.1.1.3 or 2.1.2.1-a. Empty if none."),
        name: z.string(),
        unit: z.string().describe("What is counted: farmers, ha, jerib, greenhouses, persons, events…"),
        target: z.number().describe("The life-of-project target."),
        level: z.enum(["goal", "outcome", "output"]),
        yearTargets: z.array(z.object({ year: z.number(), target: z.number().describe("The target for that calendar year alone, not a running total.") })).describe("Per calendar year, when the framework gives them. Empty if not."),
        source: z.string().describe("Where in the documents this came from, e.g. 'Logframe, row 14'."),
      }),
    )
    .describe("Every indicator the project reports on, outputs included, in the documents' order."),
  sources: z
    .object({ name: z.string(), donor: z.string(), dates: z.string(), goal: z.string() })
    .describe("Where each of these came from, e.g. 'Agreement, cover page' or 'Agreement, clause 2.1'. Empty when not found."),
  questions: z.array(z.string()).describe("What the documents leave unclear or contradictory, for the person to settle. Empty if nothing."),
});
export type SetupProposal = z.infer<typeof schema>;

const SYSTEM = [
  "You read a donor agreement and a project's logframe or results framework and extract the project's design for a project management app.",
  "Take every value from the documents; never invent. When a value is missing, leave it empty and say so in questions. When the documents disagree, use the logframe for indicators and the agreement for dates, and say which you used in questions.",
  "Indicators: include every measurable indicator with a target, at goal, outcome and output level. Keep the donor's numbering and wording.",
].join(" ");

/** Reads the documents with one structured call. Any of the three readers below uses it. */
async function readDocuments<T>(files: SetupFile[], system: string, task: string, out: z.ZodType<T>): Promise<{ out: T; model: string }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new DraftingUnavailable("AI is not set up on this server: add ANTHROPIC_API_KEY.");
  const client = new Anthropic({ maxRetries: 1 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of files) {
    if (f.kind === "pdf") content.push({ type: "document", title: f.name, source: { type: "base64", media_type: "application/pdf", data: f.data } });
    else content.push({ type: "text", text: `Document: ${f.name}\n\n${f.text}` });
  }
  content.push({ type: "text", text: task });
  const stream = client.beta.messages.stream({
    model: DRAFT_MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(out as z.ZodType<T> & z.ZodObject<z.ZodRawShape>) },
    system,
    messages: [{ role: "user", content }],
  });
  const timer = setTimeout(() => stream.abort(), 170_000);
  try {
    const res = await stream.finalMessage();
    if (res.stop_reason === "refusal") throw new Error("The model declined to read these documents.");
    if (res.stop_reason === "max_tokens") throw new Error("The documents are too long to read at once: upload them one at a time.");
    if (!res.parsed_output) throw new Error("Nothing came back. Try again.");
    return { out: res.parsed_output as T, model: res.model };
  } catch (e) {
    if (e instanceof Anthropic.APIUserAbortError) throw new Error("Reading the documents took too long. Try them one at a time.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const extractSetup = (files: SetupFile[]) => readDocuments(files, SYSTEM, `Extract the project's design from these documents. Countries the app knows: ${COUNTRIES.join(", ")}.`, schema);

// ---------- The agreement's terms: reporting obligations and checkable donor rules (lib/agreement) ----------

const termsSchema = z.object({
  obligations: z
    .array(
      z.object({
        report: z.string().describe("The report as the agreement names it, e.g. 'Quarterly progress report' or 'Final financial report'."),
        frequency: z.enum(FREQUENCIES),
        daysAfterPeriod: z.number().nullable().describe("Days after each period ends (or after the project ends, for a final report) that it is due. Null if the agreement gives dates instead or no deadline."),
        dueDates: z.array(z.string()).describe("Due dates the agreement names outright, YYYY-MM-DD. Empty if none."),
        format: z.string().describe("The required format or template, as written. Empty if none."),
        source: z.string().describe("Where in the agreement, e.g. 'Agreement, clause 8.2'."),
      }),
    )
    .describe("Every report the agreement requires the organization to send: narrative, financial, final, audits. Not reports the donor sends."),
  rules: z
    .array(
      z.object({
        key: z.enum(RULE_KEYS.map((r) => r.key) as [string, ...string[]]),
        number: z.number().nullable().describe("For a setting measured in USD, days, years, % or a count."),
        yes: z.boolean().nullable().describe("For a yes/no setting."),
        list: z.array(z.string()).describe("For a list setting. Empty otherwise."),
        text: z.string().describe("For a text setting. Empty otherwise."),
        source: z.string().describe("Where in the agreement, e.g. 'Agreement, clause 7.1(b)'."),
        quote: z.string().describe("The agreement's words, under 40 words."),
      }),
    )
    .describe("Only rules the agreement states that match one of the settings listed. Leave out a setting the agreement does not address."),
  terms: z.array(z.object({ text: z.string().describe("The term in one plain sentence."), source: z.string() })).describe("Other obligations a project team must follow that match no setting: branding and visibility, audit requirements, cost limits, prior approvals. At most 20."),
  questions: z.array(z.string()).describe("What the agreement leaves unclear or contradictory. Empty if nothing."),
});
export type TermsProposal = z.infer<typeof termsSchema>;

const TERMS_SYSTEM = [
  "You read a donor agreement for a project management app and list what the implementing organization must do: the reports it owes and when, and the donor's rules that can be checked.",
  "Take every value from the agreement; never invent or assume a donor's usual practice. Cite the clause for each. When something is unclear, leave it out and say so in questions.",
].join(" ");

export const extractTerms = (files: SetupFile[]) =>
  readDocuments(files, TERMS_SYSTEM, `List the reporting obligations, the rules that match these settings, and the other terms.\nSettings (key: what it means, unit):\n${RULE_KEYS.map((r) => `${r.key}: ${r.label} (${r.unit})`).join("\n")}`, termsSchema);

// ---------- A budget in Word or PDF (Excel budgets are read without AI, lib/budget) ----------

const budgetSchema = z.object({
  currency: z.string().describe("ISO 4217 code, e.g. USD."),
  lines: z
    .array(
      z.object({
        code: z.string().describe("The line's code or number as written; empty if none."),
        description: z.string(),
        amount: z.number().describe("The line's total for the whole agreement."),
        activityCode: z.string().describe("The workplan activity number, e.g. 1.2.1, only when the document links the line to it. Empty otherwise."),
        source: z.string().describe("Where, e.g. 'Budget, page 3, row 14'."),
      }),
    )
    .describe("Every budget line with an amount, not subtotals or totals, in the document's order."),
  questions: z.array(z.string()),
});
export type BudgetProposal = z.infer<typeof budgetSchema>;

export const extractBudget = (files: SetupFile[]) =>
  readDocuments(files, "You read a project budget for a project management app. Take every line and amount from the document; never invent. Leave out subtotal and total rows. Link a line to an activity only where the document does.", "List the budget lines.", budgetSchema);
