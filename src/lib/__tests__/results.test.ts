import { describe, expect, it } from "vitest";
import { proofCount, quarterOf, quarterRange, realDate, resultSchema, totalsOf } from "@/lib/results";
import { file, result } from "./fixtures";

describe("quarters", () => {
  it("puts a date in its calendar quarter", () => {
    expect(quarterOf("2026-01-01")).toBe("2026-Q1");
    expect(quarterOf("2026-03-31")).toBe("2026-Q1");
    expect(quarterOf("2026-04-01")).toBe("2026-Q2");
    expect(quarterOf("2026-09-30")).toBe("2026-Q3");
    expect(quarterOf("2026-12-31")).toBe("2026-Q4");
  });
  it("gives the first and last day of a quarter", () => {
    expect(quarterRange("2026-Q1")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(quarterRange("2026-Q3")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(quarterRange("2026-Q4")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(quarterRange("2028-Q1").to).toBe("2028-03-31");
  });
  it("refuses dates that do not exist", () => {
    expect(realDate("2026-02-28")).toBe(true);
    expect(realDate("2026-02-30")).toBe(false);
    expect(realDate("2026-13-01")).toBe(false);
    expect(realDate("2028-02-29")).toBe(true);
  });
});

describe("totalsOf: what counts", () => {
  const list = [
    result({ value: 10, female: 4, male: 6, province: "Kandahar", date: "2026-07-01" }),
    result({ value: 5, female: 5, male: 0, province: "Helmand", date: "2026-09-30" }),
    result({ value: 100, female: 50, male: 50, status: "pending", date: "2026-08-01" }),
    result({ value: 200, female: 100, male: 100, status: "queried", date: "2026-08-02" }),
    result({ value: 7, female: 3, male: 4, province: "Kandahar", date: "2026-10-01" }),
  ];
  it("counts accepted results only", () => {
    expect(totalsOf(list).value).toBe(22);
    expect(totalsOf(list).records).toBe(3);
  });
  it("includes both ends of the date range", () => {
    const q3 = totalsOf(list, "2026-07-01", "2026-09-30");
    expect(q3.value).toBe(15);
    expect(q3.records).toBe(2);
  });
  it("keeps women and men as separate sums that are never merged", () => {
    const q3 = totalsOf(list, "2026-07-01", "2026-09-30");
    expect(q3.female).toBe(9);
    expect(q3.male).toBe(6);
    expect(q3.female + q3.male).toBe(q3.value);
  });
  it("lists each province once", () => {
    expect(totalsOf(list).provinces.sort()).toEqual(["Helmand", "Kandahar"]);
  });
  it("counts proof files and links on counted results", () => {
    const withLink = [result({ links: [{ url: "https://example.org/sheet", title: "Attendance sheet" }] }), result({ files: [], noFile: "On paper in the office" })];
    expect(totalsOf(withLink).files).toBe(2);
    expect(proofCount(withLink[1])).toBe(0);
  });
  it("is zero for an empty list", () => {
    expect(totalsOf([])).toMatchObject({ value: 0, female: 0, male: 0, records: 0, files: 0, provinces: [] });
  });
});

describe("resultSchema: what may be recorded", () => {
  const base = { indicator: "IND-1", date: "2026-08-15", value: 12, note: "Synthetic training session record.", files: [file("a")] };
  it("accepts a result with proof", () => {
    expect(resultSchema.safeParse(base).success).toBe(true);
  });
  it("refuses a result with no proof and no reason", () => {
    expect(resultSchema.safeParse({ ...base, files: [] }).success).toBe(false);
  });
  it("accepts a result with no file when it says why", () => {
    expect(resultSchema.safeParse({ ...base, files: [], noFile: "Sheet is with the field office" }).success).toBe(true);
  });
  it("accepts a link as proof, https only", () => {
    expect(resultSchema.safeParse({ ...base, files: [], links: [{ url: "https://example.org/a", title: "Attendance" }] }).success).toBe(true);
    expect(resultSchema.safeParse({ ...base, files: [], links: [{ url: "http://example.org/a", title: "Attendance" }] }).success).toBe(false);
  });
  it("refuses more young people than people", () => {
    expect(resultSchema.safeParse({ ...base, female: 3, male: 4, youth: 8 }).success).toBe(false);
    expect(resultSchema.safeParse({ ...base, female: 3, male: 4, youth: 7 }).success).toBe(true);
  });
  it("refuses zero, negative values and impossible dates", () => {
    expect(resultSchema.safeParse({ ...base, value: 0 }).success).toBe(false);
    expect(resultSchema.safeParse({ ...base, value: -1 }).success).toBe(false);
    expect(resultSchema.safeParse({ ...base, date: "2026-02-30" }).success).toBe(false);
  });
});
