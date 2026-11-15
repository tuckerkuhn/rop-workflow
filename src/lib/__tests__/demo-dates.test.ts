import { describe, expect, it } from "vitest";
import { DEMO_DATE, daysFromDemo, shiftDates } from "@/lib/clock";
import { seedField } from "@/lib/field";
import { seedProcurements } from "@/lib/procurement";
import { seedSubmissions } from "@/lib/project";

describe("shiftDates: the demo's story, brought to the day it is loaded", () => {
  it("counts days from the demo date", () => {
    expect(daysFromDemo(DEMO_DATE)).toBe(0);
    expect(daysFromDemo("2027-03-05")).toBe(1);
    expect(daysFromDemo("2026-11-14")).toBe(-110);
  });
  it("moves dates inside text, timestamps and Date objects by the same number of days", () => {
    const out = shiftDates({ a: "2027-03-04", b: "Deadline 2027-03-11: recheck", c: "2027-03-04T09:00:00Z", d: new Date("2027-03-04T09:00:00Z"), n: 7, ok: true, none: null }, -110);
    expect(out).toEqual({ a: "2026-11-14", b: "Deadline 2026-11-21: recheck", c: "2026-11-14T09:00:00Z", d: new Date("2026-11-14T09:00:00Z"), n: 7, ok: true, none: null });
  });
  it("leaves record numbers, bare years, object keys and things that are not dates", () => {
    const v = { id: "PR-2027-011", project: "A-2027", season: "2027 Long Rains", forecast: { "2027": 100 }, "2027-03-04": "key stays", odd: "2027-13-45", ref: "VB-2027-0112" };
    expect(shiftDates(v, -110)).toEqual(v);
  });
  it("crosses months and years correctly", () => {
    expect(shiftDates(["2027-01-01", "2028-02-29"], -1)).toEqual(["2026-12-31", "2028-02-28"]);
  });
  it("returns the same value when there is nothing to move", () => {
    const v = { a: "2027-03-04" };
    expect(shiftDates(v, 0)).toBe(v);
  });
  it("puts all of the demo's field history on or before the load day, and nothing further than a year either way", () => {
    const today = "2026-11-14";
    const days = daysFromDemo(today);
    const text = JSON.stringify(shiftDates({ field: seedField().map((i) => ({ timeline: i.timeline })), subs: seedSubmissions(seedField()).map((s) => s.date) }, days));
    const dates = text.match(/20\d{2}-\d{2}-\d{2}/g) ?? [];
    expect(dates.length).toBeGreaterThan(20);
    for (const d of dates) expect(d <= today).toBe(true);
    const all = JSON.stringify(shiftDates(seedProcurements().map((p) => ({ neededBy: p.neededBy, timeline: p.timeline })), days)).match(/20\d{2}-\d{2}-\d{2}/g) ?? [];
    for (const d of all) expect(d > "2025-11-14" && d < "2027-11-14").toBe(true);
  });
});
