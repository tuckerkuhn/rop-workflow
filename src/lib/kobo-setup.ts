import { z } from "zod";

/** KoboToolbox connection, forms and question-to-indicator mappings, as the API sends them. */

export const MAPPING_METHODS = ["count_answered", "count_answer", "count_unique", "sum"] as const;
export type MappingMethod = (typeof MAPPING_METHODS)[number];

export type KoboConnectionInfo = {
  serverUrl: string;
  /** Last 4 characters of the token, so people can tell which one is saved. */
  tokenHint: string;
  countOnly: "all" | "approved";
  lastSyncedAt: string | null;
  /** When automatic sync was turned on (or its password last replaced); null when off. */
  autoSyncSince: string | null;
};

/** What KoboToolbox needs to call this link. The password is shown once and never again. */
export type AutoSyncSecret = { path: string; username: string; password: string };

/** What a linked form's submissions are for; see kobo_forms.purpose. */
export const FORM_PURPOSES = ["readiness", "data"] as const;
export type FormPurpose = (typeof FORM_PURPOSES)[number];
/** Setup's first guess for a form, from its name. People can change it. */
export const guessPurpose = (name: string): FormPurpose => (/readiness/i.test(name) ? "readiness" : "data");

export type KoboFormInfo = { uid: string; name: string; submissions?: number; deployed?: boolean; purpose?: FormPurpose };

export type KoboQuestion = { path: string; label: string; type: string; choices: { name: string; label: string }[] };

export type KoboMapping = { indicatorCode: string; assetUid: string; question: string; method: MappingMethod; value: string | null };

export type KoboState = { connection: KoboConnectionInfo | null; forms: KoboFormInfo[]; mappings: KoboMapping[] };

export const connectSchema = z.object({
  serverUrl: z.string().trim().min(1).max(300),
  /** Left out when only the setting changes and the saved token stays. */
  token: z.string().trim().min(8).max(200).optional(),
  countOnly: z.enum(["all", "approved"]),
});

export const formsSchema = z.object({ forms: z.array(z.object({ uid: z.string().min(1).max(100), name: z.string().min(1).max(300), purpose: z.enum(FORM_PURPOSES).default("data") })).max(50) });

export const mappingsSchema = z.object({
  mappings: z
    .array(
      z.object({
        indicatorCode: z.string().min(1),
        assetUid: z.string().min(1).max(100),
        question: z.string().min(1).max(300),
        method: z.enum(MAPPING_METHODS),
        value: z.string().max(300).nullable(),
      }),
    )
    .max(200),
});

/** fetched: submissions on the forms in KoboToolbox. updated: edited or approval changed. removed: deleted in KoboToolbox. */
export type SyncCounts = { fetched: number; added: number; already: number; updated: number; removed: number; forms: number; results?: { added: number; updated: number; removed: number; flagged: number; photos: number } };
