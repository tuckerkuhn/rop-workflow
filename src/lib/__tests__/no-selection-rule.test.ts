import { describe, expect, it } from "vitest";
import { noSelectionRule, STARTS_WITHOUT_RULE } from "@/lib/selection";

/** Review round 1, ISS-18: A-2027 trains farmers and hands out inputs with no selection rule saved. */
describe("training and inputs with no selection rule saved", () => {
  const farmers = [{ step: "train" }, { step: "distribute" }, { step: "removed" }];
  it("is flagged while no rule is saved, counting the farmers still in the season", () => {
    expect(noSelectionRule(null, farmers)).toMatch(/^No farmer selection rule is saved for this project, yet 2 farmers are being trained/);
    expect(noSelectionRule(null, [{ step: "train" }])).toContain("yet 1 farmer is being");
  });
  it("is not flagged once a rule is saved, or with no farmers", () => {
    expect(noSelectionRule({}, farmers)).toBeNull();
    expect(noSelectionRule({ "F-0001": "selected" }, farmers)).toBeNull();
    expect(noSelectionRule(null, [])).toBeNull();
    expect(noSelectionRule(null, [{ step: "removed" }])).toBeNull();
  });
  it("shows on the record where training and the hand-out start", () => {
    expect([...STARTS_WITHOUT_RULE]).toEqual(["train", "distribute"]);
  });
});
