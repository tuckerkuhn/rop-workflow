import { daysBetween, preflightHref, type Deadline } from "@/lib/preflight";
import { prevQuarterOf } from "@/lib/qpr";
import { quarterOf, quarterRange } from "@/lib/results";

/**
 * The report calendar: every donor report the project owes around now, with its date, on one list.
 * A first-time grantee misses reports because the dates sit in the agreement, not in front of the
 * team. Dates come from the same rule as the report check (a "Report deadline" milestone, else the
 * donor's days-after-period rule in the project's rules).
 */

export type CalendarState = "released" | "late" | "soon" | "later" | "passed";
export type CalendarRow = {
  kind: "qpr" | "annual";
  period: string;
  /** Last day of the period the report covers. */
  end: string;
  due: string | null;
  aim: string | null;
  source: Deadline["source"];
  released: boolean;
  state: CalendarState;
  href: string;
};

const nextQuarter = (q: string) => {
  const [y, n] = [Number(q.slice(0, 4)), Number(q.slice(6))];
  return n === 4 ? `${y + 1}-Q1` : `${y}-Q${n + 1}`;
};

/**
 * The periods to list: the last two quarters (their reports may still be owed), the quarter under
 * way and the two after it, kept inside the project's dates; and the annual reports for last year
 * and this year, for the years the project runs in.
 */
export function calendarPeriods(start: string | null, end: string | null, today: string): { quarters: string[]; years: number[] } {
  const now = quarterOf(today);
  let q = prevQuarterOf(prevQuarterOf(now));
  const quarters: string[] = [];
  for (let k = 0; k < 5; k++, q = nextQuarter(q)) {
    const r = quarterRange(q);
    if (start && r.to < start) continue;
    if (end && r.from > end) continue;
    quarters.push(q);
  }
  const y = Number(today.slice(0, 4));
  const years = [y - 1, y].filter((x) => (!start || Number(start.slice(0, 4)) <= x) && (!end || Number(end.slice(0, 4)) >= x));
  return { quarters, years };
}

/**
 * Where a report stands today. Only a quarterly report is released in the app, so only it can be
 * "late"; an annual report whose date has gone is "passed" (the app cannot know it was sent).
 */
export function calendarState(kind: "qpr" | "annual", due: string | null, aim: string | null, released: boolean, today: string): CalendarState {
  if (released) return "released";
  if (!due) return "later";
  if (today > due) return kind === "qpr" ? "late" : "passed";
  const from = aim ?? due;
  return daysBetween(today, from) <= 21 ? "soon" : "later";
}

export function calendarRow(kind: "qpr" | "annual", period: string, end: string, d: Deadline, released: boolean, today: string): CalendarRow {
  return {
    kind,
    period,
    end,
    due: d.due,
    aim: d.aim,
    source: d.source,
    released,
    state: calendarState(kind, d.due, d.aim, released, today),
    href: kind === "qpr" ? preflightHref({ kind: "qpr", quarter: period }) : preflightHref({ kind: "annual", year: Number(period) }),
  };
}

/** Soonest first among what is still owed; released reports after, newest first. */
export function sortCalendar(rows: CalendarRow[]): CalendarRow[] {
  const open = rows.filter((r) => !r.released).sort((a, b) => (a.due ?? a.end).localeCompare(b.due ?? b.end));
  const done = rows.filter((r) => r.released).sort((a, b) => b.end.localeCompare(a.end));
  return [...open, ...done];
}

/**
 * The FACE form is the UN agencies' funding request (HACT). Other donors do not use it. Agency
 * initials count only in capitals ("WHO", not "who"), in English, Spanish and French.
 */
const UN_INITIALS = /(^|[^A-Za-z])(UN|U\.N\.|ONU|UNDP|PNUD|UNICEF|UNFPA|UNOPS|UNHCR|ACNUR|WFP|PMA|FAO|IFAD|FIDA|ILO|OIT|IOM|OIM|WHO|OMS|UNESCO|UNIDO|UNEP|OCHA|UN-Habitat|UN Women|ONU Mujeres)(?![A-Za-z])/;
const UN_WORDS = /united nations|naciones unidas|nations unies/i;
export const usesFace = (donorNames: string[]) => donorNames.some((n) => UN_INITIALS.test(n) || UN_WORDS.test(n));
