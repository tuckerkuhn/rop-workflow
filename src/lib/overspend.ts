import { z } from "zod";

/**
 * Why a budget line is over budget: one choice from a short list, with a note. The reason belongs
 * to the line, not to a quarter: it is printed in every quarterly report while the line stays over,
 * and a released report keeps the reason it was released with. The list was agreed with the
 * project lead (10 Nov 2026); it is not a written ROP or donor rule.
 */
export const OVERSPEND_REASONS = ["price", "early", "realign", "pending", "coding", "other"] as const;
export type OverspendReason = (typeof OVERSPEND_REASONS)[number];

export type LineReason = { reason: OverspendReason; note: string; by: string; at: string };

/** How each reason reads in the report (the report goes to the donor in English). */
export const REASON_TEXT: Record<OverspendReason, string> = {
  price: "Prices or the exchange rate came in higher than budgeted",
  early: "Work brought forward from a later quarter (timing only)",
  realign: "A realignment the donor has already approved",
  pending: "A realignment requested and waiting for the donor's approval",
  coding: "A coding error that Finance will move to the right budget line",
  other: "Other",
};

/** The sentence printed in the report. "Other" is the note on its own. */
export const reasonText = (r: { reason: OverspendReason; note: string }) => (r.reason === "other" ? r.note.trim() : `${REASON_TEXT[r.reason]}${r.note.trim() ? `: ${r.note.trim()}` : "."}`);

/** A note this short says nothing: "Other" needs at least this much. */
export const OTHER_MIN = 10;

/** The fields, for a patch schema that adds its own (the quarterly report's "overspend" action). */
export const lineReasonFields = { line: z.string().trim().min(1).max(60), reason: z.enum(OVERSPEND_REASONS).nullable(), note: z.string().trim().max(500).default("") };

/** Null clears the line's reason. "Other" says what it is. */
export const otherHasNote = (x: { reason: OverspendReason | null; note: string }) => x.reason !== "other" || x.note.length >= OTHER_MIN;
export const OTHER_ERROR = `Say what the reason is (at least ${OTHER_MIN} characters).`;

export const lineReasonSchema = z
  .object(lineReasonFields)
  .refine(otherHasNote, { message: OTHER_ERROR, path: ["note"] });
