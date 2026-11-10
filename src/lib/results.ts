import { z } from "zod";
import { selfSchema } from "@/lib/solo";
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

/**
 * Proof kept where ROP already keeps it: a link to the document in SharePoint (or another https
 * address), with a short title so the report and the MEL owner know what it is.
 */
export const proofLinkSchema = z.object({
  url: z
    .string()
    .trim()
    .url("That is not a web address.")
    .max(2000)
    .refine((u) => u.startsWith("https://"), "Use the document's https:// link (for SharePoint: Copy link)."),
  title: z.string().trim().min(2, "Say what the document is.").max(200),
});
export type ProofLink = z.infer<typeof proofLinkSchema>;

/** A real calendar date: "2026-02-30" and month 31 are refused. */
export const realDate = (d: string) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};

export const resultSchema = z
  .object({
    /** The indicator's code in the app, e.g. "IND-3". */
    indicator: z.string().regex(/^IND-\d+$/),
    /** When it was achieved (the last day of the activity, or the verification date). */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(realDate, "That date does not exist."),
    value: z.number().positive().max(1e9),
    female: z.number().int().min(0).max(1e7).optional(),
    male: z.number().int().min(0).max(1e7).optional(),
    /** Of the people, how many are young (see YOUTH). */
    youth: z.number().int().min(0).max(1e7).optional(),
    womenLed: z.number().int().min(0).max(1e6).optional(),
    menLed: z.number().int().min(0).max(1e6).optional(),
    province: z.string().trim().max(60).optional(),
    district: z.string().trim().max(80).optional(),
    crop: z.string().trim().max(80).optional(),
    /** What was done, for the report's narrative: where, with whom, what changed. */
    note: z.string().trim().min(10).max(2000),
    files: z.array(receiptSchema).max(20),
    /** Documents linked rather than uploaded, e.g. the attendance sheet in SharePoint. */
    links: z.array(proofLinkSchema).max(20).optional(),
    /** Photo captions by file fingerprint; a captioned photo goes into the donor report. */
    captions: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.string().trim().max(300)).optional(),
    /** When each photo was taken, by file fingerprint: read from the photo, or typed in. */
    taken: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
    /** Where it was recorded (a KoboToolbox submission's location): for checks inside ROP, never shown to donors. */
    gps: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
    /** What was written in Dari or Pashto, kept beside its English translation (set by the server). */
    original: z.object({ lang: z.enum(["fa", "ps", "other"]), title: z.string().max(400).optional(), note: z.string().max(8000).optional(), captions: z.record(z.string(), z.string().max(600)).optional(), pending: z.boolean().optional(), model: z.string().max(80).optional() }).optional(),
    /** The KoboToolbox submission it came from, when it came from one. */
    kobo: z.object({ asset: z.string().max(80), uuid: z.string().max(80), id: z.number().int().optional() }).optional(),
    /** Why there is no file yet, when there is none. */
    noFile: z.string().trim().max(300).optional(),
  })
  .refine((r) => r.files.length > 0 || (r.links?.length ?? 0) > 0 || (r.noFile ?? "").length >= 5, "Attach or link the proof (attendance sheet, photos, report), or say why it is not attached yet.")
  .refine((r) => r.youth === undefined || r.youth <= (r.female ?? 0) + (r.male ?? 0) || (r.female === undefined && r.male === undefined), "There are more young people than people.");

/** Who counts as young. Afghanistan's National Youth Policy uses 18 to 35; a donor may ask for another band. */
export const YOUTH = { label: "Young people (18–35)", source: "Afghanistan National Youth Policy" };

/** Files and links on a result: the proof behind it. */
export const proofCount = (r: Pick<ResultInput, "files" | "links">) => r.files.length + (r.links?.length ?? 0);
export type ResultInput = z.infer<typeof resultSchema>;

export type ResultStatus = "pending" | "accepted" | "queried";
/** A correction after MEL queried a result: what it said before, what MEL asked, and the reply. */
export type Correction = { at: string; by: string; query: string | null; reply: string; previous: Partial<ResultInput> };

