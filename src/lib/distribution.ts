import { received } from "@/lib/connections";
import { PACKAGE } from "@/lib/field";
import { receivedQty, stages, stepById, type Procurement } from "@/lib/procurement";

/**
 * The input distribution, field to finance (strategy brief, example 3). One distribution is one
 * farmer receiving the input package. These rules are pure so the field save, the Kobo sync and
 * the approval all apply the same ones.
 *
 * - Blocked: nothing is handed out (in the app) or approved (from Kobo) until the purchase that
 *   supplies each item has its goods received note signed, and never more than was received.
 * - Flagged: what a person should look at before approving (same farmer twice, above plan,
 *   no photo of the signed list, recipient signature not confirmed, farmer not cleared as ready).
 */

export type PackageKey = (typeof PACKAGE)[number]["key"];
/** The budget line each package item is bought on: the purchase that supplies it is found by its line. */
export const PACKAGE_LINES: Record<PackageKey, string> = { seed: "2.1", npk: "2.2" };

export type DistItem = { key: PackageKey; item: string; unit: string; qty: number };
/** The planned package, as items. */
export const plannedItems = (): DistItem[] => PACKAGE.map((p) => ({ key: p.key, item: p.item, unit: p.unit, qty: p.qty }));

/** A quantity in kilograms, or null for a unit that is not a weight. */
export function toKg(qty: number, unit: string): number | null {
  const u = unit.trim().toLowerCase();
  if (u === "kg" || u === "kgs" || u === "kilogram" || u === "kilograms") return qty;
  if (u === "t" || u === "ton" || u === "tons" || u === "tonne" || u === "tonnes" || u === "mt") return qty * 1000;
  if (u === "g" || u === "grams") return qty / 1000;
  return null;
}
const fromKg = (kg: number, unit: string) => {
  const per = toKg(1, unit);
  return per ? kg / per : kg;
};

/** The purchases that supply an item: those bought on its budget line. */
export const suppliersOf = (key: PackageKey, procs: Procurement[]) => procs.filter((p) => (p.plan?.budgetCode ?? p.budgetLine) === PACKAGE_LINES[key]);

export type GateLine = { key: PackageKey; item: string; procurements: string[]; receivedKg: number; givenKg: number; thisKg: number; ok: boolean; detail: string };
export type Gate = { ok: boolean; lines: GateLine[]; block: string | null };

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US");

/**
 * Whether this package may go out: each item's purchase has a signed goods received note, and what
 * was already given plus this package stays within what was received. `givenKg` is what earlier
 * distributions of each item already took, in kg.
 */
export function gate(items: DistItem[], procs: Procurement[], givenKg: Partial<Record<PackageKey, number>>): Gate {
  const lines = items.map((it): GateLine => {
    const sources = suppliersOf(it.key, procs);
    const thisKg = toKg(it.qty, it.unit) ?? it.qty;
    const given = givenKg[it.key] ?? 0;
    const base = { key: it.key, item: it.item, procurements: sources.map((p) => p.id), givenKg: given, thisKg };
    if (!sources.length) return { ...base, receivedKg: 0, ok: false, detail: `No purchase on budget line ${PACKAGE_LINES[it.key]} supplies ${it.item}. Start one on the procurement calendar.` };
    const done = sources.filter((p) => received(p));
    if (!done.length) {
      const where = sources.map((p) => `${p.id} is at ${stages[stepById[p.step]?.stage ?? 0] ?? p.step}`).join("; ");
      return { ...base, receivedKg: 0, ok: false, detail: `${it.item}: the goods received note is not signed yet (${where}).` };
    }
    const receivedKg = done.reduce((s, p) => s + (toKg(receivedQty(p), p.unit) ?? 0), 0);
    if (given + thisKg > receivedKg + 1e-9)
      return { ...base, receivedKg, ok: false, detail: `${it.item}: this package needs ${fmt(thisKg)} kg, but only ${fmt(Math.max(0, receivedKg - given))} kg of the ${fmt(receivedKg)} kg received is left.` };
    return { ...base, receivedKg, ok: true, detail: `${it.item}: ${fmt(given + thisKg)} of ${fmt(receivedKg)} kg received will have gone out (${done.map((p) => p.id).join(", ")}).` };
  });
  const bad = lines.filter((l) => !l.ok);
  return { ok: !bad.length, lines, block: bad.length ? bad.map((l) => l.detail).join(" ") : null };
}

/** A procurement's distribution list entry quantity, in its own unit. */
export const inProcUnit = (kg: number, p: Pick<Procurement, "unit">) => fromKg(kg, p.unit);

export type FlagId = "twice" | "aboveplan" | "nophoto" | "unsigned" | "notready";
export type Flag = { id: FlagId; text: string };

/** What to look at before approving. `others` are the farmer codes of every other distribution not sent back. */
export function flagsFor(d: { farmerId: string; items: DistItem[]; photo: boolean; signed: boolean; step: string | null }, others: string[]): Flag[] {
  const out: Flag[] = [];
  if (others.includes(d.farmerId)) out.push({ id: "twice", text: `${d.farmerId} already has a distribution recorded this season.` });
  const plan = plannedItems();
  for (const it of d.items) {
    const p = plan.find((x) => x.key === it.key);
    const planKg = p ? toKg(p.qty, p.unit) : null;
    const kg = toKg(it.qty, it.unit);
    if (p && planKg !== null && kg !== null && kg > planKg + 1e-9) out.push({ id: "aboveplan", text: `${it.item}: ${fmt(it.qty)} ${it.unit} given; the package plans ${fmt(p.qty)} ${p.unit}.` });
  }
  if (!d.photo) out.push({ id: "nophoto", text: "No photo of the signed recipient list." });
  if (!d.signed) out.push({ id: "unsigned", text: "The recipient's signature or thumbprint is not confirmed." });
  // In the app the farmer has just moved on from "distribute"; from Kobo they should be at it.
  if (d.step !== null && !["distribute", "plant", "complete"].includes(d.step)) out.push({ id: "notready", text: `${d.farmerId} has not been cleared as ready (their step is "${d.step}").` });
  return out;
}
