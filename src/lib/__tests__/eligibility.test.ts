import { describe, expect, it } from "vitest";
import { contributionRate, packageValue, ruleCheck, ruleText, type Rule } from "@/lib/eligibility";
import { rulesFrom } from "@/lib/selection";

/** MF-12 (D-21, D-22): eligibility rules as numbers and lists, checked against each farmer's record. */
const setup = { items: [{ key: "seed", item: "Wheat seed", qty: 50, unit: "kg", per: "hectare" as const, budgetLine: "1.1", unitUsd: 2 }, { key: "npk", item: "NPK", qty: 25, unit: "kg", per: "farmer" as const, budgetLine: "1.2", unitUsd: 1 }] };
const woman = { gender: "Female", hectares: 0.5, community: "Qala", crops: ["Wheat", "beans"], contributionPaid: false };
const man = { ...woman, gender: "Male", hectares: 3, community: "Deh", crops: [] };

describe("eligibility rules", () => {
  it("are written in words from their numbers", () => {
    expect(ruleText({ kind: "land", min: 0.2, max: 2 })).toBe("Farms between 0.2 and 2 hectares");
    expect(ruleText({ kind: "location", villages: ["Qala", "Deh", "Bagh"] })).toBe("Lives in Qala, Deh or Bagh");
    expect(ruleText({ kind: "crop", crops: ["Wheat"] })).toBe("Grows wheat now");
    expect(ruleText({ kind: "contribution", rate: 20, womenRate: 10 })).toBe("Agrees to contribute 20% of the package's value (10% for women)");
    expect(ruleText({ kind: "contribution", rate: 20, womenRate: 20 })).toBe("Agrees to contribute 20% of the package's value");
  });

  it("are checked against the record: met, not met, or for the person to ask", () => {
    const land: Rule = { kind: "land", min: 0.2, max: 2 };
    expect(ruleCheck(land, woman).ok).toBe(true);
    expect(ruleCheck(land, man)).toEqual({ ok: false, detail: "The record says 3 ha." });
    expect(ruleCheck({ kind: "location", villages: ["qala"] }, woman).ok).toBe(true);
    expect(ruleCheck({ kind: "location", villages: ["qala"] }, man).ok).toBe(false);
    expect(ruleCheck({ kind: "crop", crops: ["wheat"] }, woman).ok).toBe(true);
    expect(ruleCheck({ kind: "crop", crops: ["wheat"] }, man).ok).toBeNull();
  });

  it("a women's contribution rate, worked out on the package's value for the farmer", () => {
    const r = { kind: "contribution" as const, rate: 20, womenRate: 10 };
    expect(contributionRate(r, "Female")).toBe(10);
    expect(contributionRate(r, "Male")).toBe(20);
    expect(packageValue(setup, 0.5)).toBe(75);
    expect(ruleCheck(r, woman, setup)).toEqual({ ok: null, detail: "Contribution due: 10% of $75, $7.5. Not paid yet: tick if the farmer agreed." });
    expect(ruleCheck(r, { ...man, contributionPaid: true }, setup).ok).toBe(true);
    // An item with no unit cost: the rate is shown without an amount.
    expect(ruleCheck(r, woman, { items: [{ ...setup.items[0], unitUsd: undefined }] }).detail).toContain("10% of the package's value.");
  });

  it("join the written rules in Farmer selection, once each", () => {
    const made = rulesFrom(["Lives in the area for three years"], [{ kind: "land", max: 2 }]);
    expect("list" in made && made.list.map((r) => r.text)).toEqual(["Lives in the area for three years", "Farms no more than 2 hectares"]);
    expect(rulesFrom([], [])).toEqual({ problem: "Write at least one rule." });
    expect(rulesFrom(["Farms no more than 2 hectares"], [{ kind: "land", max: 2 }])).toEqual({ problem: "Each rule is written once." });
  });
});

describe("eligibility rules per package (Tucker, 28 Nov)", () => {
  const pkgSetup = { items: [...setup.items, { key: "dt", item: "Drought seed", qty: 40, unit: "kg", per: "hectare" as const, budgetLine: "1.3", unitUsd: 3 }], packages: [{ key: "irrigated", name: "Irrigated", items: ["seed", "npk"] }, { key: "drought", name: "Drought-tolerant", items: ["dt", "npk"] }] };
  const max1: Rule = { kind: "land", max: 1, package: "drought" };

  it("a package's rule says so, and binds only the farmers who chose that package", () => {
    expect(ruleText(max1, "Drought-tolerant")).toBe("Drought-tolerant package: farms no more than 1 hectare");
    expect(ruleCheck(max1, { ...man, package: "drought" }).ok).toBe(false);
    expect(ruleCheck(max1, { ...man, package: "irrigated" }, pkgSetup)).toEqual({ ok: true, detail: "Only for the Drought-tolerant package; this farmer chose Irrigated." });
  });

  it("the contribution is worked out on the value of the farmer's own package", () => {
    expect(ruleCheck({ kind: "contribution", rate: 10 }, { ...woman, package: "drought" }, pkgSetup).detail).toBe("Contribution due: 10% of $85, $8.5. Not paid yet: tick if the farmer agreed.");
  });

  it("one rule of each kind per package, and only packages the project offers", () => {
    const pk = [{ key: "drought", name: "Drought-tolerant" }];
    const made = rulesFrom([], [{ kind: "land", max: 2 }, max1], pk);
    expect("list" in made && made.list.map((r) => r.text)).toEqual(["Farms no more than 2 hectares", "Drought-tolerant package: farms no more than 1 hectare"]);
    expect(rulesFrom([], [{ ...max1, package: "gold" }], pk)).toEqual({ problem: "A rule names a package this project does not offer. Reload the page." });
  });
});
