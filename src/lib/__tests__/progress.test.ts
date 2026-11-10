import { describe, expect, it } from "vitest";
import { forecastFor, missingData, periodOf, projectYears, reportPeriod, trackFor, type DonorInfo, type IndicatorProgress } from "@/lib/progress";

describe("project years and forecast", () => {
  it("lists each calendar year the project runs in", () => {
    expect(projectYears("2026-03-01", "2028-02-28")).toEqual([2026, 2027, 2028]);
    expect(projectYears(null, "2028-02-28")).toEqual([]);
    expect(projectYears("2028-01-01", "2026-01-01")).toEqual([]);
  });
  it("makes the last year's forecast equal the target, so they never disagree", () => {
    const f = forecastFor({ "2026": 100, "2027": 250, "2028": 999 }, 400, [2026, 2027, 2028]);
    expect(f.get(2026)).toBe(100);
    expect(f.get(2027)).toBe(250);
    expect(f.get(2028)).toBe(400);
  });
  it("leaves years without a forecast out", () => {
    const f = forecastFor(null, 400, [2026, 2027]);
    expect(f.has(2026)).toBe(false);
    expect(f.get(2027)).toBe(400);
  });
});

describe("trackFor: on track or behind", () => {
  const forecast = new Map([[2026, 100], [2027, 200]]);
  it("expects a steady rise through the year", () => {
    const t = trackFor({ forecast, actual: 50, today: "2026-07-02", start: "2026-01-01", once: false })!;
    expect(t.expected).toBeGreaterThan(49);
    expect(t.expected).toBeLessThan(51);
    expect(t.status).toBe("on_track");
  });
  it("is on track within 10% of expected, slightly behind within 25%, behind below that", () => {
    const at = (actual: number) => trackFor({ forecast, actual, today: "2026-12-31", start: "2026-01-01", once: false })!.status;
    expect(at(100)).toBe("on_track");
    expect(at(90)).toBe("on_track");
    expect(at(89)).toBe("slightly_behind");
    expect(at(75)).toBe("slightly_behind");
    expect(at(74)).toBe("behind");
  });
  it("starts the second year from the first year's forecast", () => {
    const t = trackFor({ forecast, actual: 100, today: "2027-01-01", start: "2026-01-01", once: false })!;
    expect(t.expected).toBe(100);
    expect(t.status).toBe("on_track");
  });
  it("starts counting on the project start date in its first year", () => {
    const t = trackFor({ forecast, actual: 0, today: "2026-07-01", start: "2026-07-01", once: false })!;
    expect(t.expected).toBe(0);
    expect(t.status).toBe("on_track");
  });
  it("says not measured for a once-a-season value with nothing yet", () => {
    expect(trackFor({ forecast, actual: null, today: "2026-07-01", start: "2026-01-01", once: true })!.status).toBe("not_measured");
  });
  it("gives nothing when there is no forecast for the year", () => {
    expect(trackFor({ forecast, actual: 1, today: "2029-07-01", start: "2026-01-01", once: false })).toBeNull();
  });
  it("treats no result as zero, not as on track", () => {
    expect(trackFor({ forecast, actual: null, today: "2026-12-31", start: "2026-01-01", once: false })!.status).toBe("behind");
  });
});

describe("reporting periods", () => {
  it("monthly: the calendar month", () => {
    expect(periodOf("monthly", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodOf("monthly", "2026-12-31")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("quarterly: the calendar quarter", () => {
    expect(periodOf("quarterly", "2026-08-10")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(periodOf("quarterly", "2026-12-31")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  });
  it("end of season: nothing due", () => {
    expect(periodOf("end_of_season", "2026-08-10")).toBeNull();
  });
  it("flags an indicator due this period with nothing counted", () => {
    const ind = { frequency: "quarterly", period: 0 } as IndicatorProgress;
    expect(missingData(ind)).toBe(true);
    expect(missingData({ ...ind, period: 3 })).toBe(false);
    expect(missingData({ ...ind, frequency: "end_of_season" })).toBe(false);
  });
  const donor: DonorInfo = { id: "d", name: "Sandbox Donor", reportFormat: "generic", indicatorRefs: {}, deadlines: [
    { id: "1", title: "Q2 report", date: "2026-07-15" },
    { id: "2", title: "Q3 report", date: "2026-10-15" },
  ] };
  it("donor report: from the day after the last deadline to the next one", () => {
    expect(reportPeriod(donor, "2026-08-01", "2026-01-01")).toMatchObject({ from: "2026-07-16", to: "2026-10-15", deadline: { id: "2" } });
  });
  it("donor report before any deadline has passed: from the project start", () => {
    expect(reportPeriod(donor, "2026-05-01", "2026-01-01")).toMatchObject({ from: "2026-01-01", to: "2026-07-15" });
  });
  it("donor report after the last deadline: up to today, with no deadline", () => {
    expect(reportPeriod(donor, "2026-11-09", "2026-01-01")).toMatchObject({ from: "2026-10-16", to: "2026-11-09", deadline: null });
  });
  it("no deadlines: the current month", () => {
    expect(reportPeriod(null, "2026-11-09", "2026-01-01")).toMatchObject({ from: "2026-11-01", to: "2026-11-30", deadline: null });
  });
});
