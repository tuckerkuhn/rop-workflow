import { describe, expect, it } from "vitest";
import { quartersDue } from "@/lib/period-report";

/** Which quarterly reports must be released before a year's annual report can be. */
describe("the quarters an annual report waits for", () => {
  it("leaves out the quarters that ended before the project began", () => {
    // The demo project: it began on 1 October 2026.
    expect(quartersDue(2026, "2026-10-01", "2028-12-31", "2026-11-25")).toEqual([]);
    expect(quartersDue(2026, "2026-10-01", "2028-12-31", "2027-01-15")).toEqual(["2026-Q4"]);
  });

  it("counts a quarter the project began or ended in", () => {
    expect(quartersDue(2026, "2026-05-20", "2028-12-31", "2027-01-15")).toEqual(["2026-Q2", "2026-Q3", "2026-Q4"]);
    expect(quartersDue(2028, "2026-10-01", "2028-08-15", "2029-02-01")).toEqual(["2028-Q1", "2028-Q2", "2028-Q3"]);
  });

  it("waits for every quarter of a full year once each has ended, and for none under way", () => {
    expect(quartersDue(2027, "2026-10-01", "2028-12-31", "2027-08-10")).toEqual(["2027-Q1", "2027-Q2"]);
    expect(quartersDue(2027, "2026-10-01", "2028-12-31", "2027-12-31")).toEqual(["2027-Q1", "2027-Q2", "2027-Q3"]);
    expect(quartersDue(2027, "2026-10-01", "2028-12-31", "2028-01-01")).toEqual(["2027-Q1", "2027-Q2", "2027-Q3", "2027-Q4"]);
  });

  it("holds a project with no dates recorded to every quarter that has ended", () => {
    expect(quartersDue(2026, null, null, "2026-11-25")).toEqual(["2026-Q1", "2026-Q2", "2026-Q3"]);
  });
});
