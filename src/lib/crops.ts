/**
 * The crop plan a project decides at initiation (Set up → Crop): how the crop is planted and, for a
 * crop planted by the tree or vine, the spacing. From the spacing the app works out the planting
 * density, so at planting the extension agent types only how many went in the ground and the
 * hectares follow. Nobody records the same thing twice.
 *
 * The suggested spacings are starting points for the project's technical team to confirm or change
 * for the variety, the site and the trellis or training system, not ROP standards.
 */
import { z } from "zod";

/** Where a project's crop plan is kept (project_state). */
export const CROP_PLAN_KEY = "crop-plan";

export const cropPlanSchema = z.object({
  /** Planted and counted one by one (trees, vines, seedlings), or sown over an area (seed). */
  by: z.enum(["count", "area"]),
  /** What is counted at planting, plural: "vines", "trees", "seedlings". */
  unit: z.string().trim().min(1).max(40).optional(),
  /** Metres between rows, and between plants in a row. */
  rowM: z.number().positive().max(100).optional(),
  plantM: z.number().positive().max(100).optional(),
  /** Grown on a trellis or support system the project installs. */
  trellis: z.boolean().optional(),
  /** Years from planting to the first harvest, for the season plan and reporting. */
  yearsToHarvest: z.number().int().min(0).max(30).optional(),
});
export type CropPlan = z.infer<typeof cropPlanSchema>;

type Suggestion = CropPlan & { note?: string };

/** Suggested plans for crops ROP often works with. Anything else starts blank. */
export const CROP_SUGGESTIONS: Record<string, Suggestion> = {
  Grapes: { by: "count", unit: "vines", rowM: 3, plantM: 1.5, trellis: true, yearsToHarvest: 3, note: "Trellised table grapes: rows 3 m apart, vines 1.5 m apart in the row." },
  Pomegranates: { by: "count", unit: "trees", rowM: 5, plantM: 4, yearsToHarvest: 3 },
  Almonds: { by: "count", unit: "trees", rowM: 6, plantM: 6, yearsToHarvest: 4 },
  Apricots: { by: "count", unit: "trees", rowM: 6, plantM: 5, yearsToHarvest: 4 },
  Coffee: { by: "count", unit: "plants", rowM: 2.5, plantM: 2, yearsToHarvest: 3 },
  Cacao: { by: "count", unit: "trees", rowM: 3, plantM: 3, yearsToHarvest: 4 },
  Maize: { by: "area" },
  Wheat: { by: "area" },
  Onions: { by: "area" },
  Rice: { by: "area" },
  Saffron: { by: "area" },
};
export const CROP_NAMES = Object.keys(CROP_SUGGESTIONS);

/** The suggested plan for a crop, matched without regard to case; null for a crop not in the list. */
export function suggestedPlan(crop: string): Suggestion | null {
  const key = CROP_NAMES.find((c) => c.toLowerCase() === crop.trim().toLowerCase());
  return key ? CROP_SUGGESTIONS[key] : null;
}

/** Plants per hectare from the spacing: 10,000 m² over the area each plant takes. Null without both spacings. */
export function densityOf(plan: CropPlan | null | undefined): number | null {
  if (!plan || plan.by !== "count" || !plan.rowM || !plan.plantM) return null;
  return Math.round(10000 / (plan.rowM * plan.plantM));
}

/** Hectares a number of plants takes at the plan's density, to two decimals. Null without a density. */
export function hectaresFor(count: number, plan: CropPlan | null | undefined): number | null {
  const d = densityOf(plan);
  return d ? Math.round((count / d) * 100) / 100 : null;
}

/** What is wrong with a plan, in words the project manager can act on; null when it can be saved. */
export function cropPlanProblem(plan: CropPlan | null | undefined): string | null {
  if (!plan || plan.by === "area") return null;
  if (!plan.unit?.trim()) return "Say what is counted at planting (vines, trees, seedlings).";
  if (!plan.rowM || !plan.plantM) return "Enter the spacing between rows and between plants, so the app can work out the hectares.";
  return null;
}

const singular = (u: string) => u.trim().toLowerCase().replace(/s$/, "");

/**
 * The package item that is what gets planted: the one counted in the plan's unit, or else one
 * counted in trees, vines, seedlings, cuttings or saplings. Undefined when none is.
 */
export function plantedItem<T extends { key: string; unit: string }>(items: T[], plan: CropPlan | null | undefined): T | undefined {
  if (!plan || plan.by !== "count") return undefined;
  const want = plan.unit ? singular(plan.unit) : "";
  return items.find((i) => want && singular(i.unit) === want) ?? items.find((i) => /^(tree|vine|seedling|cutting|sapling|plant)s?$/i.test(i.unit.trim()));
}

/**
 * What one farmer's planting adds to a target, by the target's unit: the hectares planted, the
 * plants counted, or one farmer. `people` says whether the value counts people (and so can be
 * split by sex).
 */
export function plantingValue(unit: string, planting: { hectares: number; count?: number }, plan: CropPlan | null | undefined): { value: number; people: boolean } {
  const u = unit.trim().toLowerCase();
  if (/hectare|^ha$|\bha\b/.test(u)) return { value: planting.hectares, people: false };
  const counted = /tree|vine|seedling|cutting|sapling|^plants?$/.test(u) || (!!plan?.unit && singular(plan.unit) === singular(u));
  if (counted && planting.count !== undefined) return { value: planting.count, people: false };
  return { value: 1, people: true };
}
