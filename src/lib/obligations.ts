import { z } from "zod";
import { FREQUENCIES, type Frequency, type Obligation } from "@/lib/agreement";

/**
 * A donor's reporting obligations, as confirmed from the agreement in setup and kept in the
 * project_state document "obligations": which report, how often, the months its periods end in,
 * the days allowed after each period and the format the donor asks for. They give the donor's
 * report periods and deadlines, so a project whose agreement runs October to September reports on
 * its own quarters and years. With none saved, periods stay calendar quarters and deadlines come
 * from the project's rules, as before.
 */

export const REPORT_KINDS = ["quarterly", "semiannual", "annual", "monthly", "final", "financial", "other"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const obligationInputSchema = z.object({
  /** The donor the report goes to. Null only when the project has no donor yet. */
  donorId: z.uuid().nullable(),
  report: z.enum(REPORT_KINDS),
  /** The report as the agreement names it, e.g. "Quarterly progress report". */
  name: z.string().trim().min(2).max(160),
  frequency: z.enum(FREQUENCIES),
  /** The months (1 to 12) a period ends in, on the month's last day. Empty for a final or one-off report. */
  periodEnds: z.array(z.number().int().min(1).max(12)).max(12),
  /** Days after a period ends that the report is due. Null when the agreement names dates instead. */
  daysAfter: z.number().int().min(0).max(365).nullable(),
  dueDates: z.array(isoDay).max(40),
  /** The template or format the donor asks for, as the agreement names it. Empty when it names none. */
  format: z.string().max(300),
  /** A link to the template, when there is one. */
  formatFile: z
    .string()
    .max(500)
    .regex(/^https?:\/\/\S+$/, "The template link must start with http:// or https://.")
    .nullable(),
  source: z.string().max(200),
});
export type ObligationInput = z.infer<typeof obligationInputSchema>;
/** As kept in project_state, with who confirmed it and when. */
export type SavedObligation = ObligationInput & { by: string; at: string };
export const savedObligationSchema = obligationInputSchema.extend({ by: z.string(), at: z.string() });

/** The parts that work out periods and deadlines. */
export type Schedule = Pick<ObligationInput, "frequency" | "periodEnds" | "daysAfter" | "dueDates">;
export type ObligationPeriod = { from: string; to: string; due: string | null };

const STEP: Record<Frequency, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12, final: 0, once: 0 };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => iso(new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5));
const monthEnd = (y: number, m: number) => iso(new Date(Date.UTC(y, m, 0)));
export const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);

/** What kind of report an obligation is: a financial or final report by its name, else by how often it comes. */
export function reportKind(o: Pick<Obligation, "report" | "frequency">): ReportKind {
  if (/financ/i.test(o.report)) return "financial";
  if (o.frequency === "final" || /\bfinal\b/i.test(o.report)) return "final";
  return o.frequency === "once" ? "other" : o.frequency;
}

/**
 * The months a frequency's periods end in: calendar periods (startMonth null), or periods counted
 * from the month the agreement starts. Quarters from October end in December, March, June and September.
 */
export function periodEndMonths(f: Frequency, startMonth: number | null): number[] {
  const step = STEP[f];
  if (!step) return [];
  const before = startMonth ? startMonth - 1 : 0;
  const out = new Set<number>();
  for (let k = 1; k <= 12 / step; k++) out.add(((before + k * step - 1) % 12) + 1);
  return [...out].sort((a, b) => a - b);
}

/** True when the agreement's own periods are the calendar's (a quarter from October is a calendar quarter). */
export const sameAsCalendar = (f: Frequency, startMonth: number | null) => periodEndMonths(f, startMonth).join() === periodEndMonths(f, null).join();

/** The day a report on a period ending `to` is due: days after the period, else the first date the agreement names from then on. */
export function dueFor(o: Schedule, to: string): string | null {
  if (o.daysAfter !== null) return addDays(to, o.daysAfter);
  return [...o.dueDates].sort().find((d) => d >= to) ?? null;
}

/**
 * Every period of an obligation within the project's dates, oldest first: the first starts on the
 * project's start and the last ends on its end. Without project dates, the years around `around`.
 * A final or one-off report has one period, the whole project.
 */
