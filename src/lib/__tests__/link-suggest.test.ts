import { describe, expect, it } from "vitest";
import { suggestLinks, type LinkLine, type LinkStep, type LinkTarget } from "@/lib/link-suggest";

const steps: LinkStep[] = [
  { code: "1.1.1.1", activityCode: "1.1.1", title: "Train farmers in improved land preparation" },
  { code: "1.2.1.1", activityCode: "1.2.1", title: "Distribute certified seed to farmer groups" },
  { code: "1.2.1.2", activityCode: "1.2.1", title: "Build trellis demonstration plots" },
  { code: "2.1.1.1", activityCode: "2.1.1", title: "Link cooperatives with export buyers" },
];
const lines: LinkLine[] = [
  { code: "PRG-1.2.1.A", activityCode: "1.2.1", description: "Certified seed for farmer groups" },
  { code: "PRG-1.2.1.B", activityCode: "1.2.1", description: "Trellis posts and wire for demonstration plots" },
  { code: "PRG-1.1.1.A", activityCode: "1.1.1", description: "Trainer fees for land preparation training" },
];
const target = (o: Partial<LinkTarget>): LinkTarget => ({ code: "IND-1", donorCode: null, name: "Farmers reached", result: null, workplanCode: null, budgetRef: null, ...o });

describe("suggested links from a target to its workplan item and budget line", () => {
  it("goes by the activity number in the donor code and picks the closest wording within it", () => {
    const [s] = suggestLinks([target({ donorCode: "1.2.1.4", name: "Demonstration plots built with trellis" })], steps, lines);
    expect(s.workplan).toEqual({ code: "1.2.1.2", title: "Build trellis demonstration plots", reason: 'same activity number 1.2.1, shares the words "demonstration", "plots", "trellis"' });
    expect(s.budget.map((b) => b.code)).toEqual(["PRG-1.2.1.B"]);
    expect(s.budget[0].reason).toMatch(/^pays for workplan item 1\.2\.1\.2: same activity number 1\.2\.1, shares the words/);
  });

  it("says only the number when one item has it", () => {
    const [s] = suggestLinks([target({ donorCode: "2.1.1.3", name: "Sales contracts signed" })], steps, lines);
    expect(s.workplan).toMatchObject({ code: "2.1.1.1", reason: "same activity number 2.1.1" });
    expect(s.budget).toEqual([]);
  });

  it("falls back to the result statement's words when the number finds nothing", () => {
    const [s] = suggestLinks([target({ donorCode: "9.9.9.1", result: "Farmers trained in improved land preparation" })], steps, lines);
    expect(s.workplan?.code).toBe("1.1.1.1");
    expect(s.workplan?.reason).toBe('shares the words "farmers", "improved", "land", "preparation"');
    expect(s.budget.map((b) => b.code)).toEqual(["PRG-1.1.1.A"]);
  });

  it("suggests nothing when neither the number nor the words match", () => {
    expect(suggestLinks([target({ result: "Women-led households report higher income" })], steps, lines)).toEqual([]);
    // One shared word is not enough.
    expect(suggestLinks([target({ result: "Seed banks opened" })], steps, lines)).toEqual([]);
  });

  it("leaves a target that has both links alone and suggests only the missing budget line from a workplan item set by hand", () => {
    expect(suggestLinks([target({ donorCode: "1.2.1.1", workplanCode: "1.2.1.1", budgetRef: "PRG-1.2.1.A" })], steps, lines)).toEqual([]);
    const [s] = suggestLinks([target({ workplanCode: "1.2.1.1" })], steps, lines);
    expect(s.workplan).toBeNull();
    expect(s.budget.map((b) => b.code)).toEqual(["PRG-1.2.1.A"]);
  });
});
