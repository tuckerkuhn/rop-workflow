import { plantingValue, type CropPlan } from "@/lib/crops";
import { received } from "@/lib/connections";
import { convert, fmtQty as fmt, itemsFor, qtyItem, qtyUnit, type DistItem, type FieldSetup } from "@/lib/package";
import { receivedQty, stageLabels, stages, stepById, type Procurement } from "@/lib/procurement";
import type { ResultInput } from "@/lib/results";

export { toKg, convert, type DistItem } from "@/lib/package";

/**
 * The input distribution, field to finance (strategy brief, example 3). One distribution is one
 * farmer receiving the project's input package (lib/package). These rules are pure so the field
 * save, the Kobo sync and the approval all apply the same ones.
 *
 * - Blocked: nothing is handed out (in the app) or approved (from Kobo) until the purchase that
 *   supplies each item has its goods received note signed, and never more than was received.
 * - Flagged: what a person should look at before approving (same farmer twice, above plan,
 *   no photo of the signed list, recipient signature not confirmed, farmer not cleared as ready).
 *
 * Quantities are in each package item's own unit. A purchase bought in another unit converts when
 * both are weights (t, kg, g); otherwise the units must match, or the item is blocked with why.
 */

/** Amounts already handed out, by package item key, in the item's unit. */
export type Given = Record<string, number>;

/** The budget line an item is bought on: its own, or the project package's for older records. */
export const lineOf = (it: Pick<DistItem, "key" | "budgetLine">, setup: FieldSetup) => it.budgetLine ?? setup.items.find((p) => p.key === it.key)?.budgetLine ?? "";
/** The package unit of an item (older records may carry another unit). */
const unitOf = (it: Pick<DistItem, "key" | "unit">, setup: FieldSetup) => setup.items.find((p) => p.key === it.key)?.unit ?? it.unit;

/** Adds what a distribution took to the running totals, in each item's package unit. */
export function addGiven(given: Given, items: DistItem[], setup: FieldSetup): Given {
  for (const it of items) given[it.key] = (given[it.key] ?? 0) + (convert(it.qty, it.unit, unitOf(it, setup)) ?? it.qty);
  return given;
}

/** The purchases that supply an item: those bought on its budget line. */
export const suppliersOf = (line: string, procs: Procurement[]) => (line ? procs.filter((p) => (p.plan?.budgetCode ?? p.budgetLine) === line) : []);

/** What a purchase has received, in another unit; null when the units cannot be compared. */
const receivedIn = (p: Procurement, unit: string) => convert(receivedQty(p), p.unit, unit);

/**
 * The day a purchase's goods came into the store: when its goods received note was first signed.
 * Null when the record does not say (an older record): it is then counted whatever the date.
 */
export function receivedOn(p: Procurement): string | null {
  const signed = [...(p.payments ?? []).flatMap((r) => r.signatures?.["Goods received note"] ?? []), ...(p.signatures?.["Goods received note"] ?? [])];
  return signed.map((x) => x.date).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d ?? "")).map((d) => d.slice(0, 10)).sort()[0] ?? null;
}
/** The day a hand-out happened, with what hand-outs on or before that day had already taken (in package units). */
export type OnDay = {
  day: string;
  given?: Given;
  /**
   * Today's real date. A receipt dated after today cannot be a real one (a sample project's
   * records run on its own calendar): it is counted whatever the hand-out's date, as before.
   */
  today?: string;
};

export type GateLine = { key: string; item: string; unit: string; procurements: string[]; received: number; given: number; thisQty: number; ok: boolean; detail: string };
export type Gate = { ok: boolean; lines: GateLine[]; block: string | null };

/**
 * Whether this package may go out: each item's purchase has a signed goods received note, and what
 * was already given plus this package stays within what was received. `given` is what earlier
 * distributions of each item already took, in the package unit.
 */
