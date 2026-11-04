import { z } from "zod";

/** The project design that setup produces, and that stays editable from Home. */

/** Countries offered in setup (ISO 3166-1 alpha-2); names come from the browser in the interface language. */
export const COUNTRIES = ["AF", "IQ", "LB", "PS", "IL", "VN", "KH", "MM", "ET", "RW", "UG", "KE", "TZ", "GT", "HN", "SV", "MX", "CO", "PE", "US"];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const indicatorInputSchema = z.object({
  /** Present for indicators that already exist; new ones get the next IND-n. */
  code: z.string().max(20).optional(),
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().min(1).max(50),
  target: z.number().positive().max(1e12),
  level: z.enum(["goal", "outcome", "output"]),
  frequency: z.enum(["monthly", "quarterly", "end_of_season"]),
  /** Expected total by 31 December of each calendar year ("2027": 100). The last project year is always the target. */
  forecast: z.record(z.string().regex(/^\d{4}$/), z.number().min(0).max(1e12)).optional(),
});
export type IndicatorInput = z.infer<typeof indicatorInputSchema>;

export const projectDesignSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    country: z.string().regex(/^[A-Z]{2}$/),
    crop: z.string().trim().max(100),
    startDate: isoDate,
    endDate: isoDate,
    goal: z.string().trim().max(500),
    indicators: z.array(indicatorInputSchema).max(40),
    /** New projects only; afterwards donors are managed in project settings. */
    donors: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  })
  .refine((p) => p.endDate >= p.startDate, { message: "The end date is before the start date.", path: ["endDate"] });
export type ProjectDesign = z.infer<typeof projectDesignSchema>;

/** A project from the database, for the project picker. */
export type ProjectSummary = { code: string; name: string; country: string; crop: string | null; goal: string | null; startDate: string | null; endDate: string | null };
