import { z } from "zod";
import { CONSENT_HOW, CONSENT_USES } from "@/lib/stories";

/**
 * Photos and posts. Every photo field staff add (to a result, a weekly update or a story) gets
 * short coaching for the person who took it: one of three plain labels and a tip or two, never a
 * score or a ranking. The best photos form a library; the comms team clears what may leave the
 * app and drafts posts for each audience. Nothing is posted by the app: a person approves, copies
 * and sends every post.
 *
 * Safety, for people in Afghanistan: a photo in which people can be recognised leaves the app only
 * with recorded consent covering that use; women who can be recognised never go on public social
 * media without consent for it; places are named down to the province; public posts are off for a
 * project until a lead turns them on, after checking the donor's visibility agreement.
 */

export const LABELS = ["report", "records", "retake"] as const;
export type PhotoLabel = (typeof LABELS)[number];
export const LABEL_TEXT: Record<PhotoLabel, string> = { report: "Ready for a report", records: "Good for the records", retake: "Retake if you can" };

export const PEOPLE = ["none", "not-identifiable", "identifiable"] as const;
export type People = (typeof PEOPLE)[number];

export type Coaching = {
  /** False when the picture is a document (an attendance sheet, a form, a receipt): no tips, never shared. */
  isPhoto: boolean;
  label: PhotoLabel;
  /** In English; `tipsLocal` in the photographer's language when it is not English. */
  tips: string[];
  tipsLocal?: { lang: string; tips: string[] };
  /** What the photo shows, in a few words, for the library and for drafting posts. */
  shows: string;
  people: People;
  /** A woman or girl can be recognised. */
  womenIdentifiable: boolean;
  model: string;
  at: string;
};

/** How far a photo may go. */
export const SHARE = ["internal", "comms", "public"] as const;
export type Share = (typeof SHARE)[number];
export const SHARE_TEXT: Record<Share, string> = {
  internal: "Inside ROP only",
  comms: "Donors, partners, newsletter and website",
  public: "Public social media too",
};

export const consentSchema = z.object({
  how: z.enum(CONSENT_HOW),
  uses: z.array(z.enum(CONSENT_USES)).min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  takenBy: z.string().trim().min(2).max(80),
});
export type PhotoConsent = z.infer<typeof consentSchema>;

export type PhotoMeta = {
  coach?: Coaching;
  /** Coaching failed or was skipped (not an image, too large): the reason, so it is not retried. */
  skipped?: string;
  share?: { level: Share; by: string; at: string };
  consent?: PhotoConsent & { by: string; at: string };
};

export const AUDIENCES = ["donor", "traders", "linkedin", "instagram", "facebook", "newsletter", "website"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_TEXT: Record<Audience, string> = {
  donor: "Donor",
  traders: "Traders and buyers",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  newsletter: "Newsletter",
  website: "Website",
};
/** Public social media: needs the project's permission and photos cleared for public use. */
export const PUBLIC_AUDIENCES: Audience[] = ["linkedin", "instagram", "facebook"];
export const needs = (a: Audience): Share => (PUBLIC_AUDIENCES.includes(a) ? "public" : "comms");

export type Post = {
  id: string;
  audience: Audience;
  photos: string[];
  text: string;
  /** Records the post is drawn from (result, update or story ids). */
  sources: string[];
  status: "draft" | "approved" | "sent";
  by: string;
  at: string;
  model?: string;
  checks?: string[];
  approved?: { by: string; at: string };
  sent?: { by: string; at: string; where: string };
};

export type PhotosState = { photos: Record<string, PhotoMeta>; posts: Post[]; publicPosts?: { on: boolean; by: string; at: string; note: string } };
export const emptyPhotos: PhotosState = { photos: {}, posts: [] };

const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const photoActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("coach"), hashes: z.array(hash).max(6).optional() }),
  z.object({ action: z.literal("share"), hash, level: z.enum(SHARE) }),
  z.object({ action: z.literal("consent"), hash, consent: consentSchema }),
  z.object({ action: z.literal("public-posts"), on: z.boolean(), note: z.string().trim().min(5).max(400) }),
  z.object({ action: z.literal("draft-post"), audience: z.enum(AUDIENCES), photos: z.array(hash).min(1).max(4), ask: z.string().trim().max(400).optional() }),
  z.object({ action: z.literal("edit-post"), id: z.string().uuid(), text: z.string().trim().min(5).max(4000) }),
  z.object({ action: z.literal("approve-post"), id: z.string().uuid() }),
  z.object({ action: z.literal("sent-post"), id: z.string().uuid(), where: z.string().trim().min(2).max(200) }),
  z.object({ action: z.literal("remove-post"), id: z.string().uuid() }),
]);
export type PhotoAction = z.infer<typeof photoActionSchema>;

/** What a photo's consent and contents allow. `story` is the consent of a story the photo belongs to. */
export function shareLimit(m: PhotoMeta | undefined, storyUses: readonly string[] | null): { max: Share; why: string } {
  const c = m?.coach;
  if (!c) return { max: "internal", why: "Not looked at yet." };
  if (!c.isPhoto) return { max: "internal", why: "A document, not a photo of the work." };
  const uses = new Set([...(storyUses ?? []), ...(m?.consent?.uses ?? [])]);
  if (c.people !== "identifiable") return { max: "public", why: c.people === "none" ? "No people in it." : "People cannot be recognised." };
  if (uses.has("social")) return { max: "public", why: "Consent covers social media." };
  if (uses.has("comms")) return { max: "comms", why: c.womenIdentifiable ? "Consent covers ROP communications, not social media; a woman can be recognised." : "Consent covers ROP communications, not social media." };
  return { max: "internal", why: "People can be recognised and no consent is recorded for sharing." };
}
export const rank = (s: Share) => SHARE.indexOf(s);