export function gate(items: DistItem[], procs: Procurement[], given: Given, setup: FieldSetup, on?: OnDay): Gate {
  const lines = items.map((it): GateLine => {
    const line = lineOf(it, setup);
    const unit = unitOf(it, setup);
    const sources = suppliersOf(line, procs);
    const thisQty = convert(it.qty, it.unit, unit) ?? it.qty;
    const already = given[it.key] ?? 0;
    const base = { key: it.key, item: it.item, unit, procurements: sources.map((p) => p.id), given: already, thisQty };
    if (!sources.length) return { ...base, received: 0, ok: false, detail: `No purchase on budget line ${line || "(none set)"} supplies ${it.item}. Start one on the procurement calendar.` };
    const done = sources.filter((p) => received(p));
    if (!done.length) {
      const where = sources.map((p) => `${p.id} is at ${stageLabels[stepById[p.step]?.stage ?? 0] ?? p.step}`).join("; ");
      return { ...base, received: 0, ok: false, detail: `${it.item}: the goods received note is not signed yet (${where}).` };
    }
    const odd = done.filter((p) => receivedIn(p, unit) === null);
    if (odd.length) return { ...base, received: 0, ok: false, detail: `${it.item}: ${odd.map((p) => `${p.id} was bought in ${p.unit}`).join("; ")}, but the package gives ${unit}. Use the same unit in the package and the purchase.` };
    const got = done.reduce((s, p) => s + (receivedIn(p, unit) ?? 0), 0);
    if (already + thisQty > got + 1e-9) {
      // Say what would unblock it: a delivery that has arrived but whose received note is not signed yet.
      const coming = sources.filter((p) => !received(p) && stepById[p.step]?.id === "receive");
      const next = coming.length ? ` ${coming.map((p) => p.id).join(", ")} has been delivered: once its goods received note is signed, more can go out.` : "";
      const left = Math.max(0, got - already);
      return {
        ...base,
        received: got,
        ok: false,
        detail: left < 1e-9
          ? `${it.item}: none left in the store; all ${qtyUnit(got, unit)} received have gone out, and this package needs ${qtyUnit(thisQty, unit)}.${next || " More has to be bought and received (goods received note signed) before it can go out."}`
          : `${it.item}: this package needs ${qtyUnit(thisQty, unit)}, but only ${qtyUnit(left, unit)} of the ${qtyUnit(got, unit)} received is left.${next}`,
      };
    }
    // A hand-out draws only on what had arrived by its own day (review round 1, ISS-16): goods
    // received a week later cannot have supplied it, however much is in the store now.
    const late = on ? done.filter((p) => (receivedOn(p) ?? "") > on.day && (!on.today || receivedOn(p)! <= on.today)) : [];
    if (on && late.length) {
      const early = done.filter((p) => !late.includes(p));
      const gotThen = early.reduce((s, p) => s + (receivedIn(p, unit) ?? 0), 0);
      const takenThen = on.given?.[it.key] ?? already;
      const after = late.map((p) => `${p.id} on ${receivedOn(p)}`).join(", ");
      if (takenThen + thisQty > gotThen + 1e-9)
        return {
          ...base,
          received: gotThen,
          ok: false,
          detail: `${it.item}: this hand-out is dated ${on.day}, when only ${qtyUnit(Math.max(0, gotThen - takenThen), unit)} of the ${qtyUnit(gotThen, unit)} received by then was left, and it needs ${qtyUnit(thisQty, unit)}. More arrived later (${after}). Check the hand-out date.`,
        };
      return { ...base, received: gotThen, ok: true, detail: `${it.item}: ${fmt(takenThen + thisQty)} of ${fmt(gotThen)} ${unit} received by ${on.day} will have gone out (${early.map((p) => p.id).join(", ")}).` };
    }
    return { ...base, received: got, ok: true, detail: `${it.item}: ${fmt(already + thisQty)} of ${fmt(got)} ${unit} received will have gone out (${done.map((p) => p.id).join(", ")}).` };
  });
  // Nothing recorded as given is not a distribution: approving it would count the farmer as
  // supplied and move them on to planting with nothing in hand.
  if (!items.length) return { ok: false, lines, block: "No item is recorded as given. Send it back so the amounts can be corrected, or leave it unapproved if the farmer received nothing." };
  const bad = lines.filter((l) => !l.ok);
  return { ok: !bad.length, lines, block: bad.length ? bad.map((l) => l.detail).join(" ") : null };
}

