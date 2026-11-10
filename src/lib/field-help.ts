import { en } from "@/lib/i18n/en";
import type { MessageKey } from "@/lib/i18n";

/**
 * "Why we ask" (C7): the one register of help for fields that collect personal or sensitive data.
 * Up to three short lines per field: why we ask, how we protect it, and where the requirement
 * comes from. A line with nothing real to say is left out, never filled.
 *
 * The same register is the "What we collect and why" part of docs/DATA-PROTECTION.md
 * (`registerMarkdown` below; a test fails when the document and the register differ), so the
 * policy and the screens cannot drift apart. Every line must be true to the code: change the
 * behaviour and this text together.
 */
export type FieldHelpEntry = { field: MessageKey; why: MessageKey; protect?: MessageKey; source?: MessageKey };

export const FIELD_HELP = {
  "result.sex": { field: "fh.result.sex", why: "fh.result.sex.why", protect: "fh.result.sex.protect", source: "fh.result.sex.source" },
  "result.youth": { field: "fh.result.youth", why: "fh.result.youth.why", source: "fh.result.youth.source" },
  "result.place": { field: "fh.result.place", why: "fh.result.place.why", protect: "fh.result.place.protect" },
  "result.note": { field: "fh.result.note", why: "fh.result.note.why", protect: "fh.result.note.protect" },
  "result.proof": { field: "fh.result.proof", why: "fh.result.proof.why", protect: "fh.result.proof.protect" },
  "story.consent": { field: "fh.story.consent", why: "fh.story.consent.why", protect: "fh.story.consent.protect" },
  "story.firstName": { field: "fh.story.firstName", why: "fh.story.firstName.why", protect: "fh.story.firstName.protect" },
  "story.woman": { field: "fh.story.woman", why: "fh.story.woman.why" },
  "story.notes": { field: "fh.story.notes", why: "fh.story.notes.why", protect: "fh.story.notes.protect" },
  "weekly.note": { field: "fh.weekly.note", why: "fh.weekly.note.why", protect: "fh.result.note.protect" },
  "weekly.photos": { field: "fh.weekly.photos", why: "fh.weekly.photos.why", protect: "fh.result.proof.protect" },
  "farmer.photo": { field: "fh.farmer.photo", why: "fh.farmer.photo.why", protect: "fh.farmer.photo.protect" },
} as const satisfies Record<string, FieldHelpEntry>;
export type FieldHelpKey = keyof typeof FIELD_HELP;

/** The register as the section of the data protection document, in English. */
export function registerMarkdown(): string {
  const rows = (Object.values(FIELD_HELP) as FieldHelpEntry[]).map((e) => `| ${en[e.field]} | ${en[e.why]} | ${e.protect ? en[e.protect] : "—"} | ${e.source ? en[e.source] : "—"} |`);
  return ["| Field | Why we ask | How we protect it | Source |", "|---|---|---|---|", ...rows].join("\n");
}
