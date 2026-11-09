import { z } from "zod";

/**
 * UNDP's FACE form (Funding Authorization and Certificate of Expenditures), as ROP sends it each
 * month: one row per activity with the authorised amount (A), the month's actual expenditure (B,
 * from Finance's budget-against-actual workbook), what UNDP accepts (C, taken as B until UNDP says
 * otherwise), the balance (D = A - C), the new request (F) and what stays authorised (G = D + F).
 * Overhead (GMS) is reported in US dollars from the workbook's overhead row.
 */

export type FaceHeader = { programme: string; institution: string; officer: string; signer: string; signerTitle: string; country: string; agency: string };
export const DEFAULT_HEADER: FaceHeader = { programme: "", institution: "", officer: "", signer: "", signerTitle: "", country: "Afghanistan", agency: "UNDP" };

export type FaceMonth = {
  /** A: authorised for the period, per activity code. */
  authorised: Record<string, number>;
  /** F: the new request, per activity code, and the period it is for (e.g. "Sep-26"). */
  request: Record<string, number>;
  requestPeriod: string;
  /** Period the authorised amount covers, as the form heads it (e.g. "Aug-Sep 2026"). */
  authorisedPeriod: string;
  savedBy?: string;
  savedAt?: string;
};
export type FaceState = { header: FaceHeader; months: Record<string, FaceMonth> };
export const emptyFace: FaceState = { header: DEFAULT_HEADER, months: {} };

export const facePatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("header"), header: z.object({ programme: z.string().max(80), institution: z.string().max(80), officer: z.string().max(120), signer: z.string().max(120), signerTitle: z.string().max(120), country: z.string().max(60), agency: z.string().max(40) }) }),
  z.object({
    action: z.literal("month"),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    authorised: z.record(z.string().regex(/^\d+\.\d+\.\d+$/), z.number().min(0).max(1e12)),
    request: z.record(z.string().regex(/^\d+\.\d+\.\d+$/), z.number().min(0).max(1e12)),
    requestPeriod: z.string().max(40),
    authorisedPeriod: z.string().max(40),
  }),
]);
export type FacePatch = z.infer<typeof facePatchSchema>;

export type FaceRow = { activity: string; name: string; a: number; b: number; c: number; d: number; f: number; g: number };

/** The activity a budget line belongs to: "PRG-1.1.1.B" and "LAB-1.2.1" give "1.1.1" and "1.2.1". */
export const activityOfLine = (code: string) => code.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;

/** The form's rows from the month's spending by activity and what Finance entered. */
export function faceRows(activities: { code: string; name: string }[], spent: Record<string, number>, m: FaceMonth | undefined): { rows: FaceRow[]; total: FaceRow } {
  const rows = activities.map((x) => {
    const a = Math.round(m?.authorised[x.code] ?? 0);
    const b = Math.round(spent[x.code] ?? 0);
    const c = b;
    const d = a - c;
    const f = Math.round(m?.request[x.code] ?? 0);
    return { activity: x.code, name: x.name, a, b, c, d, f, g: d + f };
  });
  const sum = (k: keyof Omit<FaceRow, "activity" | "name">) => rows.reduce((t, r) => t + r[k], 0);
  return { rows, total: { activity: "", name: "Total", a: sum("a"), b: sum("b"), c: sum("c"), d: sum("d"), f: sum("f"), g: sum("g") } };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-08" → "Aug 01-Aug 31, 2026", as ROP writes the period. */
export function periodText(month: string) {
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${MON[m - 1]} 01-${MON[m - 1]} ${last}, ${y}`;
}
export const monthShort = (month: string) => `${MON[Number(month.slice(5, 7)) - 1]}-${month.slice(2, 4)}`;
export const nextMonth = (month: string) => {
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
