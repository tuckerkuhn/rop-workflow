import { describe, expect, it } from "vitest";
import { isDay } from "@/lib/clock";
import { toCsv } from "@/lib/field-data";

describe("dates typed into an address", () => {
  it("accepts only real calendar days", () => {
    expect(isDay("2026-07-01")).toBe(true);
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2026-02-31")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("2026-7-1")).toBe(false);
    expect(isDay(null)).toBe(false);
  });
});

describe("audit downloads", () => {
  it("never let a spreadsheet run text someone typed as a formula", () => {
    expect(toCsv({ headers: ["Name"], rows: [['=HYPERLINK("x","y")'], ["-5"], ["+1 note"]] })).toBe('Name\r\n"\'=HYPERLINK(""x"",""y"")"\r\n-5\r\n\'+1 note\r\n');
  });
});
