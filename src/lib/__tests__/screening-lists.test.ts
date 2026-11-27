import { describe, expect, it } from "vitest";
import { ROP } from "@/lib/policy";

/** Review round 1, D-05: suppliers are checked against OFAC's SDN list and the UN 1267 list by default. */
describe("the sanctions lists checked by default", () => {
  it("are OFAC SDN and UN 1267, with their sources", () => {
    const v = ROP.values.screeningLists;
    expect(v.value).toEqual(["OFAC SDN list", "UN Security Council 1267 list"]);
    expect(v.source).toContain("OFAC Compliance Plan");
  });
});
