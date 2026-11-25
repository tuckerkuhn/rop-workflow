import { totalsOf, type ResultRecord } from "@/lib/results";

/**
 * How a target's accepted results become the figure reported for it. Counts (farmers trained,
 * hectares) add up: "sum", what every target did before. An outcome measured by a survey does
 * not: a share or an average is the latest survey's figure ("latest"); a change in income is
 * the latest survey against the baseline ("change"). Saved per project in project_state under
 * MEASURES_KEY as { [indicator code]: measure }; a target with none saved uses defaultMeasure.
 * The rules here have no database in them.
 */

export const MEASURES = ["sum", "latest", "change"] as const;
export type Measure = (typeof MEASURES)[number];
export const MEASURES_KEY = "measures";
export type MeasuresDoc = Record<string, Measure>;

/** Indicator sources whose figures come from recorded results: "survey" ones are recorded the same way, with the survey file as proof. */
export const RESULT_SOURCES = ["results", "survey"];

/** Short plain explanations for Target details. */
export const MEASURE_TEXT: Record<Measure, { label: string; help: string }> = {
  sum: { label: "Add up results", help: "Each accepted result adds to the total. For counts: farmers trained, hectares, visits." },
  latest: { label: "Latest survey", help: "The most recent accepted result is the figure. For a share or an average from a survey, e.g. 60% of farmers using a practice." },
  change: { label: "Change from baseline", help: "The most recent accepted result against the baseline. A percent target shows the percent change; any other unit shows the difference." },
};

export const isMeasure = (m: unknown): m is Measure => (MEASURES as readonly unknown[]).includes(m);
export const isPercentUnit = (unit: string) => /%|percent/i.test(unit);

/**
 * The measure when none is saved. Every target counted from records adds up, as before. A target
 * whose source is a survey takes its survey's figure: against the baseline when its unit says so
 * (e.g. "% vs baseline"), else the latest figure as it is.
 */
export function defaultMeasure(i: { source?: string | null; unit: string }): Measure {
  if (i.source !== "survey") return "sum";
  return /baseline|change/i.test(i.unit) ? "change" : "latest";
}

/** The saved measure for a target, or its default. */
export const measureOf = (doc: Record<string, unknown> | null | undefined, i: { code: string; source?: string | null; unit: string }): Measure => {
  const m = doc?.[i.code];
  return isMeasure(m) ? m : defaultMeasure(i);
};

export type MeasureState = "ok" | "baseline_needed" | "no_survey";
/** What is shown in place of a figure that cannot be given. */
export const MEASURE_NOTE: Record<Exclude<MeasureState, "ok">, string> = { baseline_needed: "Baseline needed", no_survey: "No survey yet" };

export type Measured = ReturnType<typeof totalsOf> & {
  measure: Measure;
  /** The figure to report; null when it cannot be given (see state). `value` is the same figure, or 0. */
  reported: number | null;
  state: MeasureState;
  /** "Baseline needed" or "No survey yet"; null when there is a figure. */
  note: string | null;
  /** The date of the result the figure comes from ("latest" and "change"); the last one counted for "sum". */
  date: string | null;
};

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * The figure to report for one target from its accepted results dated between `from` and `to`
 * (either may be left open). "sum": the total, as totalsOf. "latest": the most recent accepted
 * result. "change": that result against the baseline, in percent when the unit is a percent
 * (a baseline of 0 cannot give one), else the difference. Breakdowns (women, men, provinces,
 * records, files) are the counted results': for "latest" and "change", the one result used.
 */
export function measured(ind: { baseline: number | null; unit: string }, list: ResultRecord[], measure: Measure = "sum", from?: string, to?: string): Measured {
  if (measure === "sum") {
    const t = totalsOf(list, from, to);
    const date = list.filter((r) => r.status === "accepted" && (!from || r.date >= from) && (!to || r.date <= to)).reduce<string | null>((d, r) => (!d || r.date > d ? r.date : d), null);
    return { ...t, measure, reported: t.value, state: "ok", note: null, date };
  }
  const counted = list.filter((r) => r.status === "accepted" && (!from || r.date >= from) && (!to || r.date <= to));
  // The latest by its date; two on the same day, the one recorded last.
  const last = counted.reduce<ResultRecord | null>((a, r) => (!a || r.date > a.date || (r.date === a.date && r.at > a.at) ? r : a), null);
  const one = totalsOf(last ? [last] : []);
  const blank = (state: Exclude<MeasureState, "ok">): Measured => ({ ...one, value: 0, measure, reported: null, state, note: MEASURE_NOTE[state], date: last?.date ?? null });
  const percent = isPercentUnit(ind.unit);
  if (measure === "change" && (ind.baseline === null || (percent && ind.baseline === 0))) return blank("baseline_needed");
  if (!last) return blank("no_survey");
  const b = ind.baseline ?? 0;
  const value = measure === "latest" ? last.value : percent ? round(((last.value - b) / Math.abs(b)) * 100, 1) : round(last.value - b, 2);
  return { ...one, value, measure, reported: value, state: "ok", note: null, date: last.date };
}

/** Just the figure: null when it cannot be given. */
export const measureValue = (ind: { baseline: number | null; unit: string }, list: ResultRecord[], measure: Measure = "sum", from?: string, to?: string) => measured(ind, list, measure, from, to).reported;

/**
 * This year's part of the target. A target that adds up stores its year targets as running
 * totals (expected by 31 December), so the year's part is this year's less last year's. A
 * survey figure is not a running total: the year's target is the figure expected by year end.
 */
export function yearPart(i: { target: number; yearTargets: Record<string, number>; measure?: Measure }, y: number) {
  const byEnd = i.yearTargets[String(y)] ?? i.target;
  if (i.measure && i.measure !== "sum") return byEnd;
  const before = i.yearTargets[String(y - 1)] ?? 0;
  return Math.max(0, byEnd - before);
}
