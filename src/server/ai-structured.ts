import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { DRAFT_MODEL, DraftingUnavailable } from "@/server/ai-drafts";

/**
 * One structured draft from Claude: a system prompt, the facts as JSON, and a Zod schema the
 * answer must match. Drafts only: people read, correct and decide. Errors come back in plain
 * language so the screen can show them. Returns the model that answered, for the audit trail.
 */
export async function draftStructured<T extends z.ZodType>(opts: { system: string; task: string; facts: unknown; schema: T; effort?: "low" | "medium" | "high"; maxTokens?: number }): Promise<{ out: z.infer<T>; model: string }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new DraftingUnavailable("AI drafting is not set up on this server: add ANTHROPIC_API_KEY.");
  const client = new Anthropic({ maxRetries: 1 });
  const stream = client.beta.messages.stream({
    model: DRAFT_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
    system: opts.system,
    messages: [{ role: "user", content: `${opts.task}\n\nThe facts (JSON):\n${JSON.stringify(opts.facts, null, 2)}` }],
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stream.abort();
  }, 110_000);
  try {
    const res = await stream.finalMessage();
    if (res.stop_reason === "refusal") throw new Error("The drafting model declined this request. Write it by hand.");
    if (res.stop_reason === "max_tokens") throw new Error("The draft was cut off. Try again with less at once.");
    if (!res.parsed_output) throw new Error("The draft came back empty. Try again.");
    return { out: res.parsed_output as z.infer<T>, model: res.model };
  } catch (e) {
    if (timedOut || e instanceof Anthropic.APIConnectionTimeoutError) throw new Error("Drafting took too long. Try again.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Too many drafts at once. Wait a minute and try again.");
    if (e instanceof Anthropic.AuthenticationError) throw new Error("The AI key on this server was not accepted. An administrator needs to replace ANTHROPIC_API_KEY.");
    if (e instanceof Anthropic.APIConnectionError) throw new Error("Could not reach the AI service. Try again.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
