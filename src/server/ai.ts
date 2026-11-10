import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { db, schema as s } from "@/db";
import { AI_JOBS, scrubKeys, type AiJobName } from "@/lib/ai-jobs";
import { ROP_VOICE } from "@/lib/voice";

/**
 * The one door for AI. Every call to Claude in the app goes through `askAi`, and this is the only
 * file that imports the SDK. What the door does for every job, so no job can skip it:
 *
 * - **Named job, named person.** The job must be in lib/ai-jobs.ts; `by` is who asked.
 * - **Personal text.** Facts only pass as `Cleared`: built with `scrubbed` (names and villages
 *   replaced in the free-text fields named) or with `asIs` and a written reason. Either way, how
 *   the facts were handled is kept on the audit row.
 * - **Voice.** A job that writes for people gets ROP's voice rules if its prompt lacks them.
 * - **Drafts only.** The door returns a proposal and the model that wrote it; it saves nothing.
 *   The caller stores it as a draft with its source and reason, and a named person confirms.
 * - **Audit.** One `ai_run` row per call: the job, who asked, the model that answered, how the
 *   facts were cleared, and whether it worked.
 * - **Failure.** Every failure is a plain sentence saying what to do next. The caller has changed
 *   nothing yet, so the person's own work is as they left it.
 */

export const DRAFT_MODEL = "claude-opus-5-5";

/** AI is not set up on this server (no key). Routes answer 503 with the message. */
export class DraftingUnavailable extends Error {}
const NOT_SET_UP = "AI is not set up on this server yet, so this was not drafted. You can do it by hand. An administrator turns AI on by adding ANTHROPIC_API_KEY.";

/* ---------------- personal text ---------------- */

const CLEARED = Symbol("cleared for AI");
/** Facts that have been through `scrubbed` or `asIs`. Nothing else is accepted by the door. */
export type Cleared = { readonly [CLEARED]: true; readonly value: unknown; readonly how: string };

/** Facts with names and villages replaced in the free-text fields named (at any depth). `firstNames` keeps first names: stories and posts. */
export const scrubbed = (value: unknown, freeText: readonly string[], opts: { firstNames?: boolean } = {}): Cleared => ({
  [CLEARED]: true,
  value: scrubKeys(value, freeText, false, !!opts.firstNames),
  how: `${opts.firstNames ? "last names and villages" : "names"} replaced in: ${freeText.join(", ")}`,
});

/** Facts sent as they are. `why` says why that is right for this job; it is kept on the audit row. */
export const asIs = (value: unknown, why: string): Cleared => ({ [CLEARED]: true, value, how: `as is: ${why}` });

/* ---------------- the call ---------------- */

type Image = { type: "image/jpeg" | "image/png" | "image/webp"; data: Buffer };
type Doc = { name: string; kind: "pdf"; data: string } | { name: string; kind: "text"; text: string };

/** Wording a job gives for its own failures; the door's plain default is used otherwise. */
type Say = Partial<Record<"refused" | "cutOff" | "empty" | "tooLong" | "busy", string>>;

export type Ask<T extends z.ZodType> = {
  job: AiJobName;
  /** Who asked: the person's id. A background job passes the person whose record started it. */
  by: string;
  /** The project's database id, when the run belongs to one. */
  projectId?: string | null;
  system: string;
  task: string;
  facts: Cleared;
  /** The heading over the facts in the prompt. */
  factsLabel?: string;
  schema: T;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  timeoutMs?: number;
  images?: Image[];
  documents?: Doc[];
  say?: Say;
};