/** Fields a recorder may correct after a query; the indicator and the proof stay as they are. */
export const correctionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(realDate, "That date does not exist."),
  value: z.number().positive().max(1e9),
  female: z.number().int().min(0).max(1e7).optional(),
  male: z.number().int().min(0).max(1e7).optional(),
  youth: z.number().int().min(0).max(1e7).optional(),
  womenLed: z.number().int().min(0).max(1e6).optional(),
  menLed: z.number().int().min(0).max(1e6).optional(),
  province: z.string().trim().max(60).optional(),
  district: z.string().trim().max(80).optional(),
  note: z.string().trim().min(10).max(2000),
});

export type ResultRecord = ResultInput & {
  /** Earlier versions, oldest first, each with the query that prompted the correction. */
  history?: Correction[];
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
  /** A short heading for the weekly update, e.g. "Trellis installation". */
  title: z.string().trim().max(120).optional(),
  note: z.string().trim().min(10).max(4000),
  files: z.array(receiptSchema).max(20),
  captions: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.string().trim().max(300)).optional(),
  taken: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  /** What was written in Dari or Pashto, kept beside its English translation (set by the server). */
  original: z.object({ lang: z.enum(["fa", "ps", "other"]), title: z.string().max(400).optional(), note: z.string().max(8000).optional(), captions: z.record(z.string(), z.string().max(600)).optional(), pending: z.boolean().optional(), model: z.string().max(80).optional() }).optional(),
});
export type UpdateInput = z.infer<typeof updateSchema>;
export type UpdateRecord = UpdateInput & { id: string; quarter: string; by: string; at: string };

export const resultActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("record"), result: resultSchema }),
  /** Many results at once from a spreadsheet: each is checked as if recorded by hand, all or none. */
  z.object({ action: z.literal("import"), results: z.array(resultSchema).min(1).max(300), file: z.string().trim().max(200) }),
  z.object({ action: z.literal("update"), update: updateSchema }),
  /** Changes or removes an activity update, until the week it is dated in has been sent. */
  z.object({ action: z.literal("update-edit"), id: z.string().uuid(), update: updateSchema }),
  z.object({ action: z.literal("update-remove"), id: z.string().uuid() }),
  /** `self`: solo mode, the MEL owner accepts a result they recorded, confirming that (server/solo.ts). */
  z.object({ action: z.literal("accept"), id: z.string().uuid(), self: selfSchema.optional() }),
  /** MEL accepts many at once: only those waiting, not their own, and with nothing flagged by the data checker. */
  z.object({ action: z.literal("accept-many"), ids: z.array(z.string().uuid()).min(1).max(300) }),
  /** Adds proof to a recorded result, at any stage: it never changes the figure. */
  z
    .object({
      action: z.literal("proof"),
      id: z.string().uuid(),
      files: z.array(receiptSchema).max(20),
      links: z.array(proofLinkSchema).max(20),
      captions: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.string().trim().max(300)).optional(),
      taken: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
    })
    .refine((a) => a.files.length + a.links.length > 0, "Add a file or a link."),
  z.object({ action: z.literal("query"), id: z.string().uuid(), note: z.string().trim().min(3).max(1000) }),
  /** MEL sends an accepted result back to its recorder, with the reason; it stops counting until accepted again. */
  z.object({ action: z.literal("reopen"), id: z.string().uuid(), note: z.string().trim().min(10, "Say what is wrong, so the recorder can fix it.").max(1000) }),
  /** The recorder answers MEL's query: corrected figures and what changed. It goes back to MEL. */
  z.object({ action: z.literal("correct"), id: z.string().uuid(), changes: correctionSchema, reply: z.string().trim().min(5, "Say what you changed, for MEL.").max(1000) }),
]);
export type ResultAction = z.infer<typeof resultActionSchema>;

/** Totals from accepted results, overall and for a date range. */
export function totalsOf(list: ResultRecord[], from?: string, to?: string) {
  const counted = list.filter((r) => r.status === "accepted" && (!from || r.date >= from) && (!to || r.date <= to));
  const sum = (k: "value" | "female" | "male" | "youth" | "womenLed" | "menLed") => counted.reduce((s, r) => s + (r[k] ?? 0), 0);
  const provinces = [...new Set(counted.map((r) => r.province).filter(Boolean))] as string[];
  return { value: sum("value"), female: sum("female"), male: sum("male"), youth: sum("youth"), womenLed: sum("womenLed"), menLed: sum("menLed"), provinces, records: counted.length, files: counted.reduce((s, r) => s + proofCount(r), 0) };
}

export type { Receipt };
