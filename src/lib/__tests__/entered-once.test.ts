import { afterEach, describe, expect, it } from "vitest";
import { setProcurementRules } from "@/lib/procurement";
import { METHOD } from "@/lib/procurement-plan";
import { policyText } from "@/server/ai-drafts";

/** A fact is entered once: every place that states it reads the same source. */

afterEach(() => setProcurementRules(null));

describe("procurement thresholds in words match the rules in force", () => {
  it("states ROP's own thresholds when no donor rule is layered on", () => {
    expect(METHOD.Micro.detail).toContain("Up to $500");
    expect(METHOD.Small.detail).toContain("$500 to $5,000");
    expect(METHOD.Medium.detail).toContain("$5,000 to $25,000");
    expect(METHOD.Large.detail).toContain("Over $25,000");
    expect(policyText()).toContain("Micro up to $500; Small $500 to $5,000; Medium $5,000 to $25,000; Large over $25,000.");
  });
  it("follows a donor's stricter thresholds on screen and in the AI's instructions alike", () => {
    setProcurementRules({ microMaxUsd: 200, smallMaxUsd: 2500, largeAboveUsd: 10000 });
    expect(METHOD.Micro.detail).toContain("Up to $200");
    expect(METHOD.Small.detail).toContain("$200 to $2,500");
    expect(METHOD.Medium.detail).toContain("$2,500 to $10,000");
    expect(METHOD.Large.detail).toContain("Over $10,000");
    expect(policyText()).toContain("Micro up to $200; Small $200 to $2,500; Medium $2,500 to $10,000; Large over $10,000.");
  });
  it("goes back to ROP's own when the rules are cleared", () => {
    setProcurementRules({ microMaxUsd: 200 });
    setProcurementRules(null);
    expect(METHOD.Micro.detail).toContain("Up to $500");
  });
});
