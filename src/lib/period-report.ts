import { yearShare, type IndicatorInfo } from "@/lib/qpr";
import { totalsOf, type ResultRecord } from "@/lib/results";

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
  verdict: "met" | "partly" | "not_met" | "no_target";
};

export const periodLabel = (p: Period) => (p.kind === "annual" ? `Annual report ${p.year}` : "Final report");
export const periodRange = (p: Period, start: string | null, end: string | null) =>
  p.kind === "annual" ? { from: `${p.year}-01-01`, to: `${p.year}-12-31` } : { from: start ?? "2000-01-01", to: end ?? new Date().toISOString().slice(0, 10) };

export function buildPeriodRows(indicators: PeriodIndicator[], results: ResultRecord[], p: Period, start: string | null, end: string | null): PeriodRow[] {
  const { from, to } = periodRange(p, start, end);
  const firstYear = Number((start ?? from).slice(0, 4));
  const lastYear = Number(to.slice(0, 4));
  return indicators.map((i) => {
    const mine = results.filter((r) => r.indicator === i.code);
    const t = totalsOf(mine, from, to);
    const cum = totalsOf(mine, undefined, to);
    const parts =
      p.kind === "annual"
        ? [1, 2, 3, 4].map((q) => ({ label: `Q${q}`, value: totalsOf(mine, `${p.year}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`, `${p.year}-${String(q * 3).padStart(2, "0")}-${q === 1 || q === 4 ? "31" : "30"}`).value }))
        : Array.from({ length: Math.max(0, lastYear - firstYear + 1) }, (_, k) => firstYear + k).map((y) => ({ label: String(y), value: totalsOf(mine, `${y}-01-01`, `${y}-12-31`).value }));
    const target = p.kind === "annual" ? yearShare(i, p.year) : i.target;
    const achieved = p.kind === "annual" ? t.value : cum.value;
    const pct = target > 0 ? Math.round((achieved / target) * 100) : null;
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
      verdict: target <= 0 ? "no_target" : achieved >= target ? "met" : achieved > 0 ? "partly" : "not_met",
    };
  });
}
