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
  dataSource: "kobo" | "records" | "survey" | "none";
  /** Date of the latest record counted. */
  lastDate: string | null;
};

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
