import { describe, expect, it } from "vitest";
import { addGiven, applyFix, convert, drawnFrom, fixOwner, paymentDue, flagsFor, gate as gateFor, inProcUnit, storeStock as stockFor, toKg, resultFor } from "@/lib/distribution";
import { resultSchema } from "@/lib/results";
import { DEMO_SETUP, itemsFor, type FieldSetup } from "@/lib/package";
import { seedProcurements } from "@/lib/procurement";
import type { Procurement } from "@/lib/procurement";

const proc = (over: Partial<Procurement>): Procurement =>
  ({ id: "PR-1", title: "Seed", qty: 2400, unit: "kg", unitPrice: 7.75, budgetLine: "2.1", activity: "", step: "need", signatures: {}, checks: {}, issues: [], timeline: [], ...over }) as unknown as Procurement;
const got = (qty: number) => ({ step: "done", grn: { qty } }) as unknown as Partial<Procurement>;

const S = DEMO_SETUP;
const plannedItems = () => itemsFor(S);
const gate = (items: Parameters<typeof gateFor>[0], procs: Procurement[], given: Record<string, number>) => gateFor(items, procs, given, S);
const storeStock = (procs: Procurement[], given: Record<string, number>) => stockFor(S, procs, given);

const seedIn = (qty: number) => proc({ id: "PR-SEED", ...got(qty) });
const npkIn = (tonnes: number) => proc({ id: "PR-NPK", unit: "t", budgetLine: "2.2", ...got(tonnes) });

describe("toKg", () => {
  it("converts weights and refuses other units", () => {
    expect(toKg(2, "t")).toBe(2000);
    expect(toKg(10, "kg")).toBe(10);
    expect(toKg(3, "bags")).toBeNull();
  });
});

describe("gate: nothing goes out before the goods received note", () => {
  it("blocks when an item's purchase is not past Receive", () => {
    const g = gate(plannedItems(), [proc({ id: "PR-SEED", step: "contract" }), npkIn(1)], {});
    expect(g.ok).toBe(false);
    expect(g.block).toMatch(/goods received note is not signed/);
    expect(g.lines.find((l) => l.key === "npk")?.ok).toBe(true);
  });

  it("blocks when no purchase is on the item's budget line", () => {
    const g = gate(plannedItems(), [seedIn(100)], {});
    expect(g.ok).toBe(false);
    expect(g.block).toMatch(/budget line 2.2/);
  });

  it("passes when received covers what was given plus this package", () => {
    const g = gate(plannedItems(), [seedIn(100), npkIn(1)], { seed: 80, npk: 900 });
    expect(g.ok).toBe(true);
  });

  it("blocks handing out more than was received", () => {
    const g = gate(plannedItems(), [seedIn(100), npkIn(1)], { seed: 95 });
    expect(g.ok).toBe(false);
    expect(g.block).toMatch(/only 5 kg/);
  });

  it("reports a distribution list quantity in the purchase's own unit", () => {
    expect(inProcUnit(50, "kg", { unit: "t" })).toBeCloseTo(0.05);
    expect(inProcUnit(10, "kg", { unit: "kg" })).toBe(10);
  });
});

describe("flagsFor", () => {
  const base = { farmerId: "F-0001", items: plannedItems(), photo: true, signed: true, step: "distribute" };
  it("is clean for a normal package", () => {
    expect(flagsFor(base, [], plannedItems())).toEqual([]);
  });
  it("flags the same farmer twice, above plan, no photo, unsigned, not cleared", () => {
    const items = plannedItems().map((i) => (i.key === "seed" ? { ...i, qty: 15 } : i));
    const ids = flagsFor({ ...base, items, photo: false, signed: false, step: "verify" }, ["F-0001"], plannedItems()).map((f) => f.id);
    expect(ids).toEqual(["twice", "aboveplan", "nophoto", "unsigned", "notready"]);
  });
});

describe("gate: says what would unblock a refusal", () => {
  it("names a delivery that has arrived but is not signed for yet", () => {
    const waiting = proc({ id: "PR-LOT2", unit: "kg", budgetLine: "2.2", step: "receive", grn: { qty: 600, place: "" } } as Partial<Procurement>);
    const g = gate(plannedItems(), [seedIn(100), proc({ id: "PR-LOT1", unit: "kg", budgetLine: "2.2", ...got(100) }), waiting], { npk: 100 });
    expect(g.ok).toBe(false);
    expect(g.block).toMatch(/none left in the store; all 100 kg received have gone out, and this package needs 50 kg/);
    expect(g.block).toMatch(/PR-LOT2 has been delivered: once its goods received note is signed/);
  });
});

