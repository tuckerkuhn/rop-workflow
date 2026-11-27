import { describe, expect, it } from "vitest";
import { lastWorkday, overLimits, prefill, submitProblem, todayIn, type Sheet } from "@/lib/timesheet";

/**
 * Review round 1, ISS-05 and ISS-06: Omid submitted November on the 26th with the 27th and 30th
 * prefilled, and with 12 hours on the 25th shown only in red.
 */
const HO = "Home Office";
const november = (): Sheet => prefill("2026-11", HO, { "non-contract": 1 });
const with12 = (note?: string): Sheet => {
  const s = november();
  s.days["2026-11-25"] = { ...s.days["2026-11-25"], hours: { "non-contract": 8, "A-2027": 4 }, ...(note ? { note } : {}) };
  return s;
};

describe("a timesheet records time after it is worked", () => {
  it("opens for submission on the month's last working day, not before", () => {
    expect(lastWorkday("2026-11", HO)).toBe("2026-11-30");
    // A month ending on a weekend or a holiday opens on the working day before it.
    expect(lastWorkday("2026-10", HO)).toBe("2026-10-30");
    expect(lastWorkday("2026-12", "Afghanistan")).toBe("2026-12-31");
    expect(submitProblem(november(), HO, "2026-11-26")).toMatch(/can be submitted from 30 November, its last working day/);
    expect(submitProblem(november(), HO, "2026-11-30")).toBeNull();
    expect(submitProblem(november(), HO, "2026-12-03")).toBeNull();
  });

  it("refuses worked hours on a day still to come, whenever it is sent", () => {
    // December, sent on its last working day by someone in an office that works Sunday to Thursday, with a later day filled in.
    const s = prefill("2026-12", "Afghanistan", { "A-2027": 1 });
    s.days["2026-12-31"] = { hours: { "A-2027": 8 }, place: "in" };
    expect(submitProblem(s, "Afghanistan", "2026-12-31")).toBeNull();
    const early = prefill("2026-11", HO, { "non-contract": 1 });
    early.days["2026-12-01"] = { hours: { "non-contract": 8 } };
    expect(submitProblem({ ...early, days: { ...early.days } }, HO, "2026-11-30")).toMatch(/1 December has not happened yet/);
  });
});

describe("long days and weeks need a reason the supervisor can read", () => {
  it("a 12-hour day is refused without a note and accepted with one", () => {
    expect(overLimits(with12(), HO).days).toEqual([{ date: "2026-11-25", hours: 12, limit: 8, note: "" }]);
    expect(submitProblem(with12(), HO, "2026-11-30")).toMatch(/25 November has 12 hours, over the 8-hour day. Add a note on that day saying why/);
    expect(submitProblem(with12("ok"), HO, "2026-11-30")).toMatch(/Add a note/);
    const noted = with12("Donor report due: worked late to finish the budget annex.");
    expect(overLimits(noted, HO).days[0].note).toContain("Donor report due");
    expect(submitProblem(noted, HO, "2026-11-30")).toBeNull();
  });

  it("a week over 40 hours with no long day is caught too", () => {
    const s = november();
    // Saturday 21 November worked on top of a full week (Monday 16 to Friday 20).
    s.days["2026-11-21"] = { hours: { "non-contract": 6 } };
    const { days, weeks } = overLimits(s, HO);
    expect(days).toEqual([]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({ from: "2026-11-16", to: "2026-11-22", hours: 46, limit: 40, note: "" });
    expect(submitProblem(s, HO, "2026-11-30")).toMatch(/The week of 16 November has 46 hours, over the 40-hour week. Add a note on 21 November/);
    s.days["2026-11-21"] = { ...s.days["2026-11-21"], note: "Input fair fell on the Saturday." };
    expect(submitProblem(s, HO, "2026-11-30")).toBeNull();
  });

  it("an ordinary month has nothing over", () => {
    expect(overLimits(november(), HO)).toEqual({ days: [], weeks: [] });
  });
});

describe("code review of ISS-05 and ISS-06", () => {
  it("today is the office's own day, not the server's", () => {
    // 22:00 UTC on 29 Nov is already 30 Nov in Kabul, still 29 Nov in Guatemala and California.
    const late = new Date("2026-11-29T22:00:00Z");
    expect(todayIn("Afghanistan", late)).toBe("2026-11-30");
    expect(todayIn("Guatemala", late)).toBe("2026-11-29");
    expect(todayIn("Home Office", late)).toBe("2026-11-29");
    // 03:00 UTC on 1 Dec is still 30 Nov in Guatemala.
    expect(todayIn("Guatemala", new Date("2026-12-01T03:00:00Z"))).toBe("2026-11-30");
  });

  it("a week that began last month counts last month's days of it", () => {
    // December 2026 starts on a Tuesday: Mon 30 Nov belongs to the same week.
    const dec = prefill("2026-12", HO, { "non-contract": 1 });
    for (const d of ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]) dec.days[d] = { hours: { "non-contract": 9 } };
    expect(overLimits(dec, HO).weeks).toHaveLength(0);
    const before = { "2026-11-30": { hours: { "non-contract": 8 } } };
    const w = overLimits(dec, HO, before).weeks;
    expect(w[0]).toMatchObject({ from: "2026-11-30", hours: 44 });
  });

  it("a hard daily cap set by a donor or the personnel policy refuses a longer day outright", () => {
    const s = november();
    s.days["2026-11-10"] = { hours: { "non-contract": 10 }, note: "Field trip ran late" };
    expect(submitProblem(s, HO, "2026-11-30")).toBeNull();
    expect(submitProblem(s, HO, "2026-11-30", { cap: 8 })).toContain("No one may record more than 8 hours in a day");
  });
});
