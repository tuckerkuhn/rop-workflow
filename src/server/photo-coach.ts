import { z } from "zod";
import { LABELS, PEOPLE, type Coaching } from "@/lib/photos";
import { draftStructured } from "@/server/ai-structured";
import { asIs } from "@/server/ai";
import { loadFile } from "@/server/hr-files";

/**
 * Coaching for one photo: Claude looks at it and gives the person who took it a plain label and
 * one or two tips they can use next time, in their language. It also notes whether people can be
 * recognised, which decides how far the photo may be shared. Documents (attendance sheets, forms)
 * are recognised as such and get nothing more.
 */

const LANG_NAME: Record<string, string> = { fa: "Dari", ps: "Pashto", es: "Spanish" };

const schema = z.object({
  isPhoto: z.boolean().describe("False if the picture is a document, form, list, receipt or screenshot rather than a photo of people, places or work."),
  label: z.enum(LABELS).describe("report: sharp, well lit, clearly shows the work or result, good enough for a donor report. records: usable as proof but not for a report. retake: blurred, too dark, or does not show what it is meant to."),
  tips: z.array(z.string()).max(2).describe("One or two short, concrete, kind tips for next time, each under 20 words, in English. For a report-ready photo, say what makes it work. Empty for documents."),
  tipsLocal: z.array(z.string()).max(2).describe("The same tips in the photographer's language, if it is not English; otherwise empty."),
  shows: z.string().describe("What the photo shows, in under 12 words, with no names, e.g. 'farmer checking drip lines in a vineyard'."),
  people: z.enum(PEOPLE).describe("none: no people. not-identifiable: people only from behind, far away or hands only. identifiable: a face can be recognised."),
  womenIdentifiable: z.boolean().describe("True if a woman or girl can be recognised."),
});

const SYSTEM = `You coach Roots of Peace extension workers and MEL staff in Afghanistan on photos they take of project work (vineyards, orchards, greenhouses, irrigation, trainings, markets).
Judge the photo as evidence and as storytelling: sharp and steady, light on the subject, the work or result clearly visible, the whole thing in frame, people shown at work with dignity as the farmers and business owners they are.
Tips are practical and kind, for someone with a phone in a field: "Step back so the whole trellis shows", "Keep the sun behind you", "Show hands on the work, not a line of people facing the camera". Never comment on people's looks.
Dignity: discourage posed handover or line-up photos and anything showing people as recipients; encourage people at work, the product, the before-and-after.
Be careful about recognisable people: say identifiable whenever a face could be recognised by someone who knows the person.`;

export const isDocumentName = (name: string, caption = "") => /attendance|\b(sheets?|lists?|forms?|receipts?|invoices?|signatures?|sign-?in|register|mou|contract|scan(ned)?|screenshot|id[-_ ]?card)\b|tazk[ie]ra/i.test(`${name.replace(/[_.-]+/g, " ")} ${caption}`);

export async function coachPhoto(hash: string, lang: string, by: string): Promise<{ coaching?: Coaching; skipped?: string }> {
  const f = await loadFile(hash);
  if (!f) return { skipped: "File not found." };
  if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) return { skipped: "Not a photo." };
  if (f.size > 3_700_000) return { skipped: "Too large to look at." };
  const local = LANG_NAME[lang];
  const { out, model } = await draftStructured({
    system: SYSTEM,
    task: `Coach this photo. ${local ? `The photographer reads ${local}: give tipsLocal in ${local}.` : "The photographer reads English: leave tipsLocal empty."}`,
    job: "photoCoach",
    by,
    facts: asIs({ photo: f.name }, "the photo itself is what is coached; its file name goes with it"),
    schema,
    effort: "low",
    maxTokens: 4000,
    images: [{ type: f.type as "image/jpeg" | "image/png" | "image/webp", data: Buffer.from(f.data as Uint8Array) }],
  });
  const tips = out.isPhoto ? out.tips.slice(0, 2) : [];
  return {
    coaching: {
      isPhoto: out.isPhoto,
      label: out.isPhoto ? out.label : "records",
      tips,
      ...(local && out.isPhoto && out.tipsLocal.length ? { tipsLocal: { lang, tips: out.tipsLocal.slice(0, 2) } } : {}),
      shows: out.shows.slice(0, 120),
      people: out.people,
      womenIdentifiable: out.womenIdentifiable,
      model,
      at: new Date().toISOString(),
    },
  };
}