/**
 * What is in the store for each package item, in the item's own unit: what the purchases on its
 * budget line have received (signed goods received notes), less what distributions have taken.
 * One figure for Field activities and for the gate, so the screen and the check never disagree.
 * Null when no purchase supplies the package at all (a project that keeps its stock by hand).
 */
export function storeStock(setup: FieldSetup, procs: Procurement[], given: Given): Record<string, number> | null {
  if (!setup.items.some((p) => suppliersOf(p.budgetLine, procs).length)) return null;
  return Object.fromEntries(
    setup.items.map((p) => {
      const got = suppliersOf(p.budgetLine, procs)
        .filter((x) => received(x))
        .reduce((t, x) => t + (receivedIn(x, p.unit) ?? 0), 0);
      return [p.key, Math.round(Math.max(0, got - (given[p.key] ?? 0)) * 1000) / 1000];
    }),
  );
}

/** The package for one farmer, planned: per-hectare items scaled by their hectares. */
export const plannedFor = (setup: FieldSetup, hectares?: number) => itemsFor(setup, hectares ?? 1);

/**
 * Who fixes a distribution the manager sent back: the person who recorded it when they can still
 * change field records on the project; otherwise the storekeeper, then the extension agent, so it
 * never lands with nobody. `people` are those on the project.
 */
export function fixOwner(recordedBy: string | null, people: { id: string; field: string[]; fieldAccess: string }[]): string | null {
  const can = people.filter((u) => u.fieldAccess === "edit");
  return can.find((u) => u.id === recordedBy)?.id ?? can.find((u) => u.field.includes("store"))?.id ?? can.find((u) => u.field.includes("extension"))?.id ?? null;
}

/** What the person fixing a sent-back distribution may correct. Quantities are in the items' own units. */
export type Fix = {
  qty?: Record<string, number>;
  signed?: boolean;
  photo?: boolean;
  /** The recipient accepted what was finally handed over in acceptable condition (damaged items replaced or left out). */
  conditionOk?: boolean;
};

/**
 * The items after a fix: a corrected quantity replaces the recorded one and anything else stays.
 * An item of the farmer's planned package that was recorded as not given can be added with its
 * amount (a Kobo record that left it out by mistake); an amount of zero takes an item out.
 */
export function applyFix(items: DistItem[], fix: Fix, planned: DistItem[] = []): DistItem[] {
  const valid = (q: unknown): q is number => typeof q === "number" && Number.isFinite(q) && q >= 0;
  const added = planned.filter((p) => !items.some((i) => i.key === p.key) && valid(fix.qty?.[p.key])).map((p) => ({ ...p, qty: fix.qty![p.key] }));
  return [...items.map((i) => (valid(fix.qty?.[i.key]) ? { ...i, qty: fix.qty![i.key] } : i)), ...added].filter((i) => i.qty > 0 || !(fix.qty && i.key in fix.qty));
}

/**
 * The purchase an approved item is drawn from: the oldest received purchase on the item's budget
 * line that still has enough left after its own distribution lists; when none has room for all of
 * it, the newest received one. Never a purchase whose goods received note is not signed: its
 * supplier has delivered nothing to pay for yet. `qty` is in `unit`.
 */
export function drawnFrom(line: string, qty: number, unit: string, procs: Procurement[]): Procurement | null {
  const got = suppliersOf(line, procs)
    .filter((p) => received(p))
    .sort((a, b) => a.id.localeCompare(b.id));
  const left = (p: Procurement) => (receivedIn(p, unit) ?? 0) - (convert((p.distribution?.lists ?? []).reduce((t, l) => t + l.qty, 0), p.unit, unit) ?? 0);
  return got.find((p) => left(p) + 1e-9 >= qty) ?? got.at(-1) ?? null;
}

/**
 * Whether the purchase still has a payment for finance to release: its goods are received and it
 * is between Receive and the payment itself. A purchase already paid or closed gets no task.
 */
export const paymentDue = (p: Pick<Procurement, "step">) => stepById[p.step]?.stage === stages.indexOf("Pay-ready") && p.step !== "paid";

/** A quantity in a purchase's own unit, for its distribution list. */
export const inProcUnit = (qty: number, unit: string, p: Pick<Procurement, "unit">) => convert(qty, unit, p.unit) ?? qty;

