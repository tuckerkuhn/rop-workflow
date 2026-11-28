import { describe, expect, it } from "vitest";
import { screeningHold, type FarmerScreening } from "@/lib/farmer-screening";

/** MF-04: a farmer is screened before a package worth more than $50 goes out. */
const setup = { items: [{ key: "seed", item: "Seed", qty: 10, unit: "kg", per: "farmer" as const, budgetLine: "1", unitUsd: 7.75 }, { key: "npk", item: "NPK", qty: 50, unit: "kg", per: "farmer" as const, budgetLine: "2", unitUsd: 2.6 }] };
const sc = (result: "clear" | "possible_match"): FarmerScreening => ({ date: "2026-11-20", lists: "OFAC SDN list", result, by: "nadia", byName: "Nadia Rahimi" });
const f = { id: "F-1", hectares: 1 };

describe("farmer screening above the limit", () => {
  it("holds a package above $50 until a clear screening is on the record", () => {
    expect(screeningHold(f, setup)).toMatch(/^F-1's package is worth \$207\.5, above the \$50 limit: screen them/);
    expect(screeningHold({ ...f, screenings: [sc("possible_match")] }, setup)).toMatch(/possible match\. A person reviews it/);
    expect(screeningHold({ ...f, screenings: [sc("possible_match"), sc("clear")] }, setup)).toBeNull();
  });

  it("holds nothing at or under the limit, nor a package that cannot be valued; the limit is a setting", () => {
    expect(screeningHold(f, { items: [{ ...setup.items[0], qty: 5 }] })).toBeNull();
    expect(screeningHold(f, { items: [{ ...setup.items[1], unitUsd: undefined }] })).toBeNull();
    expect(screeningHold(f, { ...setup, screenAboveUsd: 500 })).toBeNull();
  });
});