describe("storeStock: one figure for the store, from the purchases", () => {
  it("is what was received on signed notes less what went out, in the package's unit", () => {
    expect(storeStock([seedIn(400), npkIn(0.7)], { seed: 20, npk: 100 })).toEqual({ seed: 380, npk: 600 });
  });
  it("does not count a delivery whose received note is not signed", () => {
    expect(storeStock([seedIn(400), proc({ id: "PR-NPK", unit: "kg", budgetLine: "2.2", step: "receive", grn: { qty: 600, place: "" } } as Partial<Procurement>)], {})).toEqual({ seed: 400, npk: 0 });
  });
  it("never goes below zero", () => {
    expect(storeStock([seedIn(10), npkIn(1)], { seed: 30 })?.seed).toBe(0);
  });
  it("is null when no purchase supplies the package, so a typed stock is kept", () => {
    expect(storeStock([proc({ budgetLine: "9.9" })], {})).toBeNull();
  });
  it("agrees with the gate on the demo project: enough seed, fertilizer waiting on one signature", () => {
    const procs = seedProcurements();
    // Two farmers already have their package (F-0001 and F-0002).
    const given = { seed: 20, npk: 100 };
    expect(storeStock(procs, given)).toEqual({ seed: 380, npk: 0 });
    const g = gate(plannedItems(), procs, given);
    expect(g.lines.find((l) => l.key === "seed")?.ok).toBe(true);
    expect(g.lines.find((l) => l.key === "npk")?.ok).toBe(false);
    expect(g.block).toMatch(/PR-2027-011 has been delivered/);
  });
});

describe("fixOwner: a sent-back distribution returns to its owner", () => {
  const people = [
    { id: "nadia", field: ["manager"], fieldAccess: "edit" },
    { id: "farida", field: ["extension"], fieldAccess: "edit" },
    { id: "bilal", field: ["store"], fieldAccess: "edit" },
    { id: "karim", field: [], fieldAccess: "view" },
  ];
  it("goes to the person who recorded it", () => {
    expect(fixOwner("farida", people)).toBe("farida");
  });
  it("goes to the storekeeper when it came from a phone or the recorder cannot change records", () => {
    expect(fixOwner("kobo_user_7", people)).toBe("bilal");
    expect(fixOwner("karim", people)).toBe("bilal");
    expect(fixOwner(null, people)).toBe("bilal");
  });
  it("falls back to the extension agent, and to nobody only when no one can fix it", () => {
    expect(fixOwner(null, people.filter((u) => u.id !== "bilal"))).toBe("farida");
    expect(fixOwner(null, [people[3]])).toBeNull();
  });
});

describe("applyFix", () => {
  it("replaces only the quantities that were corrected", () => {
    const out = applyFix(plannedItems(), { qty: { seed: 8 } });
    expect(out.find((i) => i.key === "seed")?.qty).toBe(8);
    expect(out.find((i) => i.key === "npk")?.qty).toBe(50);
  });
  it("ignores a quantity that is not a number or is negative", () => {
    expect(applyFix(plannedItems(), { qty: { seed: -1, npk: Number.NaN } })).toEqual(plannedItems());
  });
});

describe("drawnFrom: an approved item is charged to a purchase that has received goods", () => {
  const lot = (id: string, over: Partial<Procurement>) => proc({ id, unit: "kg", budgetLine: "2.2", ...over });
  const listed = (qty: number) => ({ forParticipants: true, inStock: 0, checks: [], lists: [{ date: "2027-03-01", place: "Village B", recipients: 1, women: 0, qty, evidence: "", by: "nadia", byName: "Nadia" }] }) as unknown as Procurement["distribution"];
  it("never picks a purchase whose goods received note is not signed", () => {
    const procs = [lot("PR-A", { step: "contract" }), lot("PR-B", got(600))];
    expect(drawnFrom("2.2", 50, "kg", procs)?.id).toBe("PR-B");
  });
  it("uses the oldest received purchase with enough left, then moves to the next", () => {
    const procs = [lot("PR-1", { ...got(100), distribution: listed(100) }), lot("PR-2", got(600))];
    expect(drawnFrom("2.2", 50, "kg", procs)?.id).toBe("PR-2");
    expect(drawnFrom("2.2", 50, "kg", [lot("PR-1", { ...got(100), distribution: listed(50) }), lot("PR-2", got(600))])?.id).toBe("PR-1");
  });
  it("is null when nothing on the line has been received", () => {
    expect(drawnFrom("2.2", 50, "kg", [lot("PR-A", { step: "receive" })])).toBeNull();
  });
});

