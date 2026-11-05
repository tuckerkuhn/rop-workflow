import { z } from "zod";
import { receiptSchema, type Receipt } from "@/lib/expense";

/**
 * Recorded results: for projects without a field form (ACRP collects attendance sheets, field
 * verification reports, photos and MoUs, not KoboToolbox), staff record each result with its
 * proof attached, and MEL accepts or queries it. Only accepted results count in Progress and in
 * the donor report, and every figure there opens the records and files behind it.
 *
 * Stored as evidence records (source "manual", form "result"), so they share the review queue's
 * states and the audit trail.
 */

/** "2026-Q3": the calendar quarter a result belongs to. */
export const quarterOf = (date: string) => `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
export const quarterRange = (q: string) => {
  const [y, n] = [Number(q.slice(0, 4)), Number(q.slice(6))];
  const from = `${y}-${String((n - 1) * 3 + 1).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(y, n * 3, 0)).toISOString().slice(0, 10);
  return { from, to: end };
};

export const PROVINCES = ["Kandahar", "Helmand", "Uruzgan", "Zabul", "Kabul", "Herat", "Balkh", "Nangarhar"];

export const resultSchema = z
  .object({
    /** The indicator's code in the app, e.g. "IND-3". */
    indicator: z.string().regex(/^IND-\d+$/),
    /** When it was achieved (the last day of the activity, or the verification date). */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    value: z.number().positive().max(1e9),
    female: z.number().int().min(0).max(1e7).optional(),
    male: z.number().int().min(0).max(1e7).optional(),
    womenLed: z.number().int().min(0).max(1e6).optional(),
    menLed: z.number().int().min(0).max(1e6).optional(),
    province: z.string().trim().max(60).optional(),
    district: z.string().trim().max(80).optional(),
    crop: z.string().trim().max(80).optional(),
    /** What was done, for the report's narrative: where, with whom, what changed. */
    note: z.string().trim().min(10).max(2000),
    files: z.array(receiptSchema).max(20),
    /** Photo captions by file fingerprint; a captioned photo goes into the donor report. */
    captions: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.string().trim().max(300)).optional(),
    /** Why there is no file yet, when there is none. */
    noFile: z.string().trim().max(300).optional(),
  })
  .refine((r) => r.files.length > 0 || (r.noFile ?? "").length >= 5, "Attach the proof (attendance sheet, photos, report), or say why it is not attached yet.");
export type ResultInput = z.infer<typeof resultSchema>;

export type ResultStatus = "pending" | "accepted" | "queried";
export type ResultRecord = ResultInput & {
  id: string;
  quarter: string;
  status: ResultStatus;
  by: string;
  at: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  query: string | null;
};

/**
 * An activity update: progress that is not an indicator count (10 of 15 reservoirs built, grant
 * agreements signed, sales at an exhibition, analysis finished), with photos. It feeds the
 * report's narrative and photos; it never changes a figure, so it needs no MEL check.
 */
export const updateSchema = z.object({
  /** The activity's code, e.g. "1.1.1". */
  activity: z.string().regex(/^\d+\.\d+\.\d+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().min(10).max(4000),
  files: z.array(receiptSchema).max(20),
  captions: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.string().trim().max(300)).optional(),
});
export type UpdateInput = z.infer<typeof updateSchema>;
export type UpdateRecord = UpdateInput & { id: string; quarter: string; by: string; at: string };

export const resultActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("record"), result: resultSchema }),
  z.object({ action: z.literal("update"), update: updateSchema }),
  z.object({ action: z.literal("accept"), id: z.string().uuid() }),
  z.object({ action: z.literal("query"), id: z.string().uuid(), note: z.string().trim().min(3).max(1000) }),
]);
export type ResultAction = z.infer<typeof resultActionSchema>;

/** Totals from accepted results, overall and for a date range. */
export function totalsOf(list: ResultRecord[], from?: string, to?: string) {
  const counted = list.filter((r) => r.status === "accepted" && (!from || r.date >= from) && (!to || r.date <= to));
  const sum = (k: "value" | "female" | "male" | "womenLed" | "menLed") => counted.reduce((s, r) => s + (r[k] ?? 0), 0);
  const provinces = [...new Set(counted.map((r) => r.province).filter(Boolean))] as string[];
  return { value: sum("value"), female: sum("female"), male: sum("male"), womenLed: sum("womenLed"), menLed: sum("menLed"), provinces, records: counted.length, files: counted.reduce((s, r) => s + r.files.length, 0) };
}

export type { Receipt };
