import { PROJECT } from "@/lib/demo";

/**
 * A project's input package and season, as Field activities and the distribution checks use them.
 * Each project sets its own in Field activities (project_state "field-setup"); the demo project
 * A-2027 keeps the maize package it was built with.
 *
 * An item is bought on one budget line: the purchases on that line supply it, and the store's
 * stock, the goods-received gate and the purchase an approved distribution is charged to all follow
 * from that. The amount is per farmer, or per hectare of the farmer's plot.
 */

export type PackageItem = {
  /** Short id used in records and Kobo answers ("seed", "cuttings"). Letters, digits and _ only. */
  key: string;
  item: string;
  unit: string;
  qty: number;
  per: "farmer" | "hectare";
  budgetLine: string;
  /** Cost of one unit in USD, for the value of a package. Optional. */
  unitUsd?: number;
};

export type FieldSetup = {
  items: PackageItem[];
  /** Season name shown on records, e.g. "2027 spring planting". */
  season?: string;
  /** Where the store is and distributions happen. Farmers keep their own village. */
  village?: string;
  crop?: string;
  /** Last day of the planting window (YYYY-MM-DD). */
  windowEnd?: string;
  /**
   * The target that counts farmers who received the package (its code, e.g. "IND-2"). When set,
   * each distribution the project manager approves becomes one result for it, waiting for MEL
   * like any other result, so nobody types the same distribution in twice.
   */
  target?: string;
};

export const FIELD_SETUP_KEY = "field-setup";

/** The demo project's package and season (A-2027, fictional). */
export const DEMO_SETUP: FieldSetup = {
  items: [
    { key: "seed", item: "Certified maize seed", qty: 10, unit: "kg", per: "farmer", budgetLine: "2.1", unitUsd: 7.75 },
    { key: "npk", item: "NPK 17-17-17", qty: 50, unit: "kg", per: "farmer", budgetLine: "2.2", unitUsd: 2.6 },
  ],
  season: PROJECT.season,
  village: "Village B",
  crop: "Maize",
  windowEnd: "2027-03-20",
  target: "IND-2",
};

/** One farmer's share of an item, in the item's unit. */
export type DistItem = { key: string; item: string; unit: string; qty: number; budgetLine?: string };

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The package one farmer receives: per-hectare items scaled by the farmer's hectares. */
export function itemsFor(setup: FieldSetup, hectares = 1): DistItem[] {
  return setup.items.map((p) => ({ key: p.key, item: p.item, unit: p.unit, qty: round(p.per === "hectare" ? p.qty * (hectares > 0 ? hectares : 0) : p.qty), budgetLine: p.budgetLine }));
}

/** What one farmer's package is worth in USD, when the items have a unit cost. */
export const packageUsd = (setup: FieldSetup, hectares = 1) => itemsFor(setup, hectares).reduce((t, i) => t + i.qty * (setup.items.find((p) => p.key === i.key)?.unitUsd ?? 0), 0);

/** "10 kg certified maize seed and 50 kg NPK 17-17-17" (per-hectare items say so). */
export const describePackage = (setup: FieldSetup) =>
  setup.items.map((p) => `${fmtQty(p.qty)} ${p.unit} ${p.item}${p.per === "hectare" ? " per hectare" : ""}`).join(" and ");

export const fmtQty = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US");
/** "1 kit", "2 kits", "1 kg": a counted unit written in the plural loses its "s" for exactly one. */
export const qtyUnit = (n: number, unit: string) => `${fmtQty(n)} ${Math.abs(n - 1) < 1e-9 && /^[a-z]{3,}s$/i.test(unit) ? unit.slice(0, -1) : unit}`;

/** A quantity in kilograms, or null for a unit that is not a weight. */
export function toKg(qty: number, unit: string): number | null {
  const u = unit.trim().toLowerCase();
  if (u === "kg" || u === "kgs" || u === "kilogram" || u === "kilograms") return qty;
  if (u === "t" || u === "ton" || u === "tons" || u === "tonne" || u === "tonnes" || u === "mt") return qty * 1000;
  if (u === "g" || u === "grams") return qty / 1000;
  return null;
}

/** Unit names compared loosely: case, spaces and a plural "s" do not matter. */
const norm = (u: string) =>
  u
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(s|x|z|ch|sh)es$/, "$1")
    .replace(/([^s])s$/, "$1");

/**
 * A quantity in another unit: weights convert (t, kg, g); any other unit only to itself.
 * Null when the units cannot be compared (cuttings and hectares, kg and bags).
 */
export function convert(qty: number, from: string, to: string): number | null {
  const a = toKg(1, from);
  const b = toKg(1, to);
  if (a !== null && b !== null) return (qty * a) / b;
  if (a === null && b === null && norm(from) === norm(to)) return qty;
  return null;
}

const KEY_RE = /^[a-z][a-z0-9_]{0,29}$/;
/** A key from an item name: "Drip irrigation kit" → "drip_irrigation_kit". */
export const keyFrom = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "i$1")
    .slice(0, 30) || "item";

/** What is wrong with a setup, in words a manager can act on; null when it can be saved. */
export function setupProblem(s: FieldSetup): string | null {
  if (!s.items.length) return "Add at least one item to the package.";
  const keys = new Set<string>();
  for (const [n, p] of s.items.entries()) {
    const which = p.item.trim() || `Item ${n + 1}`;
    if (!p.item.trim()) return `Item ${n + 1} needs a name.`;
    if (!KEY_RE.test(p.key)) return `${which}: its short id can use only lowercase letters, digits and _.`;
    if (keys.has(p.key)) return `Two items share the short id "${p.key}". Give each item its own name.`;
    keys.add(p.key);
    if (!p.unit.trim()) return `${which} needs a unit (kg, cuttings, metres...).`;
    if (!(p.qty > 0)) return `${which} needs an amount above zero.`;
    if (!p.budgetLine.trim()) return `${which} needs the budget line it is bought on.`;
  }
  if (s.windowEnd && !/^\d{4}-\d{2}-\d{2}$/.test(s.windowEnd)) return "The planting window's last day must be a date.";
  if (s.target && !/^IND-\d+$/.test(s.target)) return "Choose the target from the list.";
  return null;
}