export async function askAi<T extends z.ZodType>(a: Ask<T>): Promise<{ out: z.infer<T>; model: string; runId: string }> {
  const job = AI_JOBS[a.job];
  if (!job) throw new Error(`No such AI job: ${String(a.job)}. Add it to lib/ai-jobs.ts first.`);
  if (!process.env.ANTHROPIC_API_KEY) throw new DraftingUnavailable(NOT_SET_UP);
  const runId = randomUUID();
  const system = job.voice && !a.system.includes(ROP_VOICE) ? `${a.system}\n\n${ROP_VOICE}` : a.system;
  const text = a.facts.value === undefined || a.facts.value === null ? a.task : `${a.task}\n\n${a.factsLabel ?? "The facts (JSON)"}:\n${JSON.stringify(a.facts.value, null, 2)}`;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of a.documents ?? []) {
    if (f.kind === "pdf") content.push({ type: "document", title: f.name, source: { type: "base64", media_type: "application/pdf", data: f.data } });
    else content.push({ type: "text", text: `Document: ${f.name}\n\n${f.text}` });
  }
  for (const im of a.images ?? []) content.push({ type: "image", source: { type: "base64", media_type: im.type, data: im.data.toString("base64") } });
  content.push({ type: "text", text });

  const client = new Anthropic({ maxRetries: 1 });
  // Streamed, so the connection never sits idle while the model thinks; stopped before the server's own limit.
  const stream = client.beta.messages.stream({
    model: DRAFT_MODEL,
    max_tokens: a.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: a.effort ?? "medium", format: betaZodOutputFormat(a.schema as T & z.ZodObject<z.ZodRawShape>) },
    system,
    messages: [{ role: "user", content }],
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stream.abort();
  }, a.timeoutMs ?? 110_000);
  let model = DRAFT_MODEL;
  try {
    const res = await stream.finalMessage();
    model = res.model;
    if (res.stop_reason === "refusal") throw new Plain(a.say?.refused ?? "The AI declined this request. Do it by hand.");
    if (res.stop_reason === "max_tokens") throw new Plain(a.say?.cutOff ?? "The answer was cut off. Try again with less at once.");
    if (!res.parsed_output) throw new Plain(a.say?.empty ?? "Nothing came back. Try again.");
    await record(a, runId, model, null);
    return { out: res.parsed_output as z.infer<T>, model, runId };
  } catch (e) {
    const message = plainAiError(e, timedOut, a.say);
    await record(a, runId, model, message);
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

/** A failure already in plain words. */
class Plain extends Error {}

/** Every failure in plain words with what to do next. A raw SDK or network message never reaches a person. */
export function plainAiError(e: unknown, timedOut: boolean, say: Say = {}): string {
  if (e instanceof Plain) return e.message;
  if (timedOut || e instanceof Anthropic.APIConnectionTimeoutError || e instanceof Anthropic.APIUserAbortError) return say.tooLong ?? "The AI took too long. Try again; if it repeats, try with less at once.";
  if (e instanceof Anthropic.RateLimitError) return "Too many AI requests at once. Wait a minute and try again.";
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "The AI key on this server was not accepted. An administrator needs to replace ANTHROPIC_API_KEY. Until then, do this by hand.";
  if (e instanceof Anthropic.APIConnectionError) return "Could not reach the AI service. Check the connection and try again.";
  if (e instanceof Anthropic.AnthropicError && /parse structured output/i.test(e.message)) return "The answer came back cut short. Try again; if it repeats, try with less text at once.";
  if (e instanceof Anthropic.APIError) {
    if (e.status === 413 || (e.status === 400 && /too (long|large)|maximum|context/i.test(e.message))) return say.cutOff ?? "That is too much for the AI to read at once. Try again with less.";
    if (e.status === 529 || (e.status !== undefined && e.status >= 500)) return say.busy ?? "The AI service is busy. Wait a few minutes and try again.";
    return "The AI service did not accept this request. Try again; if it repeats, tell an administrator (Settings, Health shows the details) and do this by hand.";
  }
  return "The AI could not finish this. Nothing was changed. Try again; if it repeats, do this by hand and tell an administrator.";
}

/** The audit row for a run. Never fails the run: the database may be what is down. */
async function record(a: Ask<z.ZodType>, runId: string, model: string, error: string | null) {
  try {
    await db.insert(s.auditLog).values({ projectId: a.projectId ?? null, entity: "ai", entityId: runId, action: error ? "ai_run_failed" : "ai_run", detail: { by: a.by, job: a.job, what: AI_JOBS[a.job].label, model, personalText: a.facts.how, ...(error ? { error } : {}) } });
  } catch (e) {
    console.error("ai_run audit row not written", e);
  }
}
