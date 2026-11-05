import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { STATUS_LABEL } from "@/lib/qpr";
import { quarterRange } from "@/lib/results";
import { DRAFT_MODEL, DraftingUnavailable } from "@/server/ai-drafts";
import type { QprData } from "@/server/qpr-store";

/**
 * Drafts the quarterly report's text from accepted results and their notes. Drafts only: the
 * team reads and corrects every section before the report goes out, and the model never adds
 * a figure that is not in the facts.
 */

const outSchema = z.object({
  sections: z.array(z.object({ key: z.string(), text: z.string() })).describe("One entry per requested key, in the order asked."),
  questions: z.array(z.string()).describe("Facts the team must add or confirm, e.g. a missing district or why an indicator is behind. Empty if none."),
});

const SYSTEM = `You draft sections of the quarterly progress report that Roots of Peace (ROP) sends to UNDP for a project in Afghanistan.

Rules:
- Use only the facts given: figures, places, dates, the notes field staff wrote with each result, and the activity updates (progress that is not an indicator count, such as reservoirs built, grants signed or sales at an exhibition). Never invent a number, place, partner, quote or outcome. If something a reader would expect is missing (for example why an indicator is behind), leave a marked placeholder in square brackets, e.g. [reason for delay], and list it in questions.
- Every figure you use must match the facts exactly, with its unit.
- Plain, factual report English, in short paragraphs. Past tense for what happened in the quarter. No marketing language, no bullet lists unless asked.
- Refer to indicators by their UNDP code in brackets after the result, e.g. "(1.1.1.4)".
- Do not name individual beneficiaries.

What each key means:
- "summary": the Executive Summary: one short paragraph per output (1.1, 1.2, 2.1) with the quarter's headline results and the year's progress against target. About 250 to 350 words in all.
- "act.X.Y.Z": the narrative for activity X.Y.Z: what was done this quarter under each of its indicators, where, for how many women and men or women-led and men-led businesses, and what is next; from the result notes and that activity's updates. If nothing was achieved, say so in one or two sentences and what is planned, with a placeholder for the reason.
- "gender": 3.1 Gender Equality: women reached and women-led businesses this quarter, indicator by indicator, with figures; what the notes say about how women were included. Never add women across indicators into one total: the same person can be counted under more than one indicator.
- "next": VII. Way Forward: priorities for next quarter, led by the indicators that are delayed or not implemented, and the remaining annual targets.`;

export async function draftQpr(d: QprData, keys: string[]): Promise<{ sections: { key: string; text: string }[]; questions: string[] }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new DraftingUnavailable("AI drafting is not set up on this server: add ANTHROPIC_API_KEY.");
  const { from, to } = quarterRange(d.quarter);
  const facts = {
    project: d.project.name,
    donor: d.project.donor,
    goal: d.project.goal,
    quarter: `${d.quarter} (${from} to ${to})`,
    activities: d.activities,
    indicators: d.rows.map((r) => ({
      code: r.donorCode,
      activity: r.activity,
      output: r.output,
      indicator: r.name,
      unit: r.unit,
      target_this_year: r.yearTarget,
      achieved_this_quarter: r.quarter,
      achieved_this_year: r.year,
      women_this_quarter: r.women || undefined,
      men_this_quarter: r.men || undefined,
      women_led_this_quarter: r.womenLed || undefined,
      men_led_this_quarter: r.menLed || undefined,
      provinces: r.provinces,
      status: STATUS_LABEL[r.status],
      comment: r.comment,
    })),
    results_this_quarter: d.results
      .filter((r) => r.status === "accepted" && r.date >= from && r.date <= to)
      .map((r) => ({ indicator: d.rows.find((x) => x.code === r.indicator)?.donorCode, date: r.date, value: r.value, province: r.province, district: r.district, crop: r.crop, women: r.female, men: r.male, women_led: r.womenLed, men_led: r.menLed, note: r.note })),
    activity_updates_this_quarter: d.updates.map((u) => ({ activity: u.activity, date: u.date, note: u.note })),
  };
  const client = new Anthropic({ maxRetries: 1 });
  const stream = client.beta.messages.stream({
    model: DRAFT_MODEL,
    max_tokens: 20000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(outSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: `Draft these sections: ${keys.join(", ")}.\n\nThe facts (JSON):\n${JSON.stringify(facts, null, 2)}` }],
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stream.abort();
  }, 110_000);
  try {
    const res = await stream.finalMessage();
    if (res.stop_reason === "refusal") throw new Error("The drafting model declined this request. Write these sections by hand.");
    if (res.stop_reason === "max_tokens") throw new Error("The draft was cut off. Draft fewer sections at once.");
    const out = res.parsed_output;
    if (!out?.sections.length) throw new Error("The draft came back empty. Try again.");
    return { sections: out.sections.filter((s) => keys.includes(s.key)), questions: out.questions };
  } catch (e) {
    if (timedOut || e instanceof Anthropic.APIConnectionTimeoutError) throw new Error("Drafting took too long. Draft fewer sections at once.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Too many drafts at once. Wait a minute and try again.");
    if (e instanceof Anthropic.AuthenticationError) throw new Error("The AI key on this server was not accepted. An administrator needs to replace ANTHROPIC_API_KEY.");
    if (e instanceof Anthropic.APIConnectionError) throw new Error("Could not reach the AI service. Try again.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
