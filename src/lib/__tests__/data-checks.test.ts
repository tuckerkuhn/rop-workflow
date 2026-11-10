import { describe, expect, it } from "vitest";
import { dataChecks } from "@/lib/data-checks";
import { file, result } from "./fixtures";

const ind = { code: "IND-1", unit: "farmers", disaggregation: ["sex", "province"] };
const clean = () => result({ value: 10, female: 4, male: 6, province: "Kandahar" });

describe("data checks before MEL accepts", () => {
  it("raises nothing on a clean record", () => {
    const r = clean();
    expect(dataChecks(r, [r], ind)).toEqual([]);
  });
  it("flags a possible double count: same date, value, place and proof", () => {
    const shared = file("same");
    const a = result({ value: 10, female: 4, male: 6, province: "Kandahar", files: [shared] });
    const b = result({ value: 10, female: 4, male: 6, province: "Kandahar", files: [shared], status: "pending" });
    expect(dataChecks(b, [a, b], ind).some((f) => /counted twice/.test(f))).toBe(true);
  });
  it("does not call two different records on one day a double count", () => {
    const a = result({ value: 10, female: 4, male: 6, province: "Kandahar", note: "Morning session, first group of farmers." });
    const b = result({ value: 10, female: 4, male: 6, province: "Kandahar", note: "Afternoon session, second group of farmers." });
    expect(dataChecks(b, [a, b], ind).some((f) => /counted twice/.test(f))).toBe(false);
  });
  it("flags a value more than four times the usual", () => {
    const others = [10, 12, 14].map((value, k) => result({ value, female: value, male: 0, province: "Kandahar", note: `Synthetic record number ${k}.`, date: `2026-07-0${k + 1}` }));
    const big = result({ value: 60, female: 30, male: 30, province: "Kandahar", note: "Synthetic large record for the check." });
    expect(dataChecks(big, [...others, big], ind).some((f) => /four times/.test(f))).toBe(true);
    const fine = result({ value: 48, female: 24, male: 24, province: "Kandahar", note: "Synthetic record at the limit." });
    expect(dataChecks(fine, [...others, fine], ind).some((f) => /four times/.test(f))).toBe(false);
  });
  it("flags women and men that do not add up to the total, for people", () => {
    const r = result({ value: 10, female: 4, male: 5, province: "Kandahar" });
    expect(dataChecks(r, [r], ind)).toContain("4 women and 5 men make 9, not 10.");
    expect(dataChecks(r, [r], { ...ind, unit: "hectares" }).some((f) => /women and/.test(f))).toBe(false);
  });
  it("flags a missing breakdown the indicator is reported by", () => {
    const r = result({ value: 10 });
    const flags = dataChecks(r, [r], ind);
    expect(flags).toContain("This target is reported by women and men, but the record has no women and men.");
    expect(flags).toContain("This target is reported by province, but the record has none.");
  });
  it("flags no proof, with the reason given", () => {
    const r = result({ value: 10, female: 4, male: 6, province: "Kandahar", files: [], noFile: "Sheet at the office" });
    expect(dataChecks(r, [r], ind)).toContain("No proof attached (Sheet at the office).");
  });
  it("flags photos all dated after the quarter the result is counted in", () => {
    const f = file("p", "image/jpeg");
    const r = result({ value: 10, female: 4, male: 6, province: "Kandahar", date: "2026-09-20", files: [f], taken: { [f.hash]: "2026-10-05" } });
    expect(dataChecks(r, [r], ind).some((x) => /after the quarter it is counted in \(ends 2026-09-30\)/.test(x))).toBe(true);
    const ok = result({ value: 10, female: 4, male: 6, province: "Kandahar", date: "2026-09-20", files: [f], taken: { [f.hash]: "2026-09-30" } });
    expect(dataChecks(ok, [ok], ind)).toEqual([]);
  });
  it("flags text not yet translated", () => {
    const r = result({ value: 10, female: 4, male: 6, province: "Kandahar", original: { lang: "fa", pending: true } });
    expect(dataChecks(r, [r], ind).some((x) => /not yet translated/.test(x))).toBe(true);
  });
});
