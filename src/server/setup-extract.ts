import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { COUNTRIES } from "@/lib/project-setup";
import { DRAFT_MODEL, DraftingUnavailable } from "@/server/ai-drafts";

/**
 * Project setup from the documents: the agreement (PDF or Word) and the logframe or results
 * framework (Excel, Word or PDF). Claude reads them and proposes the project's design: its name,
 * donor, dates, goal and every indicator with its donor code, unit, target and yearly targets.
 * A proposal only: the person checks each answer in setup before anything is saved.
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
  questions: z.array(z.string()).describe("What the documents leave unclear or contradictory, for the person to settle. Empty if nothing."),
});
export type SetupProposal = z.infer<typeof schema>;

const SYSTEM = [
  "You read a donor agreement and a project's logframe or results framework and extract the project's design for a project management app.",
  "Take every value from the documents; never invent. When a value is missing, leave it empty and say so in questions. When the documents disagree, use the logframe for indicators and the agreement for dates, and say which you used in questions.",
  "Indicators: include every measurable indicator with a target, at goal, outcome and output level. Keep the donor's numbering and wording.",
].join(" ");

export async function extractSetup(files: SetupFile[]): Promise<{ out: SetupProposal; model: string }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new DraftingUnavailable("AI is not set up on this server: add ANTHROPIC_API_KEY.");
  const client = new Anthropic({ maxRetries: 1 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of files) {
    if (f.kind === "pdf") content.push({ type: "document", title: f.name, source: { type: "base64", media_type: "application/pdf", data: f.data } });
    else content.push({ type: "text", text: `Document: ${f.name}\n\n${f.text}` });
  }
  content.push({ type: "text", text: `Extract the project's design from these documents. Countries the app knows: ${COUNTRIES.join(", ")}.` });
  const stream = client.beta.messages.stream({
    model: DRAFT_MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });
  const timer = setTimeout(() => stream.abort(), 170_000);
  try {
    const res = await stream.finalMessage();
    if (res.stop_reason === "refusal") throw new Error("The model declined to read these documents.");
    if (res.stop_reason === "max_tokens") throw new Error("The documents are too long to read at once: upload the logframe on its own.");
    if (!res.parsed_output) throw new Error("Nothing came back. Try again.");
    return { out: res.parsed_output as SetupProposal, model: res.model };
  } catch (e) {
    if (e instanceof Anthropic.APIUserAbortError) throw new Error("Reading the documents took too long. Try the logframe on its own.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
