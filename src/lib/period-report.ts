import { yearShare, type IndicatorInfo } from "@/lib/qpr";
import { quarterRange, type ResultRecord } from "@/lib/results";
import { measured } from "@/lib/measure";

/**
 * The annual and final reports' indicator table, from accepted results only, as the quarterly
 * report is. Annual: the year's target and what each quarter delivered, against the
 * life-of-project target. Final: everything from the start, against the total target and the
 * baseline, year by year.
 */

export type Period = { kind: "annual"; year: number } | { kind: "final" };
export type PeriodIndicator = IndicatorInfo & { baseline: number | null };

export type PeriodRow = {
  code: string;
  donorCode: string;
  name: string;
  unit: string;
  output: string;
  baseline: number | null;
  /** Annual: the year's target. Final: the total target. */
  target: number;
  /** Achieved in the period. */
  achieved: number;
  /** Achieved since the start, to the period's end. */
  cumulative: number;
  lifeTarget: number;
  /** Annual: Q1–Q4. Final: by calendar year. */
  parts: { label: string; value: number }[];
  women: number;
  men: number;
  youth: number;
  womenLed: number;
  menLed: number;
  records: number;
  files: number;
  /** Achieved as a share of the target, in percent; null without a target. */
  pct: number | null;
  verdict: "met" | "partly" | "not_met" | "no_target" | "not_measured";
  /** Only for a target measured by a survey (lib/measure): how it is measured plus what to show instead of a figure that cannot be given. */
  measure?: "latest" | "change";
  note?: { achieved: string | null; cumulative: string | null };
};

export const periodLabel = (p: Period) => (p.kind === "annual" ? `Annual report ${p.year}` : "Final report");
export const periodRange = (p: Period, start: string | null, end: string | null) =>
  p.kind === "annual" ? { from: `${p.year}-01-01`, to: `${p.year}-12-31` } : { from: start ?? "2000-01-01", to: end ?? new Date().toISOString().slice(0, 10) };

/**
 * The quarters of a year whose quarterly report must be released before the annual report is:
 * those that have ended and fall within the project's own dates. A quarter that ended before the
 * project began, or began after it ended, has no quarterly report and holds nothing back. A
 * project with no dates recorded is held to every quarter of the year that has ended.
 */
export function quartersDue(year: number, start: string | null, end: string | null, today: string): string[] {
  return [1, 2, 3, 4].map((k) => `${year}-Q${k}`).filter((q) => quarterRange(q).to < today && ranIn(q, start, end));
}

/** Whether the project ran in a quarter: the quarter overlaps its dates. The one rule for every list of quarters. */
export function ranIn(quarter: string, start: string | null, end: string | null): boolean {
  const r = quarterRange(quarter);
  return (!start || r.to >= start.slice(0, 10)) && (!end || r.from <= end.slice(0, 10));
}

export function buildPeriodRows(indicators: PeriodIndicator[], results: ResultRecord[], p: Period, start: string | null, end: string | null): PeriodRow[] {
  const { from, to } = periodRange(p, start, end);
  const firstYear = Number((start ?? from).slice(0, 4));
  const lastYear = Number(to.slice(0, 4));
  return indicators.map((i) => {
    const mine = results.filter((r) => r.indicator === i.code);
    // The same figure as Progress and the quarterly report (lib/measure): a sum unless measured by a survey, then against the baseline where asked.
    const of = (a?: string, b?: string) => measured({ baseline: i.baseline, unit: i.unit }, mine, i.measure, a, b);
    const t = of(from, to);
    const cum = of(undefined, to);
    const parts =
      p.kind === "annual"
        ? [1, 2, 3, 4].map((q) => ({ label: `Q${q}`, value: of(`${p.year}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`, `${p.year}-${String(q * 3).padStart(2, "0")}-${q === 1 || q === 4 ? "31" : "30"}`).value }))
        : Array.from({ length: Math.max(0, lastYear - firstYear + 1) }, (_, k) => firstYear + k).map((y) => ({ label: String(y), value: of(`${y}-01-01`, `${y}-12-31`).value }));
    const target = p.kind === "annual" ? yearShare(i, p.year) : i.target;
    const achieved = p.kind === "annual" ? t.value : cum.value;
    const shown = p.kind === "annual" ? t : cum;
    const pct = target > 0 && shown.reported !== null ? Math.round((achieved / target) * 100) : null;
    return {
      code: i.code,
      donorCode: i.donorCode ?? i.code,
      name: i.name,
      unit: i.unit,
      output: i.result ?? "",
      baseline: i.baseline,
      target,
      achieved,
      cumulative: cum.value,
      lifeTarget: i.target,
      parts,
      women: p.kind === "annual" ? t.female : cum.female,
      men: p.kind === "annual" ? t.male : cum.male,
      youth: p.kind === "annual" ? t.youth : cum.youth,
      womenLed: p.kind === "annual" ? t.womenLed : cum.womenLed,
      menLed: p.kind === "annual" ? t.menLed : cum.menLed,
      records: p.kind === "annual" ? t.records : cum.records,
      files: p.kind === "annual" ? t.files : cum.files,
      pct,
      // A survey figure that cannot be given yet (no survey, no baseline) is not "not met": it is not measured yet.
      verdict: target <= 0 ? "no_target" : shown.reported === null ? "not_measured" : achieved >= target ? "met" : achieved > 0 ? "partly" : "not_met",
      ...(i.measure && i.measure !== "sum" ? { measure: i.measure, note: { achieved: shown.note, cumulative: cum.note } } : {}),
    };
  });
}

/**
 * A released annual or final report is kept as a frozen copy in project_state "period-copies",
 * under "year:2026" or "final". In addresses it is "annual-2026" or "final".
 */
export const PERIOD_COPIES = "period-copies";
export const periodKey = (p: Period) => (p.kind === "annual" ? `year:${p.year}` : "final");
export const periodSlug = (p: Period) => (p.kind === "annual" ? `annual-${p.year}` : "final");
export function periodOfKey(key: string): Period | null {
  if (key === "final") return { kind: "final" };
  const m = /^year:(\d{4})$/.exec(key);
  return m ? { kind: "annual", year: Number(m[1]) } : null;
}
export function periodOfSlug(slug: string): Period | null {
  if (slug === "final") return { kind: "final" };
  const m = /^annual-(\d{4})$/.exec(slug);
  return m ? { kind: "annual", year: Number(m[1]) } : null;
}