describe("paymentDue: finance is asked to pay only when a payment is left", () => {
  it("is due between the received note and the payment", () => {
    for (const step of ["package", "payForm", "payReady", "approvePay", "voucher"]) expect(paymentDue({ step })).toBe(true);
  });
  it("is not due before goods are received, or once paid or closed", () => {
    for (const step of ["contract", "receive", "paid", "close", "done"]) expect(paymentDue({ step })).toBe(false);
  });
});

describe("a project's own package (not the demo's maize)", () => {
  // ACRP-style: planting cuttings per hectare, bought in cuttings; trellising per hectare, bought in hectares.
  const acrp: FieldSetup = {
    items: [
      { key: "cuttings", item: "Grape planting cuttings", unit: "cuttings", qty: 2500, per: "hectare", budgetLine: "PRG-1.1.1.A" },
      { key: "trellis", item: "Trellising", unit: "hectare", qty: 1, per: "hectare", budgetLine: "PRG-1.1.1.B" },
    ],
  };
  const buy = (id: string, line: string, unit: string, qty: number, step = "done") => proc({ id, budgetLine: line, unit, step, grn: { qty } } as unknown as Partial<Procurement>);

  it("scales per-hectare items by the farmer's plot", () => {
    expect(itemsFor(acrp, 0.5).map((i) => i.qty)).toEqual([1250, 0.5]);
  });
  it("passes when the purchase on each line was received in the same unit", () => {
    const g = gateFor(itemsFor(acrp, 0.5), [buy("PR-C", "PRG-1.1.1.A", "Cuttings", 10000), buy("PR-T", "PRG-1.1.1.B", "hectares", 20)], {}, acrp);
    expect(g.ok).toBe(true);
  });
  it("blocks with the reason when a purchase is in a unit the package cannot compare", () => {
    const g = gateFor(itemsFor(acrp, 1), [buy("PR-C", "PRG-1.1.1.A", "bundles", 400), buy("PR-T", "PRG-1.1.1.B", "hectare", 20)], {}, acrp);
    expect(g.ok).toBe(false);
    expect(g.block).toMatch(/PR-C was bought in bundles, but the package gives cuttings/);
  });
  it("keeps the store's stock in each item's unit and adds up what went out", () => {
    const given = addGiven({}, itemsFor(acrp, 2), acrp);
    expect(given).toEqual({ cuttings: 5000, trellis: 2 });
    expect(stockFor(acrp, [buy("PR-C", "PRG-1.1.1.A", "cuttings", 10000), buy("PR-T", "PRG-1.1.1.B", "hectare", 20)], given)).toEqual({ cuttings: 5000, trellis: 18 });
  });
  it("charges an approved item to a received purchase on its own line", () => {
    expect(drawnFrom("PRG-1.1.1.A", 1250, "cuttings", [buy("PR-X", "PRG-1.1.1.B", "hectare", 20), buy("PR-C", "PRG-1.1.1.A", "cuttings", 10000)])?.id).toBe("PR-C");
  });
  it("flags a record where nothing was given (every item answered No in Kobo)", () => {
    expect(flagsFor({ farmerId: "F-1", items: [], photo: true, signed: true, step: "distribute" }, [], itemsFor(acrp, 1)).map((f) => f.id)).toEqual(["nothing"]);
  });
  it("converts weights but never unrelated units", () => {
    expect(convert(2, "t", "kg")).toBe(2000);
    expect(convert(3, "Cuttings", "cutting")).toBe(3);
    expect(convert(3, "kg", "cuttings")).toBeNull();
  });
});

describe("a record with nothing given", () => {
  it("cannot be approved: it would count the farmer as supplied", () => {
    const g = gateFor([], [proc({ ...got(400) })], {}, S);
    expect(g.ok).toBe(false);
    expect(g.block).toMatch(/No item is recorded as given/);
  });
});

describe("applyFix: restoring an item recorded as not given", () => {
  const planned = plannedItems();
  const seedOnly = planned.filter((i) => i.key === "seed");
  it("adds a planned item when the fix gives its amount", () => {
    const out = applyFix(seedOnly, { qty: { npk: 50 } }, planned);
    expect(out.map((i) => [i.key, i.qty])).toEqual([["seed", 10], ["npk", 50]]);
  });
  it("leaves an item out when its amount is zero, recorded or planned", () => {
    expect(applyFix(seedOnly, { qty: { npk: 0 } }, planned).map((i) => i.key)).toEqual(["seed"]);
    expect(applyFix(planned, { qty: { npk: 0 } }, planned).map((i) => i.key)).toEqual(["seed"]);
  });
  it("can rebuild a record that had nothing", () => {
    expect(applyFix([], { qty: { seed: 8, npk: 50 } }, planned).map((i) => [i.key, i.qty])).toEqual([["seed", 8], ["npk", 50]]);
  });
  it("never adds an item that is not in the farmer's package", () => {
    expect(applyFix(seedOnly, { qty: { diesel: 20 } }, planned).map((i) => i.key)).toEqual(["seed"]);
  });
});

