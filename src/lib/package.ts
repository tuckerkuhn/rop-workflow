import type { CropPlan } from "@/lib/crops";
import type { Curriculum } from "@/lib/field-training";
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

/**
 * One package a farmer can choose (Tucker, 28 Nov: a project may offer several, for example by
 * the climate risk on the farmer's plot). It names items from the project's list; each item is
 * still bought on its own budget line, so stock and purchases are unchanged.
 */
export type PackageOption = { key: string; name: string; /** Who it is for, in a few words. */ why?: string; items: string[] };

export type FieldSetup = {
  /** Every item the project hands out. With no `packages`, every farmer gets all of them. */
  items: PackageItem[];
  /** The packages farmers choose between; none or one means everyone gets the same package. */
  packages?: PackageOption[];
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
  /**
   * When a farmer counts toward the target: when their package is handed out and approved (the
   * default), or when their planting is recorded, for a target such as "trellis systems
   * installed" that is met in the field rather than at the store.
   */
  targetAt?: "distribution" | "planting";
  /** MF-10: the share of farmers drawn each month for a verification visit, 0.02 to 0.05 (0.03 when not set). */
  verifyRate?: number;
  /** MF-04: a farmer whose package is worth more than this (USD) is screened before it goes out; $50 when not set. */
  screenAboveUsd?: number;
  /** The farmer training curriculum and its version (MF-09): every training record carries it. */
  curriculum?: Curriculum;
  /** The project's crop plan (lib/crops), from the project design. Read only here; set in Set up → Crop. */
  plan?: CropPlan;
};

/** Whether the target counts farmers at planting rather than at the approved distribution. */
export const countsAtPlanting = (s: Pick<FieldSetup, "target" | "targetAt"> | null | undefined) => !!s?.target && s.targetAt === "planting";

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

/** The package option with this key, or null (none chosen, or the project has one package). */
export const packageOption = (setup: Pick<FieldSetup, "packages"> | null | undefined, key: string | null | undefined): PackageOption | null => (key ? (setup?.packages?.find((p) => p.key === key) ?? null) : null);
/** Whether farmers choose between packages on this project. */
export const choosesPackage = (setup: Pick<FieldSetup, "packages"> | null | undefined) => (setup?.packages?.length ?? 0) > 1;

/**
 * The package one farmer receives: per-hectare items scaled by the farmer's hectares. `pkg`: the
 * package they chose; with none chosen (or a project with one package) every item.
 */
export function itemsFor(setup: FieldSetup, hectares = 1, pkg?: string | null): DistItem[] {
  const opt = packageOption(setup, pkg);
  return setup.items.filter((p) => !opt || opt.items.includes(p.key)).map((p) => ({ key: p.key, item: p.item, unit: p.unit, qty: round(p.per === "hectare" ? p.qty * (hectares > 0 ? hectares : 0) : p.qty), budgetLine: p.budgetLine }));
}

/** What one farmer's package is worth in USD, when the items have a unit cost. */
export const packageUsd = (setup: FieldSetup, hectares = 1, pkg?: string | null) => itemsFor(setup, hectares, pkg).reduce((t, i) => t + i.qty * (setup.items.find((p) => p.key === i.key)?.unitUsd ?? 0), 0);

/** "10 kg certified maize seed and 50 kg NPK 17-17-17" (per-hectare items say so). */
export const describePackage = (setup: FieldSetup) =>
  setup.items.map((p) => `${qtyItem(p.qty, p.unit, p.item)}${p.per === "hectare" ? " per hectare" : ""}`).join(" and ");

export const fmtQty = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US");
/** "1 kit", "2 kits", "1 kg": a counted unit written in the plural loses its "s" for exactly one. */
/**
 * "1 Trellis kit", "4 Trellis kits", "10 kg Certified maize seed": when the item's name already ends
 * in its unit, the unit is not said twice.
 */
export function qtyItem(n: number, unit: string, item: string): string {
  const one = (w: string) => w.toLowerCase().replace(/s$/, "");
  const words = item.trim().split(/\s+/);
  const last = words.at(-1) ?? "";
  if (last && one(last) === one(unit) && /^[a-z]{3,}$/i.test(unit)) {
    const plural = Math.abs(n - 1) < 1e-9 ? last.replace(/s$/i, "") : /s$/i.test(last) ? last : `${last}s`;
    return `${fmtQty(n)} ${[...words.slice(0, -1), plural].join(" ")}`;
  }
  return `${qtyUnit(n, unit)} ${item}`;
}
/** The unit alone, "farmer" for one and "farmers" otherwise: for a number shown on its own. */
/** A plural ending in a plain "s" ("kits", "farmers"), not a word that ends in s ("trellis", "glass", "bus"). */
const pluralS = (w: string) => /^[a-z]{3,}s$/i.test(w) && !/(is|ss|us)$/i.test(w);
export const unitOf = (n: number, unit: string) => (Math.abs(n - 1) < 1e-9 && pluralS(unit) ? unit.slice(0, -1) : unit);
export const qtyUnit = (n: number, unit: string) => `${fmtQty(n)} ${unitOf(n, unit)}`;

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
  const pkgKeys = new Set<string>();
  for (const [n, o] of (s.packages ?? []).entries()) {
    const which = o.name.trim() || `Package ${n + 1}`;
    if (!o.name.trim()) return `Package ${n + 1} needs a name.`;
    if (!KEY_RE.test(o.key)) return `${which}: its short id can use only lowercase letters, digits and _.`;
    if (pkgKeys.has(o.key)) return `Two packages share the short id "${o.key}". Give each package its own name.`;
    pkgKeys.add(o.key);
    if (!o.items.length) return `${which} has no items. Tick at least one.`;
    const unknown = o.items.find((k) => !keys.has(k));
    if (unknown) return `${which} names an item that is not in the list above ("${unknown}").`;
  }
  if (s.windowEnd && !/^\d{4}-\d{2}-\d{2}$/.test(s.windowEnd)) return "The planting window's last day must be a date.";
  if (s.target && !/^IND-\d+$/.test(s.target)) return "Choose the target from the list.";
  return null;
}
