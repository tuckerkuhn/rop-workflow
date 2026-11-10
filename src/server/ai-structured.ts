import type { z } from "zod";
import { askAi, type Ask } from "@/server/ai";

/**
 * One structured draft from Claude: a system prompt, the facts as JSON, and a Zod schema the
 * answer must match. Drafts only: people read, correct and decide. Errors come back in plain
 * language so the screen can show them. Returns the model that answered, for the audit trail.
 *
 * A thin name kept for the jobs that already used it; the call itself is the one door, server/ai.ts,
 * which needs the job's name, who asked, and facts cleared for personal text.
 */
export async function draftStructured<T extends z.ZodType>(opts: Pick<Ask<T>, "job" | "by" | "projectId" | "system" | "task" | "facts" | "schema" | "effort" | "maxTokens" | "images">): Promise<{ out: z.infer<T>; model: string }> {
  const { out, model } = await askAi({ ...opts, say: { refused: "The drafting model declined this request. Write it by hand.", cutOff: "The draft was cut off. Try again with less at once.", empty: "The draft came back empty. Try again.", tooLong: "Drafting took too long. Try again." } });
  return { out, model };
}
