import { describe, expect, it } from "vitest";
import { feedbackSummary, forViewer, needsAnswer, overdue, sortFeedback, type FeedbackEntry } from "@/lib/feedback";

const e = (over: Partial<FeedbackEntry>): FeedbackEntry => ({ id: "a", date: "2026-10-01", kind: "complaint", from: "farmer", channel: "in person", place: "Kama", about: "The saplings arrived dry.", serious: false, by: "bilal", byName: "Bilal", answer: null, ...over });
const ans = (on: string) => ({ on, text: "Replaced the saplings.", by: "nadia", byName: "Nadia" });

describe("feedback and complaints", () => {
  it("thanks need no answer; the rest do until answered", () => {
    expect(needsAnswer(e({ kind: "thanks" }))).toBe(false);
    expect(needsAnswer(e({}))).toBe(true);
    expect(needsAnswer(e({ answer: ans("2026-10-05") }))).toBe(false);
  });
  it("is overdue after 14 days without an answer", () => {
    expect(overdue(e({}), "2026-10-15")).toBe(false);
    expect(overdue(e({}), "2026-10-16")).toBe(true);
    expect(overdue(e({ answer: ans("2026-10-30") }), "2026-11-21")).toBe(false);
  });
  it("counts a period for the report", () => {
    const s = feedbackSummary([e({ id: "1", answer: ans("2026-10-05") }), e({ id: "2", date: "2026-10-20", kind: "question", answer: ans("2026-10-30") }), e({ id: "3", date: "2026-11-01" }), e({ id: "4", date: "2026-11-02", kind: "thanks" }), e({ id: "5", date: "2026-09-30" })], "2026-10-01", "2026-12-31", "2026-11-21");
    expect(s).toEqual({ received: 4, complaints: 2, answered: 2, open: 1, overdue: 1, averageDays: 7 });
  });
  it("withholds a serious matter's words from everyone but its recorder, plan approvers and administrators", () => {
    const x = e({ serious: true, answer: ans("2026-10-03") });
    expect(forViewer(x, { id: "farida", project: [] })).toMatchObject({ about: "", place: "", withheld: true, answer: { text: "" } });
    expect(forViewer(x, { id: "bilal", project: [] }).about).toBe("The saplings arrived dry.");
    expect(forViewer(x, { id: "tucker", project: ["plan-approver"] }).withheld).toBe(false);
    expect(forViewer(x, { id: "it", admin: true, project: [] }).withheld).toBe(false);
    expect(forViewer(e({}), { id: "farida", project: [] }).withheld).toBe(false);
  });
  it("lists what still needs an answer first, oldest first", () => {
    const out = sortFeedback([e({ id: "done", date: "2026-11-10", answer: ans("2026-11-11") }), e({ id: "new", date: "2026-11-15" }), e({ id: "old", date: "2026-10-01" })]);
    expect(out.map((x) => x.id)).toEqual(["old", "new", "done"]);
  });
});
