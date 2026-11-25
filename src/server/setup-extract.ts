import { z } from "zod";
import { FREQUENCIES, RULE_KEYS } from "@/lib/agreement";
import { COUNTRIES } from "@/lib/project-setup";
import type { AiJobName } from "@/lib/ai-jobs";
import { asIs, askAi } from "@/server/ai";
import { setupDesignSchema, type SetupProposal } from "@/lib/setup-design";

/**
 * Project setup from the documents: the agreement (PDF or Word), the logframe or results framework
 * (Excel, Word or PDF) and the budget. Three readers: the design (name, donor, dates, goal, every
 * indicator with its donor code, unit, targets, baseline, breakdowns, means of verification,
 * frequency and result statement, lib/setup-design); the agreement's terms (reporting obligations
 * and checkable donor rules, lib/agreement); and a budget in Word or PDF. Every value says where it
 * came from. Proposals only: the person confirms each section in setup before anything is saved.
 */

export type SetupFile = { name: string; kind: "pdf"; data: string } | { name: string; kind: "text"; text: string };

const schema = setupDesignSchema;
export type { SetupProposal };

const SYSTEM = [
  "You read a donor agreement and a project's logframe or results framework and extract the project's design for a project management app.",
  "Take every value from the documents; never invent. When a value is missing, leave it empty and say so in questions. When the documents disagree, use the logframe for indicators and the agreement for dates, and say which you used in questions.",
  "Indicators: include every indicator at goal, outcome and output level, also one with no number target (leave its target null and say so in questions). Keep the donor's numbering and wording.",
  "For each indicator take, where the documents give them, its baseline and baseline year, the breakdowns required (sex, age, place), the means of verification, how often it is reported and the wording of the outcome or output it measures. Leave a value empty or null when the documents do not give it; never fill it from a donor's usual practice.",
].join(" ");

/** Reads the documents with one structured call. Any of the three readers below uses it. */
async function readDocuments<T>(job: AiJobName, by: string, files: SetupFile[], system: string, task: string, out: z.ZodType<T>): Promise<{ out: T; model: string }> {
  const r = await askAi({
    job,
    by,
    system,
    task,
    // The documents are what the person asked to have read; nothing else goes with them.
    facts: asIs(null, "the documents the person uploaded to be read (an agreement, logframe or budget)"),
    documents: files,
    schema: out,
    maxTokens: 32000,
    timeoutMs: 170_000,
    say: { refused: "The model declined to read these documents. Enter the details by hand.", cutOff: "The documents are too long to read at once: upload them one at a time.", empty: "Nothing came back. Try again.", tooLong: "Reading the documents took too long. Try them one at a time." },
  });
  return { out: r.out, model: r.model };
}

export const extractSetup = (files: SetupFile[], by: string) => readDocuments("setupDesign", by, files, SYSTEM, `Extract the project's design from these documents. Countries the app knows: ${COUNTRIES.join(", ")}.`, schema);

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

export const extractTerms = (files: SetupFile[], by: string) =>
  readDocuments("setupTerms", by, files, TERMS_SYSTEM, `List the reporting obligations, the rules that match these settings, and the other terms.\nSettings (key: what it means, unit):\n${RULE_KEYS.map((r) => `${r.key}: ${r.label} (${r.unit})`).join("\n")}`, termsSchema);

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

export const extractBudget = (files: SetupFile[], by: string) =>
  readDocuments("setupBudget", by, files, "You read a project budget for a project management app. Take every line and amount from the document; never invent. Leave out subtotal and total rows. Link a line to an activity only where the document does.", "List the budget lines.", budgetSchema);
