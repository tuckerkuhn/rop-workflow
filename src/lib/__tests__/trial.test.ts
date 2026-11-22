import { describe, expect, it } from "vitest";
import { effectivePlan, hasFeature, trialActive, trialEnd } from "@/lib/plans";

describe("a free trial of the paid plan", () => {
  it("lasts two calendar months by default, ending on the month's last day when shorter", () => {
    expect(trialEnd(new Date("2026-11-21T20:00:00Z")).toISOString()).toBe("2027-01-21T20:00:00.000Z");
    expect(trialEnd(new Date("2026-12-31T10:00:00Z"), 2).toISOString()).toBe("2027-02-28T10:00:00.000Z");
    expect(trialEnd(new Date("2026-11-21T00:00:00Z"), 12).toISOString().slice(0, 10)).toBe("2027-11-21");
  });

  it("turns the paid features on while it runs, and off after", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    expect(trialActive("2027-01-21T00:00:00Z", now)).toBe(true);
    expect(effectivePlan("free", "2027-01-21T00:00:00Z", now)).toBe("paid");
    expect(hasFeature(effectivePlan("free", "2027-01-21T00:00:00Z", now), "ai_assistant")).toBe(true);
    expect(effectivePlan("free", "2026-11-30T00:00:00Z", now)).toBe("free");
    expect(effectivePlan("free", null, now)).toBe("free");
    expect(effectivePlan("paid", null, now)).toBe("paid");
  });
});
