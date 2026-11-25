import { describe, expect, it } from "vitest";
import { deadlinesFrom, type Obligation } from "@/lib/agreement";
import { formatAskedFor, mainObligation, mergeObligations, nextPeriod, obligationPeriods, periodEndMonths, periodHolding, proposedDeadlines, reportKind, sameAsCalendar, splitFormat, type ObligationInput, type SavedObligation } from "@/lib/obligations";
import { reportPeriod, type DonorInfo } from "@/lib/progress";

/** A donor's reporting obligations from the agreement drive its report periods and deadlines. */
const quarterly = (startMonth: number | null, daysAfter = 30): ObligationInput => ({
  donorId: "00000000-0000-4000-8000-000000000001",
  report: "quarterly",
  name: "Quarterly progress report",
  frequency: "quarterly",
  periodEnds: periodEndMonths("quarterly", startMonth),
  daysAfter,
  dueDates: [],
  format: "Donor template B",
  formatFile: null,
  source: "Agreement, clause 8.2",
});

describe("periods from the agreement", () => {
  it("counts quarters and years from the month the agreement starts", () => {
    expect(periodEndMonths("quarterly", 10)).toEqual([3, 6, 9, 12]);
    expect(periodEndMonths("quarterly", 11)).toEqual([1, 4, 7, 10]);
    expect(periodEndMonths("annual", 10)).toEqual([9]);
    expect(periodEndMonths("semiannual", 10)).toEqual([3, 9]);
    expect(periodEndMonths("annual", null)).toEqual([12]);
    expect(periodEndMonths("final", 10)).toEqual([]);
    expect(sameAsCalendar("quarterly", 10)).toBe(true);
    expect(sameAsCalendar("annual", 10)).toBe(false);
  });

  it("gives an October start October to December, then January to March, each due its days after", () => {
    const list = obligationPeriods(quarterly(10), "2026-10-01", "2028-09-30", "2026-10-01");
    expect(list.slice(0, 2)).toEqual([
      { from: "2026-10-01", to: "2026-12-31", due: "2027-01-30" },
      { from: "2027-01-01", to: "2027-03-31", due: "2027-04-30" },
    ]);
    expect(list.at(-1)).toEqual({ from: "2028-07-01", to: "2028-09-30", due: "2028-10-30" });
    expect(list).toHaveLength(8);
  });

  it("keeps the agreement's own year and its own quarters when they are not the calendar's", () => {
    const annual = { ...quarterly(10, 90), frequency: "annual" as const, periodEnds: periodEndMonths("annual", 10) };
    expect(obligationPeriods(annual, "2026-10-01", "2028-09-30", "2026-10-01")).toEqual([
      { from: "2026-10-01", to: "2027-09-30", due: "2027-12-29" },
      { from: "2027-10-01", to: "2028-09-30", due: "2028-12-29" },
    ]);
    const nov = obligationPeriods(quarterly(11, 45), "2026-11-01", "2027-10-31", "2026-11-01");
    expect(nov[0]).toEqual({ from: "2026-11-01", to: "2027-01-31", due: "2027-03-17" });
    expect(periodHolding(quarterly(11), "2027-03-15", "2026-11-01", "2027-10-31")).toMatchObject({ from: "2027-02-01", to: "2027-04-30" });
  });

  it("a final report covers the whole project", () => {
    const final = { ...quarterly(null, 90), report: "final" as const, frequency: "final" as const, periodEnds: [] };
    expect(obligationPeriods(final, "2026-10-01", "2028-09-30", "2027-01-01")).toEqual([{ from: "2026-10-01", to: "2028-09-30", due: "2028-12-29" }]);
  });

  it("proposes the same deadlines as before for calendar periods", () => {
    const o: Obligation = { report: "Quarterly progress report", frequency: "quarterly", daysAfterPeriod: 30, dueDates: [], format: "", source: "Agreement, clause 8.2" };
    expect(proposedDeadlines(quarterly(null), "2026-02-15", "2027-01-31")).toEqual(deadlinesFrom(o, "2026-02-15", "2027-01-31"));
  });

  it("names the report by kind and picks the narrative report a donor's periods follow", () => {
    expect(reportKind({ report: "Quarterly financial report", frequency: "quarterly" })).toBe("financial");
    expect(reportKind({ report: "Final narrative report", frequency: "once" })).toBe("final");
    expect(reportKind({ report: "Six-monthly report", frequency: "semiannual" })).toBe("semiannual");
    const fin = { ...quarterly(10), report: "financial" as const, name: "Quarterly financial report" };
    const annual = { ...quarterly(10), frequency: "annual" as const, report: "annual" as const };
    expect(mainObligation([annual, fin, quarterly(10)])?.name).toBe("Quarterly progress report");
    expect(mainObligation([fin])?.name).toBe("Quarterly financial report");
  });
});

