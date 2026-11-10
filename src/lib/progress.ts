import { z } from "zod";
import { addDays } from "@/lib/work-items";

/**
 * Indicators, their values and the project's donors, as the Progress API returns them.
 * Values are worked out on the server from accepted records, so donors see numbers, never records.
 */

export type Level = "goal" | "outcome" | "output";
export type Frequency = "monthly" | "quarterly" | "end_of_season";

export type IndicatorProgress = {
  code: string;
  /** The donor's own code for it, as entered in setup (indicators.donor_code). */
  donorCode: string | null;
  name: string;
  unit: string;
  target: number;
  level: Level;
  result: string | null;
  source: string;
  frequency: Frequency;
  theme: string | null;
  /** Everything to date. null when the value comes from a survey not yet entered. */
  total: number | null;
  /** New in the current reporting period (see `periodOf`). */
  period: number | null;
  /** Records waiting for MEL review, not counted yet. */
  pending: number;
  /** Only where the records say; null for counts from mapped KoboToolbox questions. */
  byGender: { Female: number; Male: number } | null;
  /** Where the value comes from: a mapped KoboToolbox question, the built-in forms, a survey, or nothing yet. */
  dataSource: "kobo" | "records" | "results" | "survey" | "none";
  /** Date of the latest record counted. */
  lastDate: string | null;
  /** Each calendar year of the project: the forecast total by 31 December and the actual total by then (to date for this year; null for later years). */
  forecast: ForecastYear[];
  /** Against this year's forecast, as of today. null when the indicator has no forecast for this year. */
  track: Track | null;
};

export type ForecastYear = { year: number; forecast: number | null; actual: number | null };

export type TrackStatus = "on_track" | "slightly_behind" | "behind" | "not_measured";
export type Track = { year: number; forecast: number; expected: number; actual: number | null; status: TrackStatus };

/** Calendar years the project runs in, start to end. */
export function projectYears(start: string | null, end: string | null): number[] {
  if (!start || !end) return [];
  const from = Number(start.slice(0, 4));
  const to = Number(end.slice(0, 4));
  return to >= from && to - from < 30 ? Array.from({ length: to - from + 1 }, (_, k) => from + k) : [];
}

/**
 * The forecast as stored on the indicator: expected totals by year end, with the last project year
 * always equal to the indicator's target, so the forecast and the target can never disagree.
 */
export function forecastFor(forecast: Record<string, number> | null | undefined, target: number, years: number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const y of years) {
    const v = forecast?.[String(y)];
    if (typeof v === "number" && Number.isFinite(v)) out.set(y, v);
  }
  if (years.length) out.set(years.at(-1)!, target);
  return out;
}

const dayOf = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/**
 * Where an indicator should be today, and whether it is there. The expected total rises steadily
 * through the year, from last year's forecast (zero before the first year) to this year's, starting
 * on the project start date in its first year. Values measured once (end of season) are compared
 * with the year's forecast only once measured. Within 10% of expected is on track; within 25%,
 * slightly behind.
 */
export function trackFor(opts: { forecast: Map<number, number>; actual: number | null; today: string; start: string; once: boolean }): Track | null {
  const year = Number(opts.today.slice(0, 4));
  const goal = opts.forecast.get(year);
  if (goal === undefined) return null;
  if (opts.once) {
    if (opts.actual === null) return { year, forecast: goal, expected: goal, actual: null, status: "not_measured" };
    return { year, forecast: goal, expected: goal, actual: opts.actual, status: statusOf(opts.actual, goal) };
  }
  const prior = opts.forecast.get(year - 1) ?? 0;
  const from = Math.max(dayOf(`${year}-01-01`), dayOf(opts.start));
  const to = dayOf(`${year}-12-31`);
  const share = to > from ? Math.min(1, Math.max(0, (dayOf(opts.today) - from) / (to - from))) : 1;
  const expected = Math.round((prior + (goal - prior) * share) * 10) / 10;
  const actual = opts.actual ?? 0;
  return { year, forecast: goal, expected, actual, status: statusOf(actual, expected) };
}

const statusOf = (actual: number, expected: number): TrackStatus => (expected <= 0 || actual >= expected * 0.9 ? "on_track" : actual >= expected * 0.75 ? "slightly_behind" : "behind");

export type Deadline = { id: string; title: string; date: string };

export type DonorInfo = {
  id: string;
  name: string;
  reportFormat: string;
  indicatorRefs: Record<string, string>;
  deadlines: Deadline[];
};

/** Values for one report: the period it covers (see `reportPeriod`) and each indicator's count in it. */
export type ReportValues = { donorId: string | null; from: string; to: string; values: Record<string, number | null> };

export type ProgressData = {
  /** False for demo projects kept only in this browser. */
  saved: boolean;
  project: { code: string; name: string; startDate: string | null; endDate: string | null };
  today: string;
  indicators: IndicatorProgress[];
  donors: DonorInfo[];
  /** One per donor, plus donorId null for the all-donors report. */
  reports: ReportValues[];
};

/** Impact is what the project changes for people (goal and outcome); outputs are what it delivers. */
export const isImpact = (i: { level: Level }) => i.level !== "output";

export type Period = { from: string; to: string };

/** The reporting period an indicator should have new data in, or null when nothing is due yet. */
export function periodOf(frequency: Frequency, today: string): Period | null {
  const [y, m] = today.split("-").map(Number);
  if (frequency === "monthly") return { from: `${today.slice(0, 7)}-01`, to: addDays(`${new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)}-01`, -1) };
  if (frequency === "quarterly") {
    const q = Math.floor((m - 1) / 3) * 3;
    return { from: new Date(Date.UTC(y, q, 1)).toISOString().slice(0, 10), to: addDays(new Date(Date.UTC(y, q + 3, 1)).toISOString().slice(0, 10), -1) };
  }
  // End-of-season values come from the season's final survey.
  return null;
}

/** True when the indicator is due for data this period and has none yet. */
export const missingData = (i: IndicatorProgress) => i.frequency !== "end_of_season" && !i.period;

/** Sources the built-in forms count from; any other source needs a KoboToolbox mapping. */
export const BUILT_IN_SOURCES = ["training", "readiness", "distribution", "visit", "survey"];

/**
 * The period a donor report covers: from the day after the donor's last deadline (or the
 * project start) to its next deadline. Without deadlines, the current month.
 */
export function reportPeriod(donor: DonorInfo | null, today: string, projectStart: string | null): Period & { deadline: Deadline | null } {
  const dates = [...(donor?.deadlines ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const next = dates.find((d) => d.date >= today) ?? null;
  const last = [...dates].reverse().find((d) => d.date < today);
  if (!next && !last) return { ...periodOf("monthly", today)!, deadline: null };
  const from = last ? addDays(last.date, 1) : (projectStart ?? `${today.slice(0, 7)}-01`);
  return { from, to: next?.date ?? today, deadline: next };
}

/* ---------- donor settings ---------- */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const donorInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  reportFormat: z.string().min(1),
  indicatorRefs: z.record(z.string(), z.string().trim().max(200)),
  /** Existing deadlines keep their id; new ones have none. Deadlines left out are removed. */
  deadlines: z.array(z.object({ id: z.uuid().optional(), title: z.string().trim().min(1).max(200), date: isoDate })).max(60),
});
export type DonorInput = z.infer<typeof donorInputSchema>;
