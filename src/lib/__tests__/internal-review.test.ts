import { describe, expect, it } from "vitest";
import { drawSample, dueFor, previousQuarter, quarterOf, quarterRange, reviewDuties, testerFor, type Candidate, type Finding } from "@/lib/internal-review";

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

describe("what the internal review asks of each person", () => {
  const roles = { lead: "daniel", reviewer: "peter", focal: "karim", ceo: "tucker" };
  const today = "2027-01-20";
  const item = (tester: "lead" | "reviewer", result = false) => ({ area: "payments" as const, ref: `p:${tester}:${result}`, what: "x", date: "2026-11-01", usd: 1, preparedBy: [], approvedBy: [], why: "x", tester, ...(result ? { result: { ok: true, note: "", by: "daniel", at: today } } : {}) });
  const finding = (over: Partial<Finding>): Finding => ({ id: "F-1", quarter: "2026-Q4", area: "cash", rating: "medium", text: "Not signed.", by: "daniel", at: "2027-01-02", due: "2027-02-01", ...over });

  it("the lead is asked to draw last quarter's sample, late after day 7", () => {
    const d = reviewDuties({ roles, reviews: [], findings: [] }, "daniel", today);
    expect(d[0]).toMatchObject({ text: "draw the sample for October to December", due: "2027-01-07", late: true });
    expect(reviewDuties({ roles, reviews: [], findings: [] }, "karim", today)).toEqual([]);
    expect(reviewDuties({ roles: null, reviews: [], findings: [] }, "daniel", today)).toEqual([]);
  });

  it("the next step goes to its owner, and each tester sees their untested items", () => {
    const book = { roles, reviews: [{ quarter: "2026-Q4", drawnAt: "2027-01-05", drawnBy: "daniel", items: [item("lead"), item("reviewer"), item("reviewer", true)], steps: { sampleSent: { by: "daniel", at: "2027-01-06" } } }], findings: [] };
    expect(reviewDuties(book, "karim", today).map((d) => d.text)).toEqual(["documents filed in the internal audit folder"]);
    expect(reviewDuties(book, "peter", today).map((d) => d.text)).toEqual(["test 1 sample item"]);
    expect(reviewDuties(book, "daniel", today).map((d) => d.text)).toEqual(["test 1 sample item"]);
  });

  it("findings: the focal point answers, the CEO approves, the lead re-tests what is past due", () => {
    const book = { roles, reviews: [], findings: [finding({}), finding({ id: "F-2", response: { text: "Will sign.", by: "karim", at: "2027-01-05" }, due: "2027-01-10" })] };
    expect(reviewDuties(book, "karim", today).map((d) => d.text)).toEqual(["answer 1 finding"]);
    expect(reviewDuties(book, "tucker", today).map((d) => d.text)).toEqual(["approve 1 corrective action"]);
    expect(reviewDuties(book, "daniel", today).map((d) => d.text)).toContain("re-test 1 finding past their due date");
  });
});
