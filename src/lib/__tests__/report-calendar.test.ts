import { describe, expect, it } from "vitest";
import { calendarPeriods, calendarRow, calendarState, sortCalendar, usesFace } from "@/lib/report-calendar";

describe("report calendar", () => {
  it("lists two quarters back, this one and two ahead, and last year's and this year's annual", () => {
    const p = calendarPeriods("2025-01-01", "2028-12-31", "2026-11-21");
    expect(p.quarters).toEqual(["2026-Q2", "2026-Q3", "2026-Q4", "2027-Q1", "2027-Q2"]);
    expect(p.years).toEqual([2025, 2026]);
  });
  it("keeps to the project's dates", () => {
    const p = calendarPeriods("2026-10-15", "2027-03-31", "2026-11-21");
    expect(p.quarters).toEqual(["2026-Q4", "2027-Q1"]);
    expect(p.years).toEqual([2026]);
  });
  it("lists everything around now when the project has no dates", () => {
    expect(calendarPeriods(null, null, "2026-01-10").quarters).toEqual(["2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3"]);
  });
  it("says where a report stands", () => {
    expect(calendarState("qpr", "2026-10-15", "2026-10-08", true, "2026-11-21")).toBe("released");
    expect(calendarState("qpr", "2026-10-15", "2026-10-08", false, "2026-11-21")).toBe("late");
    expect(calendarState("annual", "2026-03-31", null, false, "2026-11-21")).toBe("passed");
    expect(calendarState("qpr", "2027-01-15", "2027-01-08", false, "2026-12-20")).toBe("soon");
    expect(calendarState("qpr", "2027-04-15", "2027-04-08", false, "2026-12-20")).toBe("later");
    expect(calendarState("qpr", null, null, false, "2026-12-20")).toBe("later");
  });
  it("puts what is owed first, soonest first, and links each row to its report's check", () => {
    const d = (due: string) => ({ due, aim: due, reviewDays: 0, source: null });
    const rows = sortCalendar([
      calendarRow("qpr", "2026-Q2", "2026-06-30", d("2026-07-15"), true, "2026-11-21"),
      calendarRow("qpr", "2026-Q4", "2026-12-31", d("2027-01-15"), false, "2026-11-21"),
      calendarRow("qpr", "2026-Q3", "2026-09-30", d("2026-10-15"), false, "2026-11-21"),
      calendarRow("annual", "2026", "2026-12-31", d("2027-03-31"), false, "2026-11-21"),
    ]);
    expect(rows.map((r) => r.period)).toEqual(["2026-Q3", "2026-Q4", "2026", "2026-Q2"]);
    expect(rows[0].href).toBe("/progress/report?q=2026-Q3#checks");
    expect(rows[2].href).toBe("/progress/annual?year=2026#checks");
  });
});

describe("funding request (FACE) tab", () => {
  it("shows for UN agencies only", () => {
    expect(usesFace(["UNDP"])).toBe(true);
    expect(usesFace(["World Bank", "UNICEF Afghanistan"])).toBe(true);
    expect(usesFace(["United Nations Development Programme"])).toBe(true);
    expect(usesFace(["USAID", "Livelihoods Fund", "Fundación Uno"])).toBe(false);
    expect(usesFace(["Farmers Who Grow Foundation", "Fundación Un Mundo"])).toBe(false);
    expect(usesFace(["PNUD Afganistán"])).toBe(true);
    expect(usesFace(["U.N. Office for Project Services"])).toBe(true);
    expect(usesFace(["WHO"])).toBe(true);
    expect(usesFace(["Unicef Afghanistan", "Undp"])).toBe(true);
    expect(usesFace(["Unesco"])).toBe(true);
    expect(usesFace(["WHO Afghanistan", "UN Office for Project Services"])).toBe(true);
    expect(usesFace(["FUNDACIÓN UN MUNDO", "FARMERS WHO GROW"])).toBe(false);
    expect(usesFace(["World Food Programme"])).toBe(true);
  });
});
