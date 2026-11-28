import { z } from "zod";
import type { FieldSetup } from "@/lib/package";

/**
 * Eligibility rules the app checks against each farmer's record (MF-12, decisions D-21 and D-22):
 * land size, where the farmer lives, what they grow, and the contribution they agree to, with a
 * lower rate for women allowed. Set per project (one project is one intervention), as rules in
 * Farmer selection (lib/selection): each becomes one rule there, with its words written from the
 * numbers, so a change to a number is a change of rules, versioned like any other.
 */

/** `package`: the rule is for farmers who chose that package only (Tucker, 28 Nov); none, for everyone. */
export type Rule = (
  | { kind: "land"; min?: number; max?: number }
  | { kind: "location"; villages: string[] }
  | { kind: "crop"; crops: string[] }
  /** Percent of the package's value the farmer contributes; `womenRate` for women farmers when it differs. */
  | { kind: "contribution"; rate: number; womenRate?: number }
) & { package?: string };

export const RULE_KINDS = ["land", "location", "crop", "contribution"] as const;

const names = z.array(z.string().trim().min(1).max(80)).min(1).max(100);
const pkg = z.string().regex(/^[a-z][a-z0-9_]{0,29}$/).optional();
export const ruleSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("land"), package: pkg, min: z.number().min(0).max(10000).optional(), max: z.number().min(0).max(10000).optional() })
    .refine((r) => r.min !== undefined || r.max !== undefined, "Give the smallest or the largest plot, or both.")
    .refine((r) => r.min === undefined || r.max === undefined || r.min <= r.max, "The smallest plot is larger than the largest."),
  z.object({ kind: z.literal("location"), package: pkg, villages: names }),
  z.object({ kind: z.literal("crop"), package: pkg, crops: names }),
  z.object({ kind: z.literal("contribution"), package: pkg, rate: z.number().min(0).max(100), womenRate: z.number().min(0).max(100).optional() }),
]);

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);
const ha = (n: number) => `${n} ${n === 1 ? "hectare" : "hectares"}`;
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/** The rule in words, as Farmer selection lists it; a package's rule starts with the package's name. */
export function ruleText(r: Rule, packageName?: string): string {
  return r.package ? `${packageName ?? r.package} package: ${lower(words(r))}` : words(r);
}
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
function words(r: Rule): string {
  if (r.kind === "land") {
    if (r.min !== undefined && r.max !== undefined) return `Farms between ${r.min} and ${r.max} hectares`;
    return r.min !== undefined ? `Farms at least ${ha(r.min)}` : `Farms no more than ${ha(r.max!)}`;
  }
  if (r.kind === "location") return `Lives in ${list(r.villages)}`;
  if (r.kind === "crop") return `Grows ${list(r.crops.map((c) => c.toLowerCase()))} now`;
  return `Agrees to contribute ${pct(r.rate)} of the package's value${r.womenRate !== undefined && r.womenRate !== r.rate ? ` (${pct(r.womenRate)} for women)` : ""}`;
}

/** The rate this farmer contributes at: the women's rate for a woman when one is set. */
export const contributionRate = (r: { rate: number; womenRate?: number }, gender: string) => (gender === "Female" && r.womenRate !== undefined ? r.womenRate : r.rate);

/** The package's value for one farmer in USD, or null when an item has no unit cost. `pkg`: the package they chose. */
export function packageValue(setup: Pick<FieldSetup, "items" | "packages"> | null | undefined, hectares: number, pkg?: string | null): number | null {
  if (!setup?.items.length) return null;
  const opt = pkg ? setup.packages?.find((p) => p.key === pkg) : undefined;
  let usd = 0;
  for (const i of setup.items.filter((x) => !opt || opt.items.includes(x.key))) {
    if (i.unitUsd === undefined) return null;
    usd += i.qty * (i.per === "hectare" ? hectares : 1) * i.unitUsd;
  }
  return Math.round(usd * 100) / 100;
}

export type RecordFacts = { gender: string; hectares: number; community: string; crops?: string[]; contributionPaid: boolean; package?: string };
/** What the record says about one rule: met, not met, or not something the record can tell (null). */
export type RuleCheck = { ok: boolean | null; detail: string };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function ruleCheck(r: Rule, f: RecordFacts, setup?: Pick<FieldSetup, "items" | "packages"> | null): RuleCheck {
  // Another package's rule does not apply to this farmer: met, and said so.
  if (r.package && f.package !== r.package) {
    const name = (k?: string) => setup?.packages?.find((p) => p.key === k)?.name ?? k;
    return { ok: true, detail: `Only for the ${name(r.package)} package; ${f.package ? `this farmer chose ${name(f.package)}` : "this farmer has no package recorded"}.` };
  }
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
  const value = packageValue(setup, f.hectares, f.package);
  const due = value === null ? `${pct(rate)} of the package's value` : `${pct(rate)} of $${value.toLocaleString("en-US")}, $${(Math.round(value * rate) / 100).toLocaleString("en-US")}`;
  // Paid is proof of agreeing; before it is paid, whether the farmer agreed is asked, not read.
  return f.contributionPaid ? { ok: true, detail: `Contribution paid (${due}).` } : { ok: null, detail: `Contribution due: ${due}. Not paid yet: tick if the farmer agreed.` };
}

/** Comma-separated names typed in a box, tidied: "Qala, deh-e nau ," becomes ["Qala", "deh-e nau"]. */
export const splitNames = (s: string) => [...new Set(s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))];
