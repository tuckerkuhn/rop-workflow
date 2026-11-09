import { z } from "zod";
import { SECTIONS, type ClaimCheck, type ClaimIssue } from "@/lib/qpr";
import { quarterRange, type UpdateRecord } from "@/lib/results";
import { draftStructured } from "@/server/ai-structured";
import type { QprData } from "@/server/qpr-store";
import { withoutNames } from "@/lib/personal-text";

/**
 * The text checked against the evidence before a report goes out. Figures are checked by code:
 * Claude only lists each claim (sentence, indicator code, value), and the claimed value is
 * compared with the quarter's accepted results. Timing and contradictions are
 * judged by Claude against the dated evidence (results with their photo dates, and weekly updates
 * up to a month after the quarter), citing the records it relies on. Findings inform; people decide.
 */

const schema = z.object({
  claims: z
    .array(
      z.object({
        section: z.string().describe("The section key the sentence is in."),
        sentence: z.string().describe("The first 25 words of the sentence, quoted exactly."),
        indicator: z.string().describe("The UNDP indicator code the sentence reports on, e.g. 1.1.1.4, or empty."),
        value: z.number().nullable().describe("The indicator's total for the quarter as the sentence states it. Null when the sentence gives only a part (one district, one group) or no figure."),
      }),
    )
    .describe("Every sentence that states a figure for an indicator this quarter. Skip sentences about plans, targets or earlier quarters."),
  contradictions: z
    .array(
      z.object({
        section: z.string(),
        sentence: z.string().describe("The first 25 words of the sentence, quoted exactly."),
        problem: z.string().describe("What the evidence says instead, in one plain sentence with dates."),
        evidence: z.array(z.string()).describe("The ids of the records or updates that show it (r:… or u:…)."),
      }),
    )
    .describe("Sentences the dated evidence contradicts: work claimed for the quarter that the evidence dates after it, or claimed as complete while updates call it ongoing. Only real contradictions, each with its evidence. Empty if none."),
});

const SYSTEM = `You check a donor progress report's text against the project's own dated evidence. You do not rewrite anything.
List the claims as asked, quoting sentences exactly. Then list contradictions: only where a result's photo dates or a weekly update clearly place the work outside the quarter, or call it unfinished when the text says it was done. Cite the evidence ids. When unsure, leave it out: a false alarm costs the team time.`;

export async function checkClaims(d: QprData, updates: UpdateRecord[], by: string): Promise<ClaimCheck> {
  const { from, to } = quarterRange(d.quarter);
  const keys = [...SECTIONS.map((s) => s.key as string), ...d.activities.map((a) => `act.${a.code}`)];
  const sections = Object.fromEntries(keys.map((k) => [k, d.saved.sections[k]?.text?.trim() ?? ""]).filter(([, t]) => t));
  if (!Object.keys(sections).length) return { at: new Date().toISOString(), by, model: "", checked: 0, issues: [], sections: {} };
  const until = new Date(Date.parse(`${to}T00:00:00Z`) + 31 * 864e5).toISOString().slice(0, 10);
  const accepted = d.results.filter((r) => r.status === "accepted" && r.date >= from && r.date <= to);
  const facts = {
    quarter: `${d.quarter} (${from} to ${to})`,
    sections,
    indicators: d.rows.map((r) => ({ code: r.donorCode, name: r.name, unit: r.unit })),
    results: accepted.map((r) => ({ id: `r:${r.id}`, indicator: d.rows.find((x) => x.code === r.indicator)?.donorCode, date: r.date, value: r.value, district: r.district, province: r.province, photoDates: Object.values(r.taken ?? {}), note: withoutNames(r.note).slice(0, 300) })),
    weeklyUpdates: updates
      .filter((u) => u.date >= from && u.date <= until)
      .map((u) => ({ id: `u:${u.id}`, date: u.date, activity: u.activity, title: u.title, note: withoutNames(u.note).slice(0, 600), photoDates: Object.values(u.taken ?? {}) })),
  };
  const { out, model } = await draftStructured({ system: SYSTEM, task: "List the claims and the contradictions.", facts, schema, effort: "low", maxTokens: 32000 });

  const issues: ClaimIssue[] = [];
  const byCode = new Map(d.rows.map((r) => [r.donorCode, r]));
  for (const c of out.claims) {
    const row = byCode.get(c.indicator.trim());
    if (!row) continue;
    // Figures: the claimed quarter value against the accepted results' total (only a clear quarter figure is compared).
    if (c.value !== null && c.value !== row.quarter && c.value !== row.year) issues.push({ section: c.section, sentence: c.sentence, kind: "figure", problem: `Says ${c.value} ${row.unit} for ${row.donorCode}; accepted results give ${row.quarter} this quarter and ${row.year} this year.`, evidence: [] });
    const mine = accepted.filter((r) => r.indicator === row.code);
    // Timing: every photo behind the indicator's results dated after the quarter.
    const dates = mine.flatMap((r) => Object.values(r.taken ?? {})).sort();
    if (dates.length && dates[0] > to) issues.push({ section: c.section, sentence: c.sentence, kind: "timing", problem: `The photos behind ${row.donorCode} are dated ${dates[0]}${dates.length > 1 ? ` to ${dates.at(-1)}` : ""}, after the quarter ended (${to}).`, evidence: mine.map((r) => `r:${r.id}`) });
  }
  const valid = new Set([...facts.results.map((r) => r.id), ...facts.weeklyUpdates.map((u) => u.id)]);
  for (const c of out.contradictions) {
    const ev = c.evidence.filter((e) => valid.has(e));
    // A contradiction must cite evidence that exists; otherwise it is the model's guess and is dropped.
    if (ev.length) issues.push({ section: c.section, sentence: c.sentence, kind: "contradiction", problem: c.problem, evidence: ev });
  }
  // One finding per sentence and kind.
  const seen = new Set<string>();
  const unique = issues.filter((i) => !seen.has(`${i.kind}:${i.sentence}`) && !!seen.add(`${i.kind}:${i.sentence}`));
  return { at: new Date().toISOString(), by, model, checked: out.claims.length, issues: unique, sections };
}