export type FlagId = "twice" | "aboveplan" | "nothing" | "nophoto" | "unsigned" | "notready";
export type Flag = { id: FlagId; text: string };

/**
 * What to look at before approving. `others` are the farmer codes of every other distribution not
 * sent back; `planned` is this farmer's package as planned.
 */
export function flagsFor(d: { farmerId: string; items: DistItem[]; photo: boolean; signed: boolean; step: string | null }, others: string[], planned: DistItem[]): Flag[] {
  const out: Flag[] = [];
  if (others.includes(d.farmerId)) out.push({ id: "twice", text: `${d.farmerId} already has a distribution recorded this season.` });
  if (!d.items.length) out.push({ id: "nothing", text: "No item is recorded as given: check whether this farmer received anything." });
  for (const it of d.items) {
    const p = planned.find((x) => x.key === it.key);
    const asPlanned = p ? convert(it.qty, it.unit, p.unit) : null;
    if (p && asPlanned !== null && asPlanned > p.qty + 1e-9) out.push({ id: "aboveplan", text: `${it.item}: ${fmt(it.qty)} ${it.unit} given; the package plans ${fmt(p.qty)} ${p.unit}.` });
  }
  if (!d.photo) out.push({ id: "nophoto", text: "No photo of the signed goods received note." });
  if (!d.signed) out.push({ id: "unsigned", text: "The recipient's signature or thumbprint is not confirmed." });
  // In the app the farmer has just moved on from "distribute"; from Kobo they should be at it.
  if (d.step !== null && !["distribute", "plant", "complete"].includes(d.step)) out.push({ id: "notready", text: `${d.farmerId} has not been cleared as ready (their step is "${d.step}").` });
  return out;
}

/* ---------- an approved distribution counts toward a target ---------- */

/**
 * The result an approved distribution adds to the project's target for farmers who received the
 * package: one farmer, on the day it was given, with the distribution record as its proof. Made
 * from the record the storekeeper already entered, so the same distribution is never typed in a
 * second time on the Results page. The farmer is named by number and village only.
 */
export function resultFor(d: { id: string; farmerId: string; village?: string; gender?: string; date: string; items: DistItem[]; recordedBy: string; approvedBy: string }, target: string): ResultInput {
  const given = d.items.filter((i) => i.qty > 0).map((i) => qtyItem(i.qty, i.unit, i.item)).join(", ");
  return {
    indicator: target,
    date: d.date,
    value: 1,
    ...(d.gender === "Female" ? { female: 1, male: 0 } : d.gender === "Male" ? { female: 0, male: 1 } : {}),
    ...(d.village ? { district: d.village.slice(0, 80) } : {}),
    note: `Input package given to farmer ${d.farmerId}${d.village ? ` in ${d.village}` : ""}: ${given || "the planned package"}. Recorded by ${d.recordedBy}, approved by ${d.approvedBy}.`.slice(0, 2000),
    files: [],
    noFile: "The proof is the distribution record in Field activities, checked and approved by the project manager.",
    distribution: d.id,
  };
}

/**
 * The result a farmer's recorded planting adds to the project's target, when the target counts at
 * planting (lib/package targetAt): one farmer, on the day they planted, with the planting record as
 * its proof. The farmer is named by number and village only.
 */
export function resultForPlanting(
  f: { id: string; community?: string; gender?: string; planting: { date: string; hectares: number; count?: number } },
  target: string,
  o: { crop?: string; recordedBy: string; unit?: string; plan?: CropPlan | null },
): ResultInput {
  // What it adds follows the target's unit: hectares, plants counted, or one farmer (lib/crops).
  const { value, people } = plantingValue(o.unit ?? "", f.planting, o.plan);
  const what = `${f.planting.count !== undefined ? `${f.planting.count.toLocaleString("en-US")} ${o.plan?.unit ?? "plants"} on ` : ""}${f.planting.hectares} ha`;
  return {
    indicator: target,
    date: f.planting.date,
    value,
    ...(people && f.gender === "Female" ? { female: 1, male: 0 } : people && f.gender === "Male" ? { female: 0, male: 1 } : {}),
    ...(f.community ? { district: f.community.slice(0, 80) } : {}),
    note: `Farmer ${f.id}${f.community ? ` in ${f.community}` : ""} planted ${what}${o.crop ? ` of ${o.crop.toLowerCase()}` : ""} on ${f.planting.date}. Recorded by ${o.recordedBy}.`.slice(0, 2000),
    files: [],
    noFile: "The proof is the farmer's planting record in Field activities, after the approved distribution.",
    planting: f.id,
  };
}

