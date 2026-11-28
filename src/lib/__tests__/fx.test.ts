import { afterEach, describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/demo";
import { ledgerRate, perUsd, rateEntry, rateText, registerRates, toUsdAt, type FxRate } from "@/lib/fx";
import { toUsd } from "@/lib/procurement-plan";

/** MF-11: afghanis and quetzales at the month's rate, recorded by finance. */
const r = (currency: "AFN" | "GTQ", month: string, perUsd: number): FxRate => ({ currency, month, perUsd, source: "Central bank", by: "peter", byName: "Peter Hale", at: `${month}-01T00:00:00Z` });
const rates = [r("AFN", "2026-10", 69.5), r("AFN", "2026-11", 68.9), r("GTQ", "2026-11", 7.7)];
afterEach(() => registerRates([]));

describe("the month's exchange rate", () => {
  it("each month uses its own rate, or the latest before it", () => {
    expect(perUsd("AFN", "2026-10-15", rates)).toBe(69.5);
    expect(perUsd("AFN", "2026-11-03", rates)).toBe(68.9);
    expect(perUsd("AFN", "2027-01-10", rates)).toBe(68.9);
    expect(rateEntry("GTQ", "2026-10", rates)).toBeNull();
    expect(perUsd("USD", "2026-11-01", rates)).toBe(1);
  });

  it("without a rate: afghanis fall back to 70 and say so; quetzales cannot be turned into dollars", () => {
    expect(perUsd("AFN", "2026-11-01", [])).toBe(70);
    expect(rateText("AFN", "2026-11", [])).toMatch(/fixed fallback/);
    expect(toUsdAt(77, "GTQ", "2026-11-01", [])).toBeNull();
    expect(toUsdAt(77, "GTQ", "2026-11-01", rates)).toBe(10);
  });

  it("the screens and payments use the registered rate", () => {
    registerRates(rates);
    const m = new Date().toISOString().slice(0, 7);
    if (m >= "2026-11") {
      expect(formatMoney(100, "AFN")).toBe("Afs 6,890");
      expect(formatMoney(100, "GTQ")).toBe("Q 770");
      expect(toUsd(689, "AFN")).toBeCloseTo(10, 6);
      expect(ledgerRate("AFN")).toBe(String(Math.round((1 / 68.9) * 1e8) / 1e8));
    }
  });
});
