import { describe, expect, it } from "vitest";
import { choosesPackage, itemsFor, packageUsd, setupProblem, type FieldSetup } from "@/lib/package";
import { appForm, formState, formProblems, type FormLists } from "@/lib/app-forms";
import { parseFarmers } from "@/lib/farmer-import";

/** Tucker, 28 Nov: a project may offer several packages, and each farmer chooses one. */
const setup: FieldSetup = {
  items: [
    { key: "seed", item: "Wheat seed", qty: 50, unit: "kg", per: "hectare", budgetLine: "1.1", unitUsd: 2 },
    { key: "dt_seed", item: "Drought-tolerant wheat seed", qty: 40, unit: "kg", per: "hectare", budgetLine: "1.3", unitUsd: 3 },
    { key: "npk", item: "NPK", qty: 25, unit: "kg", per: "farmer", budgetLine: "1.2", unitUsd: 1 },
  ],
  packages: [
    { key: "irrigated", name: "Irrigated", items: ["seed", "npk"] },
    { key: "drought", name: "Drought-tolerant", why: "plots with no irrigation", items: ["dt_seed", "npk"] },
  ],
};
const TODAY = "2026-11-28";
const lists: FormLists = { farmers: [{ name: "F-1", label: "F-1", hectares: 0.5, package: "drought" }, { name: "F-2", label: "F-2", hectares: 1, package: "" }], package: setup.items.map((i) => ({ name: i.key, label: i.item, qty: i.qty, unit: i.unit, per: i.per })) };

describe("packages farmers choose from", () => {
  it("a farmer gets only their package's items; with none chosen, every item", () => {
    expect(choosesPackage(setup)).toBe(true);
    expect(itemsFor(setup, 0.5, "drought").map((i) => [i.key, i.qty])).toEqual([["dt_seed", 20], ["npk", 25]]);
    expect(itemsFor(setup, 0.5).map((i) => i.key)).toEqual(["seed", "dt_seed", "npk"]);
    expect(packageUsd(setup, 0.5, "drought")).toBe(85);
  });

  it("the setup is checked: a name, at least one item, and items from the list", () => {
    expect(setupProblem(setup)).toBeNull();
    expect(setupProblem({ ...setup, packages: [{ key: "x", name: "X", items: [] }] })).toMatch(/has no items/);
    expect(setupProblem({ ...setup, packages: [{ key: "x", name: "X", items: ["urea"] }] })).toMatch(/not in the list above/);
  });

  it("the distribution form asks only the items in the farmer's package", () => {
    const f = appForm("distribution", "A2027", { setup });
    const drought = formState(f, { farmer: "F-1" }, lists, TODAY).shown;
    expect(drought.has("dt_seed_given") && drought.has("npk_given")).toBe(true);
    expect(drought.has("seed_given")).toBe(false);
    // No package recorded: every item is asked, as before.
    expect(formState(f, { farmer: "F-2" }, lists, TODAY).shown.has("seed_given")).toBe(true);
  });

  it("registering asks which package; a farmer list may name it", () => {
    const f = appForm("register", "A2027", { setup });
    expect(formProblems(f, { farmer_id: "F-3", village: "Qala", sex: "Female", hectares: "1" }, lists, TODAY).map((p) => p.name)).toEqual(["package"]);
    expect(f.choices.package.map((c) => c.label)).toEqual(["Irrigated", "Drought-tolerant: plots with no irrigation"]);
    expect(parseFarmers("id,village,sex,hectares,package\nF-1,Qala,F,0.5,Drought-tolerant").rows[0].package).toBe("Drought-tolerant");
  });
});
