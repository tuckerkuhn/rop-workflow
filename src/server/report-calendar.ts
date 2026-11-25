import { formatAskedFor, obligationPeriods } from "@/lib/obligations";
import { aroundNow, calendarPeriods, calendarRow, sortCalendar, type CalendarRow } from "@/lib/report-calendar";
import { quarterOf, quarterRange } from "@/lib/results";
import { projectByCode } from "@/server/field-store";
import { projectDonors } from "@/server/obligations-store";
import { deadlineInputs, obligationDeadline, obligationsFor, reportDeadline } from "@/server/preflight";
import { rawQprReleased } from "@/server/qpr-store";

/**
 * Every donor report the project owes around now, with its date (lib/report-calendar). Where the
 * agreement's obligations are saved (lib/obligations), each donor's quarterly and annual reports
 * follow its own periods and days, with the format it asks for; otherwise calendar quarters and
 * years with the deadline rules, as before.
 */
export async function reportCalendar(code: string, today = new Date().toISOString().slice(0, 10)): Promise<{ rows: CalendarRow[] }> {
  const project = await projectByCode(code);
  const { quarters, years } = calendarPeriods(project.startDate ?? null, project.endDate ?? null, today);
  const inputs = await deadlineInputs(code);
  const quarterly = obligationsFor(inputs.obligations, "quarterlyReportDays");
  const annual = obligationsFor(inputs.obligations, "annualReportDays");
  const donors = inputs.obligations.length ? new Map((await projectDonors(project.id)).map((d) => [d.id, d.name])) : new Map<string, string>();

  // Each obligation's periods around now: a quarterly report opens the calendar quarter its period ends in, an annual one its year.
  const fromObligations = [
    ...quarterly.flatMap((o) => aroundNow(obligationPeriods(o, inputs.start, inputs.end, today), "qpr", today).map((p) => ({ o, p, kind: "qpr" as const, period: quarterOf(p.to) }))),
    ...annual.flatMap((o) => aroundNow(obligationPeriods(o, inputs.start, inputs.end, today), "annual", today).map((p) => ({ o, p, kind: "annual" as const, period: p.to.slice(0, 4) }))),
  ];
  const qprKeys = [...new Set([...(quarterly.length ? [] : quarters), ...fromObligations.filter((x) => x.kind === "qpr").map((x) => x.period)])];
  // Whether each quarter's report is released comes in one read, alongside the deadline rules.
  const released = await rawQprReleased(project.id, qprKeys);
  const rows = await Promise.all([
    ...(quarterly.length
      ? []
      : quarters.map(async (q) => {
          const end = quarterRange(q).to;
          const d = await reportDeadline(code, end, 60, "quarterlyReportDays", inputs);
          return calendarRow("qpr", q, end, d, !!released.get(q), today);
        })),
    ...(annual.length
      ? []
      : years.map(async (y) => {
          const end = `${y}-12-31`;
          return calendarRow("annual", String(y), end, await reportDeadline(code, end, 120, "annualReportDays", inputs), false, today);
        })),
    ...fromObligations.map(async ({ o, p, kind, period }) => {
      const found = obligationDeadline(o, p.to, kind === "qpr" ? 60 : 120, kind === "qpr" ? "quarterlyReportDays" : "annualReportDays", inputs);
      const d = found ? { due: found.due, aim: found.aim, reviewDays: found.reviewDays, source: found.source } : { due: p.due, aim: p.due, reviewDays: 0, source: null };
      return calendarRow(kind, period, p.to, d, kind === "qpr" && !!released.get(period), today, { name: o.name, donor: o.donorId ? (donors.get(o.donorId) ?? null) : null, from: p.from, format: formatAskedFor(o) });
    }),
  ]);
  return { rows: sortCalendar(rows) };
}
