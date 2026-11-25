import { longDate } from "@/lib/weekly";

/**
 * A report can be released before its period has ended (decision X, 25 Nov 2026): nothing is
 * refused, the person is warned. Until the period has ended the report carries a "Draft"
 * watermark on its page, in its Word file and on a donor's link, so nobody takes it for the
 * final report. From the day after the period's last day it carries none.
 */
export function periodNotEnded(to: string, today: string = new Date().toISOString().slice(0, 10)): boolean {
  return today <= to;
}

/** The word across the report. */
export const EARLY_DRAFT_WORD = "Draft";

/** The line that goes with the watermark, for a reader who cannot see it. */
export function earlyDraftLine(to: string): string {
  return `Draft. The period this report covers ends on ${longDate(to)}. Until then it is not the final report.`;
}