describe("an approved distribution becomes one result", () => {
  const d = { id: "d-1", farmerId: "F-0007", village: "Village B", gender: "Female", date: "2026-11-14", items: [{ key: "seed", item: "Certified maize seed", unit: "kg", qty: 12 }, { key: "npk", item: "NPK 17-17-17", unit: "kg", qty: 0 }], recordedBy: "Bilal Haidari", approvedBy: "Nadia Rahimi" };

  it("counts one farmer on the day the package was given, for the target named", () => {
    const r = resultFor(d, "IND-2");
    expect(r).toMatchObject({ indicator: "IND-2", date: "2026-11-14", value: 1, female: 1, male: 0, district: "Village B", distribution: "d-1", files: [] });
  });

  it("says what was given, by whom, and leaves out an item that was not given", () => {
    expect(resultFor(d, "IND-2").note).toBe("Input package given to farmer F-0007 in Village B: 12 kg Certified maize seed. Recorded by Bilal Haidari, approved by Nadia Rahimi.");
  });

  it("is a result the app accepts, pointing at the distribution record as its proof", () => {
    expect(resultSchema.safeParse(resultFor(d, "IND-2")).success).toBe(true);
    expect(resultSchema.safeParse(resultFor({ ...d, village: "", gender: undefined, items: [] }, "IND-9")).success).toBe(true);
  });

  it("does not guess a sex that was not recorded", () => {
    const r = resultFor({ ...d, gender: undefined }, "IND-2");
    expect("female" in r || "male" in r).toBe(false);
  });
});

import { approvalRefusal, approverNamesOf, approversOf, closeBlock } from "@/lib/distribution";

describe("nobody approves a distribution they recorded", () => {
  const p = (id: string, field: string[], reportsTo?: string, kind = "employee") => ({ id, name: id.toUpperCase(), field, reportsTo, kind });
  const team = [p("karim", []), p("nadia", ["manager"], "karim"), p("bilal", ["store"], "nadia"), p("elena", ["manager"], undefined, "donor")];

  it("goes to the project's managers when a storekeeper recorded it", () => {
    expect(approversOf(team, "bilal").map((x) => x.id)).toEqual(["nadia"]);
    expect(approvalRefusal("nadia", team, "bilal")).toBeNull();
  });
  it("goes to the managers when nobody knows who collected it", () => {
    expect(approversOf(team, null).map((x) => x.id)).toEqual(["nadia"]);
  });
  it("skips a manager who recorded it and goes to the other manager", () => {
    const two = [...team, p("sami", ["manager"], "karim")];
    expect(approversOf(two, "nadia").map((x) => x.id)).toEqual(["sami"]);
  });
  it("falls to the person the only manager reports to", () => {
    expect(approversOf(team, "nadia").map((x) => x.id)).toEqual(["karim"]);
    expect(approvalRefusal("nadia", team, "nadia")).toBe("You recorded this distribution, so someone else approves it: KARIM.");
    expect(approvalRefusal("karim", team, "nadia")).toBeNull();
  });
  it("says so when nobody can, and never falls to a donor account", () => {
    const alone = [p("nadia", ["manager"]), p("bilal", ["store"], "nadia")];
    expect(approversOf(alone, "nadia")).toEqual([]);
    expect(approverNamesOf(alone, "nadia")).toMatch(/^nobody yet \(add a second project manager/);
    expect(approversOf(team, "bilal").some((x) => x.id === "elena")).toBe(false);
  });
  it("refuses anyone who is not an approver", () => {
    expect(approvalRefusal("bilal", team, "bilal")).toMatch(/^You recorded this distribution/);
    expect(approvalRefusal("karim", team, "bilal")).toBe("Only NADIA can approve this distribution or send it back.");
  });
});

describe("the signed note closes a distribution", () => {
  it("blocks approval until the recipient's signature is confirmed", () => {
    expect(closeBlock({ signed: false })).toMatch(/signature or thumbprint on the goods received note is not confirmed/);
    expect(closeBlock({ signed: true })).toBeNull();
  });
});
