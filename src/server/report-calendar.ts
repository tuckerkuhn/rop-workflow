import { calendarPeriods, calendarRow, sortCalendar, type CalendarRow } from "@/lib/report-calendar";
import { quarterRange } from "@/lib/results";
import { projectByCode } from "@/server/field-store";
import { deadlineInputs, reportDeadline } from "@/server/preflight";
import { rawQprReleased } from "@/server/qpr-store";

/** Every donor report the project owes around now, with its date (lib/report-calendar). */
export async function reportCalendar(code: string, today = new Date().toISOString().slice(0, 10)): Promise<{ rows: CalendarRow[] }> {
  const project = await projectByCode(code);
  const { quarters, years } = calendarPeriods(project.startDate ?? null, project.endDate ?? null, today);
  // Whether each quarter's report is released comes in one read, alongside the deadline rules.
  const [inputs, released] = await Promise.all([deadlineInputs(code), rawQprReleased(project.id, quarters)]);
  const rows = await Promise.all([
    ...quarters.map(async (q) => {
      const end = quarterRange(q).to;
      const d = await reportDeadline(code, end, 60, "quarterlyReportDays", inputs);
      return calendarRow("qpr", q, end, d, !!released.get(q), today);
    }),
    ...years.map(async (y) => {
      const end = `${y}-12-31`;
      return calendarRow("annual", String(y), end, await reportDeadline(code, end, 120, "annualReportDays", inputs), false, today);
    }),
  ]);
  return { rows: sortCalendar(rows) };
}
