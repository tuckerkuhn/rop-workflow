import { cropPlanProblem, cropPlanSchema } from "@/lib/crops";
import { z } from "zod";
import { THEMES } from "@/lib/indicator-library";
import { MEASURES } from "@/lib/measure";
import { MAX_INDICATORS } from "@/lib/setup-design";

/** The project design that setup produces, and that stays editable from Home. */

/** Countries offered in setup (ISO 3166-1 alpha-2); names come from the browser in the interface language. */
export const COUNTRIES = ["AF", "IQ", "LB", "PS", "IL", "VN", "KH", "MM", "ET", "RW", "UG", "KE", "TZ", "GT", "HN", "SV", "MX", "CO", "PE", "US"];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const indicatorInputSchema = z.object({
  /** Present for indicators that already exist; new ones get the next IND-n. */
  code: z.string().max(20).optional(),
  /** The donor's own number for it, e.g. "1.1.1.3": its first three parts give the activity. */
  donorCode: z.string().trim().max(30).optional(),
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().min(1).max(50),
  /** 0 when there is no number target yet (often an outcome measured by survey): kept, not dropped. */
  target: z.number().min(0).max(1e12),
  level: z.enum(["goal", "outcome", "output"]),
  frequency: z.enum(["monthly", "quarterly", "end_of_season"]),
  /** ROP impact theme, when the indicator measures one (see lib/indicator-library.ts). */
  theme: z.enum(THEMES).nullable().optional(),
  /** Expected total by 31 December of each calendar year ("2027": 100). The last project year is always the target. */
  forecast: z.record(z.string().regex(/^\d{4}$/), z.number().min(0).max(1e12)).optional(),
  // What the agreement and the logframe say about it (lib/setup-design). Each one left out keeps what is stored.
  /** The baseline value in its unit; null when there is none. The column holds two decimals. */
  baseline: z.number().min(-999_999_999_999).max(999_999_999_999).nullable().optional(),
  /** The year the baseline was measured. Kept in project_state (indicator_documents): no column holds it. */
  baselineYear: z.number().int().min(1900).max(2100).nullable().optional(),
  /** Required breakdowns, e.g. ["sex", "age", "province"]. */
  disaggregation: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  /** Means of verification: the documents that prove a result. */
  verification: z.string().trim().max(500).nullable().optional(),
  /** The wording of the outcome or output it measures. Also offered to the results framework where that has none. */
  result: z.string().trim().max(1000).nullable().optional(),
  /** The documents' frequency in words when the app's three cannot say it (e.g. "yearly"). Kept in project_state. */
  frequencyAsWritten: z.string().trim().max(40).nullable().optional(),
  /** Where in the documents it came from, e.g. "Logframe, row 14". Kept in project_state. */
  docSource: z.string().trim().max(300).nullable().optional(),
  /** How its results become its figure (lib/measure). Left out: kept as it is, or the default. */
  measure: z.enum(MEASURES).optional(),
});
export type IndicatorInput = z.infer<typeof indicatorInputSchema>;

export const projectDesignSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    country: z.string().regex(/^[A-Z]{2}$/),
    crop: z.string().trim().max(100),
    /** How the crop is planted and its spacing (lib/crops), decided at initiation. */
    cropPlan: cropPlanSchema.optional(),
    startDate: isoDate,
    endDate: isoDate,
    goal: z.string().trim().max(500),
    indicators: z.array(indicatorInputSchema).max(MAX_INDICATORS, `A project keeps at most ${MAX_INDICATORS} indicators: remove the ones it does not report on.`),
    /** New projects only; afterwards donors are managed in project settings. */
    donors: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  })
  .refine((p) => p.endDate >= p.startDate, { message: "The end date is before the start date.", path: ["endDate"] })
  .superRefine((p, ctx) => {
    const problem = cropPlanProblem(p.cropPlan);
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["cropPlan"] });
  });
export type ProjectDesign = z.infer<typeof projectDesignSchema>;

/** A project from the database, for the project picker. */
export type ProjectKind = "real" | "sample" | "sandbox";
export type ProjectSummary = { code: string; name: string; country: string; crop: string | null; goal: string | null; startDate: string | null; endDate: string | null; stage: string; /** real, or a fictional sample (read-only) or sandbox (for testing). */ kind: ProjectKind; /** Indicators that take results recorded by hand (not fed by Kobo). */ handRecorded?: number; /** Has an input package set up, so Field activities runs on it. */ field?: boolean };
