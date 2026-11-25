import { z } from "zod";
import { ancestors, type Framework, type Statement } from "@/lib/framework";
import type { Measure } from "@/lib/measure";
import type { IndicatorInput } from "@/lib/project-setup";

/**
 * What setup reads about a project's design from its documents (server/setup-extract) and how
 * each indicator becomes one setup can save. Everything the agreement and the logframe say about
 * an indicator is kept: its baseline, breakdowns, means of verification, reporting frequency and
 * the result statement it sits under, so reports start complete. Nothing here needs AI: a person
 * can fill the same fields by hand. The rules here have no database in them.
 */

/** A project keeps at most this many indicators (lib/project-setup). More in the documents gives a warning, never a silent drop. */
export const MAX_INDICATORS = 40;

/** Reporting frequency as the documents may state it. The app has three (monthly, quarterly, end of season). */
export const DOC_FREQUENCIES = ["monthly", "quarterly", "semiannual", "annual", "end_of_season", "baseline_endline", "once", "not_stated"] as const;
export type DocFrequency = (typeof DOC_FREQUENCIES)[number];

/** Breakdowns the documents may require. "place" is a location with no level stated. */
export const DOC_BREAKDOWNS = ["sex", "age", "province", "district", "village", "place", "crop"] as const;

/** How the indicator is stated: a count that adds up, a change against the baseline, or a rate, share or average. */
export const STATED_AS = ["count", "change_from_baseline", "rate_share_or_average"] as const;

export const designIndicatorSchema = z.object({
  donorCode: z.string().describe("The donor's number for the indicator, e.g. 1.1.1.3 or 2.1.2.1-a. Empty if none."),
  name: z.string(),
  unit: z.string().describe("What is counted: farmers, ha, jerib, greenhouses, persons, events, % of households…"),
  target: z.number().nullable().describe("The life-of-project target. Null when the documents give no number (e.g. 'to be set after the baseline survey')."),
  level: z.enum(["goal", "outcome", "output"]),
  yearTargets: z.array(z.object({ year: z.number(), target: z.number().describe("The target for that calendar year alone, not a running total.") })).describe("Per calendar year, when the framework gives them. Empty if not."),
  baseline: z.number().nullable().describe("The baseline value as a number in the indicator's unit. Null when not stated or 'to be determined'."),
  baselineYear: z.number().nullable().describe("The year the baseline was measured, e.g. 2025. Null when not stated."),
  breakdowns: z.array(z.enum(DOC_BREAKDOWNS)).describe("The breakdowns the documents require for it: sex, age and place (province, district or village as written; 'place' when no level is given). Empty if none are stated."),
  verification: z.string().describe("The means of verification as written, e.g. 'Attendance sheets; endline survey'. Empty if none."),
  frequency: z.enum(DOC_FREQUENCIES).describe("How often it is reported or measured, as the documents say. 'not_stated' when they do not say."),
  result: z.string().describe("The wording of the result this indicator measures, at its own level: the outcome statement for an outcome indicator, the output statement for an output indicator. As written. Empty if none."),
  statedAs: z.enum(STATED_AS).describe("count: a number that adds up (farmers trained, hectares). change_from_baseline: stated as an increase or decrease against the baseline. rate_share_or_average: a percentage, share, rate or average."),
  surveyed: z.boolean().describe("True when the documents say a survey (baseline, midline, endline, household or farmer survey) measures it."),
  source: z.string().describe("Where in the documents this came from, e.g. 'Logframe, row 14'."),
});
export type DesignIndicator = z.infer<typeof designIndicatorSchema>;

/** The country list is passed in so this file does not depend on where it lives. */
export const setupDesignSchema = z.object({
  name: z.string().describe("The project's full title as the agreement gives it, with its acronym in brackets if it has one."),
  donor: z.string().describe("The donor or funding agency, e.g. UNDP. Empty if not stated."),
  country: z.string().describe("ISO 3166-1 alpha-2 code of the main country, e.g. AF."),
  crop: z.string().describe("The main crop or value chain, if the project has one. Empty if none."),
  startDate: z.string().describe("YYYY-MM-DD; empty if not stated."),
  endDate: z.string().describe("YYYY-MM-DD; empty if not stated."),
  goal: z.string().describe("The project's goal or overall objective, one or two sentences, as written."),
  indicators: z.array(designIndicatorSchema).describe("Every indicator the project reports on, outcomes and outputs included, with or without a number target, in the documents' order."),
  sources: z
    .object({ name: z.string(), donor: z.string(), dates: z.string(), goal: z.string() })
    .describe("Where each of these came from, e.g. 'Agreement, cover page' or 'Agreement, clause 2.1'. Empty when not found."),
  questions: z.array(z.string()).describe("What the documents leave unclear or contradictory, for the person to settle. Empty if nothing."),
});
export type SetupProposal = z.infer<typeof setupDesignSchema>;

/** The app's frequency for what the documents say. Quarterly only when they say nothing; measured at points in time otherwise. */
export function appFrequency(f: DocFrequency | undefined): IndicatorInput["frequency"] {
  if (f === "monthly" || f === "quarterly") return f;
  if (!f || f === "not_stated") return "quarterly";
  return "end_of_season";
}

const FREQUENCY_WORDS: Record<DocFrequency, string> = { monthly: "monthly", quarterly: "quarterly", semiannual: "every six months", annual: "yearly", end_of_season: "end of season", baseline_endline: "at baseline and endline", once: "once", not_stated: "" };
/** The documents' frequency in words, kept when the app's three cannot say it exactly. */
export const frequencyWords = (f: DocFrequency) => FREQUENCY_WORDS[f];