describe("a donor's report period", () => {
  const donor = (obligations?: ObligationInput[]): DonorInfo => ({ id: "d1", name: "Donor", reportFormat: "standard", indicatorRefs: {}, deadlines: [{ id: "m1", title: "Quarterly progress report (period to 2026-12-31)", date: "2027-01-30" }], ...(obligations ? { obligations } : {}) });

  it("follows the agreement's quarters: the report due next, with its deadline", () => {
    expect(reportPeriod(donor([quarterly(10)]), "2027-01-20", "2026-10-01", "2028-09-30")).toEqual({ from: "2026-10-01", to: "2026-12-31", deadline: { id: "m1", title: "Quarterly progress report (period to 2026-12-31)", date: "2027-01-30" } });
    expect(reportPeriod(donor([quarterly(10)]), "2027-02-05", "2026-10-01", "2028-09-30")).toEqual({ from: "2027-01-01", to: "2027-03-31", deadline: { id: "", title: "Quarterly progress report (period to 2027-03-31)", date: "2027-04-30" } });
    expect(nextPeriod(quarterly(11), "2027-02-05", "2026-11-01", "2027-10-31")).toMatchObject({ from: "2026-11-01", to: "2027-01-31" });
  });

  it("is unchanged with no obligations saved", () => {
    expect(reportPeriod(donor(), "2026-11-09", "2026-10-01")).toEqual({ from: "2026-10-01", to: "2027-01-30", deadline: { id: "m1", title: "Quarterly progress report (period to 2026-12-31)", date: "2027-01-30" } });
    expect(reportPeriod(donor([]), "2026-11-09", "2026-10-01")).toEqual(reportPeriod(donor(), "2026-11-09", "2026-10-01"));
    expect(reportPeriod(null, "2026-11-09", "2026-01-01")).toMatchObject({ from: "2026-10-01", to: "2026-12-31", deadline: null });
  });
});

describe("the format the donor asks for", () => {
  it("shows its name, with the template's link when there is one", () => {
    expect(formatAskedFor(quarterly(10))).toEqual({ text: "Format asked for: Donor template B", href: null });
    const split = splitFormat("Annex 4 template (https://example.org/annex-4.docx)");
    expect(split).toEqual({ format: "Annex 4 template", formatFile: "https://example.org/annex-4.docx" });
    expect(formatAskedFor(split)).toEqual({ text: "Format asked for: Annex 4 template", href: "https://example.org/annex-4.docx" });
    expect(formatAskedFor({ format: "", formatFile: null })).toBeNull();
  });

  it("a confirmed obligation takes the place of the same donor's same report", () => {
    const at = { by: "nadia", at: "2026-11-24T00:00:00Z" };
    const old: SavedObligation[] = [{ ...quarterly(null), ...at }, { ...quarterly(null), donorId: "00000000-0000-4000-8000-000000000002", ...at }];
    const merged = mergeObligations(old, [{ ...quarterly(10), format: "New template", ...at }]);
    expect(merged).toHaveLength(2);
    expect(merged.find((o) => o.donorId === quarterly(10).donorId)?.format).toBe("New template");
  });
});
