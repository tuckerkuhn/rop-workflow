import { describe, expect, it } from "vitest";
import { waitingCount, waitingRows } from "@/lib/home-buckets";
import type { HomeAction } from "@/server/home-store";
import type { NextReport } from "@/server/next-report";

const action = (key: string, bucket: HomeAction["bucket"], urgent = false): HomeAction => ({ key, for: "lead", bucket, urgent, text: key, href: "/x" });
const report = (over: Partial<NextReport> = {}): NextReport => ({
  quarter: "2026-Q4",
  deadline: { due: "2027-01-15", aim: "2027-01-10", reviewDays: 5, source: null },
  daysLeft: 20,
  released: false,
  blocking: 1,
  items: [
    { owner: "mel", text: "3 results waiting", href: "/progress/results", blocks: true },
    { owner: "finance", text: "Spending not imported", href: "/progress/budget", blocks: true },
    { owner: "writers", text: "2 sections not written", href: "/progress/report", blocks: false },
  ],
  ...over,
});
const review = { key: "review", what: "November monthly review", date: "2026-11-30", days: 20, href: "/progress/review" };

describe("Home: Approve, Fix, Due", () => {
  it("puts each action in its group", () => {
    const rows = waitingRows({ actions: [action("accept", "approve"), action("queried", "fix"), action("import", "due")], lenses: ["field"], report: null, deadlines: [] });
    expect(rows.approve.map((r) => r.key)).toEqual(["accept"]);
    expect(rows.fix.map((r) => r.key)).toEqual(["queried"]);
    expect(rows.due.map((r) => r.key)).toEqual(["import"]);
  });
  it("lists only this person's part of what stands before the report, blockers first", () => {
    const rows = waitingRows({ actions: [], lenses: ["mel"], report: report(), deadlines: [] });
    expect(rows.fix.map((r) => r.item?.text)).toEqual(["3 results waiting", "2 sections not written"]);
    expect(rows.fix[0].urgent).toBe(true);
  });
  it("shows the report's ready-by date to those who write or release it, and the review to leads", () => {
    const lead = waitingRows({ actions: [], lenses: ["lead"], report: report(), deadlines: [review] });
    expect(lead.due.map((r) => r.key)).toEqual(["report-due", "review-due"]);
    expect(lead.due[0].due).toMatchObject({ date: "2027-01-10", days: 20 });
    const finance = waitingRows({ actions: [], lenses: ["finance"], report: report(), deadlines: [review] });
    expect(finance.due).toEqual([]);
    expect(finance.fix.map((r) => r.item?.text)).toEqual(["Spending not imported"]);
  });
  it("a released report leaves nothing to fix or hand in", () => {
    const rows = waitingRows({ actions: [], lenses: ["mel"], report: report({ released: true }), deadlines: [] });
    expect(waitingCount(rows)).toBe(0);
  });
  it("urgent rows come first within a group", () => {
    const rows = waitingRows({ actions: [action("a", "approve"), action("b", "approve", true)], lenses: ["lead"], report: null, deadlines: [] });
    expect(rows.approve.map((r) => r.key)).toEqual(["b", "a"]);
  });
});