/**
 * The measure (lib/measure) the documents point to. Stated as a change against a baseline:
 * "change". A rate, share or average measured by a survey: "latest". Anything else: undefined,
 * so the target keeps its default.
 */
export function measureFromDocuments(i: { statedAs: DesignIndicator["statedAs"]; surveyed: boolean; verification?: string }): Measure | undefined {
  if (i.statedAs === "change_from_baseline") return "change";
  if (i.statedAs === "rate_share_or_average" && (i.surveyed || /survey/i.test(i.verification ?? ""))) return "latest";
  return undefined;
}

/** Per calendar year targets as the running totals the app keeps (expected total by 31 December). */
export function runningTotals(years: { year: number; target: number }[]) {
  let t = 0;
  return Object.fromEntries([...years].sort((a, b) => a.year - b.year).map((y) => [String(y.year), (t += y.target)]));
}

const two = (n: number) => Math.round(n * 100) / 100;
const label = (i: { donorCode: string; name: string }) => i.donorCode || i.name.slice(0, 60);

/**
 * The documents' indicators as setup's draft. Every named indicator is kept: one with no number
 * target is kept with 0 ("no target yet") and a note; more than MAX_INDICATORS are all kept with
 * a warning, so the person chooses which to remove. Notes go with the documents' questions.
 */
export function indicatorsFromDocuments(list: DesignIndicator[]): { indicators: IndicatorInput[]; notes: string[] } {
  const named = list.filter((i) => i.name.trim());
  const notes: string[] = [];
  if (named.length > MAX_INDICATORS) notes.push(`The documents list ${named.length} indicators; a project keeps at most ${MAX_INDICATORS}. All are shown: remove the ones the project does not report on before saving.`);
  const noFrequency: string[] = [];
  const indicators = named.map((i): IndicatorInput => {
    const hasTarget = i.target !== null && Number.isFinite(i.target) && i.target > 0;
    if (!hasTarget) notes.push(`${label(i)}: the documents give no number target. It is kept with none (0); enter the target when it is set, for example after the baseline survey.`);
    if (i.frequency === "not_stated") noFrequency.push(label(i));
    const measure = measureFromDocuments(i);
    const breakdowns = [...new Set(i.breakdowns)];
    const years = i.yearTargets.filter((y) => Number.isFinite(y.year) && Number.isFinite(y.target));
    return {
      ...(i.donorCode.trim() ? { donorCode: i.donorCode.trim().slice(0, 30) } : {}),
      name: i.name.trim().slice(0, 200),
      unit: (i.unit.trim() || "count").slice(0, 50),
      target: hasTarget ? i.target! : 0,
      level: i.level,
      frequency: appFrequency(i.frequency),
      ...(years.length ? { forecast: runningTotals(years) } : {}),
      baseline: i.baseline !== null && Number.isFinite(i.baseline) ? two(i.baseline) : null,
      baselineYear: i.baselineYear !== null && Number.isInteger(i.baselineYear) && i.baselineYear >= 1900 && i.baselineYear <= 2100 ? i.baselineYear : null,
      disaggregation: breakdowns,
      verification: i.verification.trim().slice(0, 500),
      result: i.result.trim().slice(0, 1000),
      ...(appFrequency(i.frequency) !== i.frequency && i.frequency !== "not_stated" ? { frequencyAsWritten: frequencyWords(i.frequency) } : {}),
      ...(i.source.trim() ? { docSource: i.source.trim().slice(0, 300) } : {}),
      ...(measure ? { measure } : {}),
    };
  });
  if (noFrequency.length) notes.push(`The documents give no reporting frequency for ${noFrequency.join(", ")}: set to quarterly. Change it if the agreement says otherwise.`);
  return { indicators, notes };
}

/** The framework key (lib/framework) a result statement belongs to: the goal, its outcome ("1") or its output ("1.2"). */
export function resultKey(i: { donorCode?: string; level: IndicatorInput["level"] }): string | null {
  if (i.level === "goal") return "goal";
  const chain = ancestors(i.donorCode ?? "");
  return (i.level === "outcome" ? chain[0] : chain[1]) ?? null;
}

/**
 * The framework with the documents' result statements added where it has none: wording a person
 * already gave is never replaced. Null when nothing changes.
 */
export function frameworkFromIndicators(fw: Framework, list: Pick<IndicatorInput, "donorCode" | "level" | "result" | "docSource">[], at: string): Framework | null {
  let next = fw;
  for (const i of list) {
    const text = (i.result ?? "").trim();
    const key = resultKey(i);
    if (text.length < 5 || !key) continue;
    const st: Statement = { text, source: i.docSource?.trim() || "Project documents, read at setup", by: "setup", byName: "Project setup", at };
    if (key === "goal") {
      if (!next.goal) next = { ...next, goal: st };
    } else if (!next.nodes[key]) next = { ...next, nodes: { ...next.nodes, [key]: st } };
  }
  return next === fw ? null : next;
}

/** project_state key: what the documents say about an indicator that has no column of its own, by indicator code. */
export const INDICATOR_DOCS_KEY = "indicator_documents";
export type IndicatorDocs = Record<string, { baselineYear?: number | null; frequencyAsWritten?: string | null; source?: string | null }>;
