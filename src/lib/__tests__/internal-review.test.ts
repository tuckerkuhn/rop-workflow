import { describe, expect, it } from "vitest";
import { drawSample, dueFor, previousQuarter, quarterOf, quarterRange, testerFor, type Candidate } from "@/lib/internal-review";

const roles = { lead: "daniel", reviewer: "peter" };
const pay = (i: number, usd: number, by = "yusuf", ok = "karim"): Candidate => ({ area: "payments", ref: `payment:${String(i).padStart(3, "0")}`, what: `Payment ${i}`, date: "2026-10-05", usd, preparedBy: [by], approvedBy: [ok] });

describe("quarterly internal review sample", () => {
  it("takes every payment over $5,000 and 10% of the rest or 25, whichever is larger", () => {
    const many = [...Array.from({ length: 400 }, (_, i) => pay(i, 100 + i)), pay(900, 7000), pay(901, 12000)];
    const s = drawSample(many, "2026-Q4", roles).filter((i) => i.area === "payments");
    expect(s.filter((i) => i.why.startsWith("Over"))).toHaveLength(2);
    expect(s.filter((i) => i.why === "Drawn at random")).toHaveLength(41);
    const few = drawSample(Array.from({ length: 30 }, (_, i) => pay(i, 50)), "2026-Q4", roles).filter((i) => i.area === "payments");
    expect(few).toHaveLength(25);
    const tiny = drawSample(Array.from({ length: 8 }, (_, i) => pay(i, 50)), "2026-Q4", roles).filter((i) => i.area === "payments");
    expect(tiny).toHaveLength(8);
  });

  it("takes every purchase over $1,000 and 5 below, one payroll month in full, every bank month and award", () => {
    const c: Candidate[] = [
      ...Array.from({ length: 9 }, (_, i): Candidate => ({ area: "procurement", ref: `procurement:${i}`, what: "", date: "2026-11-01", usd: i < 3 ? 4000 : 300, preparedBy: [], approvedBy: [] })),
      ...["2026-10", "2026-11", "2026-12"].flatMap((m) => [1, 2].map((g): Candidate => ({ area: "payroll", ref: `payroll:${m}-${g}`, what: "", date: `${m}-01`, usd: 1, preparedBy: [], approvedBy: [], group: m }))),
      { area: "cash", ref: "bank:1:2026-10", what: "", date: "2026-10-01", usd: 0, preparedBy: [], approvedBy: [] },
      { area: "donor", ref: "award:A", what: "", date: "2026-12-31", usd: 0, preparedBy: [], approvedBy: [] },
    ];
    const s = drawSample(c, "2026-Q4", roles);
    expect(s.filter((i) => i.area === "procurement" && i.usd > 1000)).toHaveLength(3);
    expect(s.filter((i) => i.area === "procurement" && i.usd <= 1000)).toHaveLength(5);
    const payroll = s.filter((i) => i.area === "payroll");
    expect(payroll).toHaveLength(2);
    expect(new Set(payroll.map((i) => i.group)).size).toBe(1);
    expect(s.filter((i) => i.area === "cash" || i.area === "donor" || i.area === "assets")).toHaveLength(3);
  });

  it("draws the same sample for the same quarter, a different one for another", () => {
    const many = Array.from({ length: 200 }, (_, i) => pay(i, 100));
    const refs = (q: string) => drawSample(many, q, roles).map((i) => i.ref).join();
    expect(refs("2026-Q4")).toBe(refs("2026-Q4"));
    expect(refs("2026-Q4")).not.toBe(refs("2027-Q1"));
  });

  it("nobody tests what they prepared or approved", () => {
    expect(testerFor({ preparedBy: ["yusuf"], approvedBy: ["karim"] }, roles)).toBe("lead");
    expect(testerFor({ preparedBy: ["yusuf"], approvedBy: ["daniel"] }, roles)).toBe("reviewer");
    expect(testerFor({ preparedBy: ["peter"], approvedBy: ["daniel"] }, roles)).toBe("someone else");
  });

  it("rates findings by when they are due, and knows its quarters", () => {
    expect(dueFor("high", "2027-02-10", "2026-Q4")).toBe("2027-02-12");
    expect(dueFor("medium", "2027-02-10", "2026-Q4")).toBe("2027-03-12");
    expect(dueFor("low", "2027-02-10", "2026-Q4")).toBe("2027-05-19");
    expect(quarterOf("2026-11-24")).toBe("2026-Q4");
    expect(previousQuarter("2027-Q1")).toBe("2026-Q4");
    expect(quarterRange("2026-Q4")).toMatchObject({ start: "2026-10-01", end: "2026-12-31" });
  });
});
