import { describe, expect, it } from "vitest";
import { hideName } from "@/lib/field";

/** A farmer's name in free text, for people who may not see names (lib/field hideName). */
describe("hiding a farmer's name in text", () => {
  it("hides the full name and each part of it, in any capitals", () => {
    expect(hideName("Ali Ahmadi trained two neighbours.", "Ali Ahmadi", "F-0001")).toBe("Farmer F-0001 trained two neighbours.");
    expect(hideName("Ali trained two; AHMADI visited.", "Ali Ahmadi", "F-0001")).toBe("Farmer F-0001 trained two; Farmer F-0001 visited.");
  });
  it("leaves other words that only contain the name alone", () => {
    expect(hideName("Alison met Kalimullah.", "Ali Ahmadi", "F-0001")).toBe("Alison met Kalimullah.");
  });
  it("hides names written in other scripts as whole words", () => {
    expect(hideName("گل‌احمد کار کرد", "گل‌احمد", "F-0002")).toBe("Farmer F-0002 کار کرد");
  });
  it("leaves the text as it is when there is no name", () => {
    expect(hideName("No name here.", "", "F-0001")).toBe("No name here.");
  });
});
