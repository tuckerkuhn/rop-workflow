import { z } from "zod";
import type { FieldSetup } from "@/lib/package";

/**
 * Eligibility rules the app checks against each farmer's record (MF-12, decisions D-21 and D-22):
 * land size, where the farmer lives, what they grow, and the contribution they agree to, with a
 * lower rate for women allowed. Set per project (one project is one intervention), as rules in
 * Farmer selection (lib/selection): each becomes one rule there, with its words written from the
 * numbers, so a change to a number is a change of rules, versioned like any other.
 */

export type Rule =
  | { kind: "land"; min?: number; max?: number }
  | { kind: "location"; villages: string[] }
  | { kind: "crop"; crops: string[] }
  /** Percent of the package's value the farmer contributes; `womenRate` for women farmers when it differs. */
  | { kind: "contribution"; rate: number; womenRate?: number };

export const RULE_KINDS = ["land", "location", "crop", "contribution"] as const;

const names = z.array(z.string().trim().min(1).max(80)).min(1).max(100);
export const ruleSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("land"), min: z.number().min(0).max(10000).optional(), max: z.number().min(0).max(10000).optional() })
    .refine((r) => r.min !== undefined || r.max !== undefined, "Give the smallest or the largest plot, or both.")
    .refine((r) => r.min === undefined || r.max === undefined || r.min <= r.max, "The smallest plot is larger than the largest."),
  z.object({ kind: z.literal("location"), villages: names }),
  z.object({ kind: z.literal("crop"), crops: names }),
  z.object({ kind: z.literal("contribution"), rate: z.number().min(0).max(100), womenRate: z.number().min(0).max(100).optional() }),
]);

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/** The rule in words, as Farmer selection lists it. */
export function ruleText(r: Rule): string {
  if (r.kind === "land") {
    if (r.min !== undefined && r.max !== undefined) return `Farms between ${r.min} and ${r.max} hectares`;
    return r.min !== undefined ? `Farms at least ${r.min} hectares` : `Farms no more than ${r.max} hectares`;
  }
  if (r.kind === "location") return `Lives in ${list(r.villages)}`;
  if (r.kind === "crop") return `Grows ${list(r.crops.map((c) => c.toLowerCase()))} now`;
  return `Agrees to contribute ${pct(r.rate)} of the package's value${r.womenRate !== undefined && r.womenRate !== r.rate ? ` (${pct(r.womenRate)} for women)` : ""}`;
}

/** The rate this farmer contributes at: the women's rate for a woman when one is set. */
export const contributionRate = (r: Extract<Rule, { kind: "contribution" }>, gender: string) => (gender === "Female" && r.womenRate !== undefined ? r.womenRate : r.rate);

/** The package's value for one farmer in USD, or null when an item has no unit cost. */
export function packageValue(setup: Pick<FieldSetup, "items"> | null | undefined, hectares: number): number | null {
  if (!setup?.items.length) return null;
  let usd = 0;
  for (const i of setup.items) {
    if (i.unitUsd === undefined) return null;
    usd += i.qty * (i.per === "hectare" ? hectares : 1) * i.unitUsd;
  }
  return Math.round(usd * 100) / 100;
}

export type RecordFacts = { gender: string; hectares: number; community: string; crops?: string[]; contributionPaid: boolean };
/** What the record says about one rule: met, not met, or not something the record can tell (null). */
export type RuleCheck = { ok: boolean | null; detail: string };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function ruleCheck(r: Rule, f: RecordFacts, setup?: Pick<FieldSetup, "items"> | null): RuleCheck {
  if (r.kind === "land") {
    const ok = (r.min === undefined || f.hectares >= r.min - 1e-9) && (r.max === undefined || f.hectares <= r.max + 1e-9);
    return { ok, detail: `The record says ${f.hectares} ha.` };
  }
  if (r.kind === "location") return { ok: r.villages.some((v) => same(v, f.community)), detail: `The record says ${f.community || "no village"}.` };
  if (r.kind === "crop") {
    if (!f.crops?.length) return { ok: null, detail: "The record does not say what the farmer grows. Ask, and tick if they do." };
    return { ok: r.crops.some((c) => f.crops!.some((x) => same(c, x))), detail: `The record says ${f.crops.join(", ").toLowerCase()}.` };
  }
  const rate = contributionRate(r, f.gender);
  const value = packageValue(setup, f.hectares);
  const due = value === null ? `${pct(rate)} of the package's value` : `${pct(rate)} of $${value.toLocaleString("en-US")}, $${(Math.round(value * rate) / 100).toLocaleString("en-US")}`;
  // Paid is proof of agreeing; before it is paid, whether the farmer agreed is asked, not read.
  return f.contributionPaid ? { ok: true, detail: `Contribution paid (${due}).` } : { ok: null, detail: `Contribution due: ${due}. Not paid yet: tick if the farmer agreed.` };
}

/** Comma-separated names typed in a box, tidied: "Qala, deh-e nau ," becomes ["Qala", "deh-e nau"]. */
export const splitNames = (s: string) => [...new Set(s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))];
