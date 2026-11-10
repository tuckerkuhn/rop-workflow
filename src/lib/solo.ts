import { z } from "zod";

/** What a screen sends with a self-approval (server/solo.ts): the confirmed statement and an optional note. */
export const selfSchema = z.object({ confirm: z.literal(true), note: z.string().trim().max(500).default("") });
export type SelfConfirm = z.infer<typeof selfSchema>;
