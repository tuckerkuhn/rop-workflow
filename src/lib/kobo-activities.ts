import { z } from "zod";
import { activityOf } from "@/lib/qpr";

/**
 * Which workplan activities each KoboCollect form records, so the form's submissions show on the
 * activity as field evidence without anyone typing a link. Kept by form (its KoboToolbox asset
 * uid), each with the activity codes it records. A code may be an activity ("1.2.1", as the
 * quarterly report uses them) or a sub-activity ("1.2.1.3", as the workplan lists them).
 */
export type KoboActivityLinks = Record<string, string[]>;

/** Where a form's activities came from: suggested from its targets and used as is, or chosen by hand. */
export const ACTIVITY_LINK_ORIGINS = ["suggested", "manual"] as const;
export type ActivityLinkOrigin = (typeof ACTIVITY_LINK_ORIGINS)[number];

const activityCode = z.string().trim().regex(/^\d+(\.\d+)*$/, "An activity code is numbers with dots, like 1.2.1.").max(30);
export const activityLinksSchema = z.object({
  links: z
    .array(z.object({ form: z.string().min(1).max(100), activities: z.array(activityCode).max(50), origin: z.enum(ACTIVITY_LINK_ORIGINS).default("manual") }))
    .max(50),
});
export type ActivityLinkInput = z.infer<typeof activityLinksSchema>["links"][number];

/**
 * The activities each form records, as its mappings say: the activity of every target counted
 * from the form. Forms with no mapped target get none.
 */
export function suggestActivities(mappings: { indicatorCode: string; assetUid: string }[], indicators: { code: string; donorCode: string | null }[]): KoboActivityLinks {
  const out: KoboActivityLinks = {};
  for (const m of mappings) {
    const i = indicators.find((x) => x.code === m.indicatorCode);
    if (!i || !m.assetUid) continue;
    const a = activityOf(i.donorCode, i.code);
    if (!a) continue;
    out[m.assetUid] = [...new Set([...(out[m.assetUid] ?? []), a])].sort();
  }
  return out;
}

/**
 * Whether a linked code covers a workplan row: the same code, the row's activity, or an activity
 * the row's code sits under ("1.2.1" covers "1.2.1.3").
 */
export const coversActivity = (linked: string, row: { code: string; activityCode?: string | null }) => linked === row.code || linked === row.activityCode || row.code.startsWith(`${linked}.`);

/** What a manager sees on an activity: counts only, never an answer or a person. */
export type FieldRecords = { form: string; name: string; purpose: string; quarter: number; total: number };

/** The records a form's purpose stands for, in a few words. */
const NOUN: Record<string, [string, string]> = {
  visit: ["farm visit", "farm visits"],
  training: ["training attendance record", "training attendance records"],
  readiness: ["readiness check", "readiness checks"],
  distribution: ["input distribution", "input distributions"],
};
/** "12 farm visits recorded in KoboCollect this quarter". */
export function fieldRecordsText(f: Pick<FieldRecords, "purpose" | "quarter">) {
  const [one, many] = NOUN[f.purpose] ?? ["submission", "submissions"];
  return `${f.quarter} ${f.quarter === 1 ? one : many} recorded in KoboCollect this quarter`;
}
