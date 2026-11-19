import { describe, expect, it } from "vitest";
import { cropPlanProblem, densityOf, hectaresFor, plantedItem, plantingValue, suggestedPlan } from "@/lib/crops";
import { projectDesignSchema } from "@/lib/project-setup";

const design = { name: "Test", country: "AF", crop: "Grapes", startDate: "2027-01-01", endDate: "2028-01-01", goal: "", indicators: [] };

describe("the crop plan decided at initiation", () => {
  it("suggests a plan for crops on the list, whatever the case, and none for others", () => {
    expect(suggestedPlan("grapes")).toMatchObject({ by: "count", unit: "vines", rowM: 3, plantM: 1.5, trellis: true });
    expect(suggestedPlan("Maize")).toMatchObject({ by: "area" });
    expect(suggestedPlan("Dragon fruit")).toBeNull();
  });

  it("works out plants per hectare from the spacing, and hectares from a count", () => {
    const vines = { by: "count" as const, unit: "vines", rowM: 3, plantM: 1.5 };
    expect(densityOf(vines)).toBe(2222);
    expect(hectaresFor(1111, vines)).toBe(0.5);
    expect(densityOf({ by: "area" })).toBeNull();
    expect(densityOf({ by: "count", unit: "trees", rowM: 5 })).toBeNull();
  });

  it("asks for the unit and both spacings before a counted plan can be saved, on the server too", () => {
    expect(cropPlanProblem({ by: "count", rowM: 3, plantM: 1.5 })).toMatch(/what is counted/);
    expect(cropPlanProblem({ by: "count", unit: "vines", rowM: 3 })).toMatch(/spacing/);
    expect(cropPlanProblem({ by: "area" })).toBeNull();
    expect(projectDesignSchema.safeParse({ ...design, cropPlan: { by: "count", unit: "vines" } }).success).toBe(false);
    expect(projectDesignSchema.safeParse({ ...design, cropPlan: { by: "count", unit: "vines", rowM: 3, plantM: 1.5, trellis: true, yearsToHarvest: 3 } }).success).toBe(true);
    expect(projectDesignSchema.safeParse(design).success).toBe(true);
  });

  it("finds the package item that is planted", () => {
    const items = [{ key: "trellis", unit: "kits" }, { key: "cuttings", unit: "vine" }];
    expect(plantedItem(items, { by: "count", unit: "vines", rowM: 3, plantM: 1.5 })?.key).toBe("cuttings");
    expect(plantedItem([{ key: "s", unit: "seedlings" }], { by: "count", unit: "plants", rowM: 2, plantM: 2 })?.key).toBe("s");
    expect(plantedItem(items, { by: "area" })).toBeUndefined();
  });

  it("counts toward a target by its unit", () => {
    const p = { hectares: 0.45, count: 1000 };
    expect(plantingValue("Hectares", p, null)).toEqual({ value: 0.45, people: false });
    expect(plantingValue("ha", p, null)).toEqual({ value: 0.45, people: false });
    expect(plantingValue("trees", p, null)).toEqual({ value: 1000, people: false });
    expect(plantingValue("farmers", p, null)).toEqual({ value: 1, people: true });
    expect(plantingValue("trees", { hectares: 1 }, null)).toEqual({ value: 1, people: true });
  });
});

describe("quantities with their item", () => {
  it("does not say the unit twice when the item's name ends in it", async () => {
    const { qtyItem, describePackage } = await import("@/lib/package");
    expect(qtyItem(1, "kits", "Trellis kit")).toBe("1 Trellis kit");
    expect(qtyItem(4, "kits", "Trellis kit")).toBe("4 Trellis kits");
    expect(qtyItem(10, "kg", "Certified maize seed")).toBe("10 kg Certified maize seed");
    expect(qtyItem(1, "cuttings", "Grape planting cuttings")).toBe("1 Grape planting cutting");
    expect(describePackage({ items: [{ key: "t", item: "Trellis kit", qty: 1, unit: "kits", per: "farmer", budgetLine: "S-102" }] })).toBe("1 Trellis kit");
  });
});
