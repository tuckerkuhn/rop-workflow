import { describe, expect, it } from "vitest";
import { flagsFor, gate, inProcUnit, plannedItems, toKg } from "@/lib/distribution";
import type { Procurement } from "@/lib/procurement";

const proc = (over: Partial<Procurement>): Procurement =>
  ({ id: "PR-1", title: "Seed", qty: 2400, unit: "kg", unitPrice: 7.75, budgetLine: "2.1", activity: "", step: "need", signatures: {}, checks: {}, issues: [], timeline: [], ...over }) as unknown as Procurement;
const got = (qty: number) => ({ step: "done", grn: { qty } }) as unknown as Partial<Procurement>;

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
    expect(inProcUnit(50, { unit: "t" })).toBeCloseTo(0.05);
    expect(inProcUnit(10, { unit: "kg" })).toBe(10);
  });
});

describe("flagsFor", () => {
  const base = { farmerId: "F-0001", items: plannedItems(), photo: true, signed: true, step: "distribute" };
  it("is clean for a normal package", () => {
    expect(flagsFor(base, [])).toEqual([]);
  });
  it("flags the same farmer twice, above plan, no photo, unsigned, not cleared", () => {
    const items = plannedItems().map((i) => (i.key === "seed" ? { ...i, qty: 15 } : i));
    const ids = flagsFor({ ...base, items, photo: false, signed: false, step: "verify" }, ["F-0001"]).map((f) => f.id);
    expect(ids).toEqual(["twice", "aboveplan", "nophoto", "unsigned", "notready"]);
  });
});
