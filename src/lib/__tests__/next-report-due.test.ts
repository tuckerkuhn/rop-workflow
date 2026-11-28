import { describe, expect, it } from "vitest";
import { periodEndMonths } from "@/lib/obligations";
import { nextReportDue, reportPeriod, type DonorInfo } from "@/lib/progress";

/**
 * Review round 1, ISS-20: Demo Foundation's Home and Project settings named the monthly report for
 * January (due 8 Feb 2027); Progress named the quarterly report for October to December (due 30 Jan).
 */
const quarterly = { report: "quarterly", name: "Quarterly progress report", frequency: "quarterly", periodEnds: periodEndMonths("quarterly", 10), daysAfter: 30, dueDates: [] } as unknown as NonNullable<DonorInfo["obligations"]>[number];
const donor: DonorInfo = {
  id: "d1",
  name: "Demo Foundation (fictional)",
  reportFormat: "narrative",
  indicatorRefs: {},
  deadlines: [{ id: "m1", title: "Monthly report: January", date: "2027-02-08" }],
  obligations: [quarterly],
};

describe("one next report for a donor", () => {
  it("is the report Progress covers, not the donor's next dated item", () => {
    const today = "2027-01-05";
    const next = nextReportDue(donor, today, "2026-10-01", "2028-09-30");
    expect(next?.date).toBe("2027-01-30");
    expect(next?.date).toBe(reportPeriod(donor, today, "2026-10-01", "2028-09-30").deadline?.date);
  });
  it("is the donor's own next deadline when no agreement obligation is saved", () => {
    const plain: DonorInfo = { ...donor, obligations: undefined };
    expect(nextReportDue(plain, "2027-01-05", "2026-10-01")).toMatchObject({ title: "Monthly report: January", date: "2027-02-08" });
  });
  it("is nothing when no date is still to come", () => {
    expect(nextReportDue({ ...donor, obligations: undefined, deadlines: [] }, "2027-01-05", "2026-10-01")).toBeNull();
    expect(nextReportDue(null, "2027-01-05", null)).toBeNull();
  });
});