export function obligationPeriods(o: Schedule, start: string | null, end: string | null, around: string): ObligationPeriod[] {
  const y = Number(around.slice(0, 4));
  const lo = start ?? `${y - 2}-01-01`;
  const hi = end ?? `${y + 2}-12-31`;
  if (!STEP[o.frequency] || !o.periodEnds.length) return start && end ? [{ from: start, to: end, due: dueFor(o, end) }] : [];
  const months = [...new Set(o.periodEnds)].sort((a, b) => a - b);
  const ends: string[] = [];
  for (let yr = Number(lo.slice(0, 4)) - 1; yr <= Number(hi.slice(0, 4)) + 1; yr++) for (const m of months) ends.push(monthEnd(yr, m));
  const out: ObligationPeriod[] = [];
  for (let k = 1; k < ends.length; k++) {
    const from = addDays(ends[k - 1], 1);
    if (ends[k] < lo || from > hi) continue;
    const to = ends[k] < hi ? ends[k] : hi;
    out.push({ from: from > lo ? from : lo, to, due: dueFor(o, to) });
  }
  return out;
}

/** The period that holds a date, or null outside the project's dates. */
export const periodHolding = (o: Schedule, day: string, start: string | null, end: string | null) => obligationPeriods(o, start, end, day).find((p) => p.from <= day && p.to >= day) ?? null;

/** The period of the report due next: the first whose deadline is today or later (with no deadline, the one under way). */
export const nextPeriod = (o: Schedule, today: string, start: string | null, end: string | null) => obligationPeriods(o, start, end, today).find((p) => (p.due ? p.due >= today : p.to >= today)) ?? null;

const RANK: Frequency[] = ["quarterly", "semiannual", "monthly", "annual"];

/** A donor's main periodic report (the one its report periods follow): a narrative report before a financial one, the most frequent first after quarterly. */
export function mainObligation<T extends Pick<ObligationInput, "frequency" | "report">>(list: T[]): T | null {
  const periodic = list.filter((o) => RANK.includes(o.frequency));
  const narrative = periodic.filter((o) => o.report !== "financial");
  const pool = narrative.length ? narrative : periodic;
  return [...pool].sort((a, b) => RANK.indexOf(a.frequency) - RANK.indexOf(b.frequency))[0] ?? null;
}

/** The dated deadlines an obligation gives over the project's life: the dates the agreement names, else each period's end plus the days allowed. */
export function proposedDeadlines(o: ObligationInput, start: string, end: string): { title: string; date: string; source: string }[] {
  if (o.dueDates.length) return o.dueDates.map((d) => ({ title: o.name, date: d, source: o.source }));
  if (o.daysAfter === null) return [];
  return obligationPeriods(o, start, end, start).map((p) => ({ title: `${o.name} (period to ${p.to})`, date: p.due!, source: o.source }));
}

/** The format as the agreement words it, with a link in it taken out as the template's file. */
export function splitFormat(text: string): { format: string; formatFile: string | null } {
  const url = text.match(/https?:\/\/[^\s<>"')]+/i)?.[0] ?? null;
  const format = (url ? text.replace(url, "") : text).replace(/\(\s*\)/g, "").replace(/[\s:(-]+$/, "").replace(/\s{2,}/g, " ").trim();
  return { format: format.slice(0, 300), formatFile: url && url.length <= 500 ? url : null };
}

/** The line shown next to a report: the format the donor asks for, with the template's link. Null when the agreement names none. */
export function formatAskedFor(o: Pick<ObligationInput, "format" | "formatFile">): { text: string; href: string | null } | null {
  const name = o.format.trim();
  if (!name && !o.formatFile) return null;
  return { text: `Format asked for: ${name || "the donor's template"}`, href: o.formatFile };
}

/** Newly confirmed obligations take the place of the same donor's same report; the rest stay. */
export function mergeObligations(kept: SavedObligation[], added: SavedObligation[]): SavedObligation[] {
  const key = (o: SavedObligation) => `${o.donorId ?? ""}|${o.name.toLowerCase()}|${o.frequency}`;
  const fresh = new Set(added.map(key));
  return [...kept.filter((o) => !fresh.has(key(o))), ...added];
}

/** What donors and pages see: no one's name or the time of confirming. */
export const publicObligation = (o: SavedObligation): ObligationInput => obligationInputSchema.parse(o);
