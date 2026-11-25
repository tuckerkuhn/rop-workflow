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
export const FORM_PURPOSES = ["readiness", "training", "visit", "distribution", "data"] as const;
export type FormPurpose = (typeof FORM_PURPOSES)[number];
/** Setup's first guess for a form, from its name. People can change it. */
export const guessPurpose = (name: string): FormPurpose =>
  /readiness/i.test(name) ? "readiness" : /distribut/i.test(name) ? "distribution" : /training|attendance/i.test(name) ? "training" : /visit/i.test(name) ? "visit" : "data";
/** Forms whose submissions wait for a person to accept (or approve) each one before they count. */
export const REVIEWED_PURPOSES: readonly FormPurpose[] = ["readiness", "training", "visit", "distribution"];
export const isReviewed = (p: string): p is FormPurpose => (REVIEWED_PURPOSES as readonly string[]).includes(p);

export type KoboFormInfo = { uid: string; name: string; submissions?: number; deployed?: boolean; purpose?: FormPurpose };

export type KoboQuestion = { path: string; label: string; type: string; choices: { name: string; label: string }[] };

/** Where a mapping came from: chosen by hand, an AI suggestion accepted as is, or a suggestion the person changed. */
export const MAPPING_ORIGINS = ["manual", "suggested", "suggested-edited"] as const;
export type MappingOrigin = (typeof MAPPING_ORIGINS)[number];

/**
 * Who a submission counts, so a result from KoboToolbox carries women, men and young people like
 * one recorded in the app. Two shapes, as the form is built:
 * - counts: the form asks how many women, how many men and how many young people; each answer is a number.
 * - person: each submission is one person. The sex question's answer gives 1 woman or 1 man; the
 *   age question gives 1 young person or 0 (an age from 18 to 35, or the choice that means young).
 * Any part left unmapped stays empty on the result: nothing is guessed. Only numbers are kept,
 * never an answer itself.
 */
export const breakdownSchema = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("counts"), women: z.string().max(300).nullable(), men: z.string().max(300).nullable(), youth: z.string().max(300).nullable() }),
  z.object({
    shape: z.literal("person"),
    sex: z.string().max(300).nullable(),
    /** The sex question's choices (their names) for a woman and for a man. */
    female: z.string().max(300).nullable(),
    male: z.string().max(300).nullable(),
    age: z.string().max(300).nullable(),
    /** The age question's choice that means young, when it is a choice; empty when it holds the age in years. */
    young: z.string().max(300).nullable(),
  }),
]);
export type KoboBreakdown = z.infer<typeof breakdownSchema>;
/** Who counts as young from an age in years (lib/results YOUTH: 18 to 35). */
export const YOUTH_AGES = { from: 18, to: 35 } as const;
/** Whether a breakdown maps any question at all. */
export const hasBreakdown = (b: KoboBreakdown | null | undefined): b is KoboBreakdown => !!b && (b.shape === "counts" ? !!(b.women || b.men || b.youth) : !!(b.sex || b.age));

export type KoboMapping = { indicatorCode: string; assetUid: string; question: string; method: MappingMethod; value: string | null; origin?: MappingOrigin; breakdown?: KoboBreakdown | null };

/** activities: the workplan activities each form records, by form uid (lib/kobo-activities). */
export type KoboState = { connection: KoboConnectionInfo | null; forms: KoboFormInfo[]; mappings: KoboMapping[]; activities?: Record<string, string[]> };

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
        origin: z.enum(MAPPING_ORIGINS).default("manual"),
        breakdown: breakdownSchema.nullable().optional(),
      }),
    )
    .max(200),
});

/** fetched: submissions on the forms in KoboToolbox. updated: edited or approval changed. removed: deleted in KoboToolbox. */
export type SyncCounts = { fetched: number; added: number; already: number; updated: number; removed: number; forms: number; results?: { added: number; updated: number; removed: number; flagged: number; photos: number } };

/**
 * The farmers ticked on a training session record (kobo/build_field_forms.py: one record per
 * session, question `farmers`, a tick list stored as farmer numbers with spaces between). Null on a
 * record about one farmer, which answers `farmer` instead.
 */
export function sessionFarmers(p: Record<string, unknown>): string[] | null {
  if (typeof p.farmers !== "string" || (typeof p.farmer === "string" && p.farmer)) return null;
  return [...new Set(p.farmers.split(/\s+/).filter(Boolean))];
}

/**
 * Farmers ticked on a session record whom Farmer selection held when the record was accepted
 * (decision P, 25 Nov 2026): everyone else on the record was recorded and these stay open on it,
 * to be recorded once selected or left out. They are kept beside the tick list, not in it, so
 * nothing counts them. `_rop_ticked` keeps the tick list as the phone sent it.
 */
export const HELD_KEY = "_rop_held";
export const TICKED_KEY = "_rop_ticked";
export const LEFT_OUT_KEY = "_rop_left_out";
export function heldFarmers(p: Record<string, unknown>): string[] {
  return typeof p[HELD_KEY] === "string" ? [...new Set((p[HELD_KEY] as string).split(/\s+/).filter(Boolean))] : [];
}

/**
 * A linked question that names farmers on a training form: the tick list of a session record
 * (`farmers`) or the one farmer of a record from the earlier form (`farmer`). Gives where each of
 * the two answers sits, so a link made on either question counts records of both shapes: counted
 * as "different answers", each farmer counts once. Null for any other question.
 */
export function farmerQuestion(question: string): { linked: "farmers" | "farmer"; ticks: string; one: string } | null {
  const parts = question.split("/");
  const last = parts.at(-1);
  if (last !== "farmers" && last !== "farmer") return null;
  const at = (name: string) => [...parts.slice(0, -1), name].join("/");
  return { linked: last, ticks: at("farmers"), one: at("farmer") };
}
