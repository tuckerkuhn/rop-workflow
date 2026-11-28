import { z } from "zod";
import { packageValue } from "@/lib/eligibility";
import type { FieldSetup } from "@/lib/package";

/**
 * Farmer screening above $50 (review round 1, MF-04): before a farmer's first distribution worth
 * more than the limit, someone who may see their name checks it against the sanctions lists, and
 * the hand-out waits until that is recorded. A possible match goes to a person to review; it never
 * decides by itself, because common names match a list constantly. Once a person has reviewed it
 * and found it is not this farmer, a clear result is recorded and the hand-out goes ahead.
 *
 * The limit is a project setting (Set up, the input package: `screenAboveUsd`), $50 by default.
 * Kept on the farmer's record; the name used in the check stays in the names table only.
 */

export const DEFAULT_SCREEN_ABOVE_USD = 50;
export const FARMER_RESCREEN_DAYS = 365;
export const FARMER_LISTS = "OFAC SDN list; UN Security Council 1267 list";

export const farmerScreeningInput = z.object({
  farmer: z.string().trim().min(1).max(40),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date the lists were checked."),
  lists: z.string().trim().min(3, "Say which lists were checked.").max(400),
  result: z.enum(["clear", "possible_match"]),
  note: z.string().trim().max(1000).optional(),
});
export type FarmerScreeningInput = z.infer<typeof farmerScreeningInput>;
export type FarmerScreening = Omit<FarmerScreeningInput, "farmer"> & { by: string; byName: string };

/** The limit above which a farmer is screened before their package goes out. */
export const screenAbove = (setup: Pick<FieldSetup, "screenAboveUsd"> | null | undefined) => setup?.screenAboveUsd ?? DEFAULT_SCREEN_ABOVE_USD;

/**
 * Why this farmer's package may not go out yet for want of screening, or null: their package is
 * worth more than the limit and they have no clear screening (none yet, or a possible match still
 * to review). A package with no unit costs cannot be valued, so nothing is held for it.
 */
export function screeningHold(f: { id: string; hectares: number; package?: string; screenings?: FarmerScreening[] }, setup: Pick<FieldSetup, "items" | "packages" | "screenAboveUsd"> | null | undefined, today = new Date().toISOString().slice(0, 10)): string | null {
  const value = packageValue(setup, f.hectares, f.package);
  const limit = screenAbove(setup);
  if (value === null || value <= limit) return null;
  // By date, not by the order entered (R2-10); a screening counts for a year, as for staff.
  const last = [...(f.screenings ?? [])].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const worth = `${f.id}'s package is worth $${value.toLocaleString("en-US")}, above the $${limit} limit`;
  if (!last) return `${worth}: screen them against the sanctions lists before it is handed out. Someone who may see farmers' names does it, on the farmer's page.`;
  if (last.result === "possible_match") return `${worth}, and the check on ${last.date} found a possible match. A person reviews it; once it is found not to be this farmer, record a clear result.`;
  if (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last.date}T00:00:00Z`) > FARMER_RESCREEN_DAYS * 86_400_000) return `${worth}, and the last check was on ${last.date}, more than a year ago: screen them again.`;
  return null;
}