/* ---------- who approves a distribution, and when it may close ---------- */

type Approver = { id: string; name: string; field: string[]; reportsTo?: string; kind?: string };

/**
 * The people who may approve or send back a distribution: the project's managers, never the person
 * who recorded it in the app or collected it in KoboCollect. Nobody approves their own work. When
 * that leaves nobody (the recorder is the only manager), it goes to the person the recorder
 * reports to. `people` are those on the project; `recorder` is a person id, or null when unknown.
 */
export function approversOf<P extends Approver>(people: P[], recorder: string | null): P[] {
  const staff = people.filter((p) => (p.kind ?? "employee") === "employee");
  const managers = staff.filter((p) => p.field.includes("manager"));
  const others = managers.filter((p) => p.id !== recorder);
  if (others.length || !recorder || !managers.some((p) => p.id === recorder)) return others;
  const boss = staff.find((p) => p.id === managers.find((m) => m.id === recorder)?.reportsTo);
  return boss ? [boss] : [];
}

/** "Nadia Rahimi", "Nadia Rahimi or Karim Ahmadi", or what to do when nobody can. */
export function approverNamesOf(people: Approver[], recorder: string | null): string {
  const names = approversOf(people, recorder).map((p) => p.name);
  if (!names.length) return people.some((p) => p.field.includes("manager")) ? "nobody yet (add a second project manager, or set who the recorder reports to in the staff list)" : "nobody yet (no project manager is on this project)";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/** Why this person may not decide this distribution, in words; null when they may. */
export function approvalRefusal(by: string, people: Approver[], recorder: string | null): string | null {
  if (approversOf(people, recorder).some((p) => p.id === by)) return null;
  const who = approverNamesOf(people, recorder);
  return by === recorder ? `You recorded this distribution, so someone else approves it: ${who}.` : `Only ${who} can approve this distribution or send it back.`;
}

/** What the recipient signs, in one sentence: used on the approval page and wherever the rule is explained. */
export const ACKNOWLEDGMENT = "The recipient signs or thumbprints a note saying they received the goods in acceptable condition and are responsible for them from then on.";

/** Condition answers that mean the goods were accepted as they should be. Anything else recorded is not. */
const ACCEPTABLE = ["good", "acceptable"];
/** The recorded condition when it was not acceptable; null when it was, or when none was recorded. */
export const badCondition = (c: string | null | undefined) => (c && !ACCEPTABLE.includes(c) ? c : null);

/**
 * Why a distribution cannot close yet, apart from the goods received checks. For any distribution
 * of goods the recipient signs a document acknowledging they received the goods in acceptable
 * condition and take responsibility for them from then on. A distribution is closed by its
 * approval, so it is not approved while:
 *  - the signature or thumbprint is not confirmed;
 *  - the condition recorded at handover was not acceptable (a damaged package is not accepted);
 *  - there is no photo of the signed note: the image question on the KoboCollect form, or the
 *    photo the recorder takes at the Distribute step in the app. The photo is the document on file.
 * Null when it may be approved.
 */
export function closeBlock(d: { signed: boolean; photo?: boolean; source?: "app" | "kobo"; condition?: string | null }): string | null {
  const back = "Send it back so the person who recorded it can put it right; then it can be approved.";
  if (!d.signed) return `The recipient's signature or thumbprint on the goods received note is not confirmed. ${ACKNOWLEDGMENT} ${back}`;
  if (badCondition(d.condition)) return `The goods were recorded as damaged at handover, so the recipient has not accepted them in acceptable condition. ${back}`;
  if (d.photo === false) return `There is no photo of the signed goods received note. ${ACKNOWLEDGMENT} The photo is the proof. ${back}`;
  return null;
}
