import { describe, expect, it } from "vitest";
import { budgetView, LIMITS } from "@/lib/budget-view";
import { lineReasonSchema, reasonText, type LineReason } from "@/lib/overspend";
import { checksFor, emptyQpr, overspentLines, withLineReasons, type Spend } from "@/lib/qpr";

const spend: Spend = { currency: "USD", budget: 5000, cumulative: 1000, quarter: 100, withOverhead: false, source: { kind: "budget", at: null }, phases: [], missingMonths: [], byLine: { "PRG-1": { budget: 1000, actual: 1200, quarter: 0 } } };
const price: LineReason = { reason: "price", note: "", by: "u1", at: "2026-11-10T00:00:00Z" };

describe("the reason a line is over budget", () => {
  it("prints the chosen reason, with the note when there is one", () => {
    expect(reasonText({ reason: "price", note: "" })).toBe("Prices or the exchange rate came in higher than budgeted.");
    expect(reasonText({ reason: "realign", note: "UNDP letter of 3 Oct 2026" })).toBe("A realignment the donor has already approved: UNDP letter of 3 Oct 2026");
    expect(reasonText({ reason: "other", note: "Flood repairs to the store" })).toBe("Flood repairs to the store");
  });
  it("'Other' needs a note; the rest do not", () => {
    expect(lineReasonSchema.safeParse({ line: "PRG-1", reason: "other", note: "short" }).success).toBe(false);
    expect(lineReasonSchema.safeParse({ line: "PRG-1", reason: "other", note: "Flood repairs to the store" }).success).toBe(true);
    expect(lineReasonSchema.safeParse({ line: "PRG-1", reason: "early" }).success).toBe(true);
    expect(lineReasonSchema.safeParse({ line: "PRG-1", reason: "bribe" }).success).toBe(false);
    expect(lineReasonSchema.safeParse({ line: "PRG-1", reason: null }).success).toBe(true);
  });
  it("belongs to the line: a report not yet released shows it, and its check is met", () => {
    const q = withLineReasons(emptyQpr("Sandbox"), { "PRG-1": price });
    expect(overspentLines(spend, q)[0]).toMatchObject({ code: "PRG-1", reason: "price", explanation: "Prices or the exchange rate came in higher than budgeted." });
    expect(checksFor([], [], "2026-Q3", q, spend, []).some((c) => /Budget line PRG-1/.test(c.text))).toBe(false);
  });
  it("a released report keeps the reason it was released with", () => {
    const released = { ...emptyQpr("Sandbox"), released: { by: "u2", at: "2026-10-01" }, overspend: { "PRG-1": { text: "Approved realignment, July 2026", by: "u2", at: "2026-09-30" } } };
    expect(overspentLines(spend, withLineReasons(released, { "PRG-1": price }))[0].explanation).toBe("Approved realignment, July 2026");
  });
  it("replaces an older free-text reason once one is chosen", () => {
    const old = { ...emptyQpr("Sandbox"), overspend: { "PRG-1": { text: "Prices rose in the market", by: "u2", at: "2026-09-30" } } };
    expect(overspentLines(spend, old)[0]).toMatchObject({ reason: null, explanation: "Prices rose in the market" });
    expect(overspentLines(spend, withLineReasons(old, { "PRG-1": price }))[0].reason).toBe("price");
  });
});

describe("the donor's budget flexibility", () => {
  const forecastCheck = (revisionPct?: number) =>
    budgetView({ lines: [{ code: "PRG-1", description: "x", activityCode: "1.1", activity: "A", kind: "program", currency: "USD", amount: 1000, schedule: { "2026-12-31": 150 } }], imported: [{ code: "PRG-1", description: "x", budget: 1000, actual: 1000, months: {} }], months: ["2026-09"], currency: "USD", start: "2026-01-01", end: "2026-12-31", results: [], revisionPct })
      .activities[0].lines[0].flags.some((f) => f.level === "check" && /Forecast/.test(f.text));
  it("uses the project's figure from policy, and ROP's starting value without one", () => {
    expect(LIMITS.revisionPct).toBe(10);
    expect(forecastCheck()).toBe(true); // 15% over, above 10%
    expect(forecastCheck(20)).toBe(false); // within a donor's 20%
    expect(forecastCheck(5)).toBe(true);
  });
  it("does not move the overspent flag, which stays at half a percent", () => {
    expect(LIMITS.overPct).toBe(0.5);
  });
});

describe("UNDP's budget flexibility for ACRP", () => {
  it("is the agreement's 20% per line, over ROP's starting value", async () => {
    const { effective, ROP } = await import("@/lib/policy");
    const { DONORS } = await import("@/lib/donors");
    expect(effective(ROP, DONORS.find((d) => d.id === "undp")!).values.budgetRevisionPct).toBe(20);
    expect(effective(ROP, null).values.budgetRevisionPct).toBe(10);
  });
});
