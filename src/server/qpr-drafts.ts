import { z } from "zod";
import { quarterRange } from "@/lib/results";
import { STATUS_LABEL } from "@/lib/qpr";
import { askAi, scrubbed } from "@/server/ai";
import { winThemesContext } from "@/server/project-origin";
import type { QprData } from "@/server/qpr-store";
import { ROP_VOICE } from "@/lib/voice";
import { withoutNames } from "@/lib/personal-text";

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
- Use only the facts given: figures, places, dates, the notes field staff wrote with each result, the activity updates (progress that is not an indicator count, such as reservoirs built, grants signed or sales at an exhibition) and the lessons the team recorded this quarter. Never invent a number, place, partner, quote or outcome. If something a reader would expect is missing (for example why an indicator is behind), leave a marked placeholder in square brackets, e.g. [reason for delay], and list it in questions.
- Every figure you use must match the facts exactly, with its unit.
- win_themes_context, when given, is what the proposal told the donor about why to choose ROP. Use it only to choose what to put first. Never state a theme as a result or as something achieved.
- Plain, factual report English, in short paragraphs. Past tense for what happened in the quarter. No marketing language, no bullet lists unless asked.
- Refer to indicators by their UNDP code in brackets after the result, e.g. "(1.1.1.4)".
- Do not name individual farmers or business owners: names belong in consented success stories, not the report.

What each key means:
- "summary": the Executive Summary: one short paragraph per output (1.1, 1.2, 2.1) with the quarter's headline results and the year's progress against target. About 250 to 350 words in all.
- "act.X.Y.Z": the narrative for activity X.Y.Z: what was done this quarter under each of its indicators, where, for how many women and men or women-led and men-led businesses, and what is next; from the result notes and that activity's updates. kobo_field_records_this_quarter, when given, says how many records a KoboCollect form that records the activity holds this quarter (e.g. farm visits); use them as field evidence for the work, not as an indicator result. If nothing was achieved, say so in one or two sentences and what is planned, with a placeholder for the reason.
- "gender": 3.1 Gender Equality: women reached and women-led businesses this quarter, indicator by indicator, with figures; what the notes say about how women were included. Never add women across indicators into one total: the same person can be counted under more than one indicator.
- "lessons": VI. Lessons Learned: one short paragraph per lesson in lessons_this_quarter: what happened, what the team learned and what it will do differently. Use only those lessons; add none. If there are none, write one sentence with a placeholder, [lessons learned this quarter], and ask for them in questions.
- "next": VII. Way Forward: priorities for next quarter, led by the indicators that are delayed or not implemented, and the remaining annual targets; include what the lessons say the team will do differently.

${ROP_VOICE}`;

/** The facts a draft is written from. Free text is scrubbed again at the door (draftQpr). */
export function qprFacts(d: QprData) {
  // A report built before periods were kept has none: its calendar quarter.
  const { from, to } = d.period ?? quarterRange(d.quarter);
  return {
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
      .map((r) => ({ indicator: d.rows.find((x) => x.code === r.indicator)?.donorCode, date: r.date, value: r.value, province: r.province, district: r.district, crop: r.crop, women: r.female, men: r.male, women_led: r.womenLed, men_led: r.menLed, note: withoutNames(r.note) })),
    activity_updates_this_quarter: d.updates.map((u) => ({ activity: u.activity, date: u.date, ...(u.title ? { title: u.title } : {}), note: withoutNames(u.note) })),
    // From the lessons record: what was recorded, never who recorded it.
    lessons_this_quarter: d.lessons.map((l) => ({ date: l.date, area: l.area, happened: withoutNames(l.happened), lesson: withoutNames(l.lesson), action: withoutNames(l.action) })),
  };
}

export async function draftQpr(d: QprData, keys: string[], by: string): Promise<{ sections: { key: string; text: string }[]; questions: string[] }> {
  // The won proposal's win themes, as context only (server/project-origin).
  // Field evidence: KoboCollect submission counts of the forms linked to each activity (server/kobo-activities).
  const facts = { ...qprFacts(d), ...(await winThemesContext(d.project.code)) };
  // Notes and lessons are scrubbed above as before; the door also replaces names in update titles and row comments.
  const { out } = await askAi({
    job: "qprDraft",
    by,
    system: SYSTEM,
    task: `Draft these sections: ${keys.join(", ")}. List only questions that these sections need answered, at most four, most important first.`,
    facts: scrubbed(facts, ["note", "title", "comment", "happened", "lesson", "action"]),
    schema: outSchema,
    maxTokens: 20000,
    say: { refused: "The drafting model declined this request. Write these sections by hand.", cutOff: "The draft was cut off. Draft fewer sections at once.", empty: "The draft came back empty. Try again.", tooLong: "Drafting took too long. Draft fewer sections at once." },
  });
  if (!out.sections.length) throw new Error("The draft came back empty. Try again.");
  return { sections: out.sections.filter((s) => keys.includes(s.key)), questions: out.questions };
}
