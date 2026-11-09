import { z } from "zod";

/**
 * Success stories: the people behind the figures, for the report's Human Interest Story, the
 * board and communications. Consent comes first and says what it covers; a story is used only
 * within its consent, and only once a programme lead or MEL has approved it. First names only.
 */

export const CONSENT_USES = ["report", "comms", "social"] as const;
export const USE_LABEL: Record<(typeof CONSENT_USES)[number], string> = { report: "Donor reports", comms: "ROP communications (website, newsletters, board)", social: "Social media" };
export const CONSENT_HOW = ["written", "thumbprint", "verbal-recorded"] as const;
export const HOW_LABEL: Record<(typeof CONSENT_HOW)[number], string> = { written: "Signed form", thumbprint: "Thumbprint on the form", "verbal-recorded": "Spoken, recorded by staff" };

const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const storyInputSchema = z.object({
  title: z.string().trim().min(3).max(140),
  firstName: z.string().trim().max(40).optional(),
  woman: z.boolean().optional(),
  district: z.string().trim().max(80).optional(),
  province: z.string().trim().max(60).optional(),
  activity: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  notes: z.string().trim().max(6000),
  text: z.string().trim().max(6000),
  photos: z.array(z.object({ hash, name: z.string().max(200), type: z.string().max(100), size: z.number().int().min(1).max(5_000_000), caption: z.string().trim().max(300) })).max(8),
  consent: z.object({ how: z.enum(CONSENT_HOW), uses: z.array(z.enum(CONSENT_USES)).min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), takenBy: z.string().trim().min(2).max(80), form: hash.optional() }).nullable(),
  /** Results and weekly items the story is about. */
  links: z.array(z.string().uuid()).max(20),
});
export type StoryInput = z.infer<typeof storyInputSchema>;
export type Story = StoryInput & { id: string; status: "draft" | "approved"; by: string; at: string; approved?: { by: string; at: string }; drafted?: { model: string; at: string }; questions?: string[] };

export const storyActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().optional(), story: storyInputSchema }),
  z.object({ action: z.literal("draft"), id: z.string().uuid() }),
  z.object({ action: z.literal("approve"), id: z.string().uuid() }),
  z.object({ action: z.literal("unapprove"), id: z.string().uuid(), reason: z.string().trim().min(5).max(300) }),
  z.object({ action: z.literal("remove"), id: z.string().uuid() }),
  z.object({ action: z.literal("to-report"), id: z.string().uuid(), quarter: z.string().regex(/^\d{4}-Q[1-4]$/) }),
]);
export type StoryAction = z.infer<typeof storyActionSchema>;

/** Why a story cannot be used in a donor report, or null. */
export function reportBlock(s: Pick<Story, "status" | "consent">): string | null {
  if (!s.consent) return "No consent is recorded.";
  if (!s.consent.uses.includes("report")) return "The consent does not cover donor reports.";
  if (s.status !== "approved") return "Not approved yet.";
  return null;
}
