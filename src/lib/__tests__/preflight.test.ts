import { describe, expect, it } from "vitest";
import { addDays, blockers, daysBetween, deadlineFor, draftMark, parseReport, periodOf, preflightHref, urgency, type PreflightItem } from "@/lib/preflight";

describe("deadlines", () => {
  it("adds and counts days across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-09-30", "2026-10-15")).toBe(15);
  });
  const milestones = [
    { title: "Q3 report deadline", date: "2026-10-20", done: false },
    { title: "Q2 report deadline", date: "2026-07-20", done: true },
    { title: "Q4 report deadline", date: "2027-01-20", done: false },
  ];
  it("uses the first open milestone after the period ends", () => {
    const d = deadlineFor("2026-09-30", 60, milestones, 30, "30 days after the quarter", 5);
    expect(d.due).toBe("2026-10-20");
    expect(d.aim).toBe("2026-10-15");
    expect(d.source).toEqual({ kind: "milestone", title: "Q3 report deadline" });
  });
  it("falls back to the policy's days when no milestone is in the window", () => {
    const d = deadlineFor("2026-09-30", 10, milestones, 30, "30 days after the quarter", 5);
    expect(d.due).toBe("2026-10-30");
    expect(d.aim).toBe("2026-10-25");
    expect(d.source).toMatchObject({ kind: "policy", days: 30 });
  });
  it("ignores a milestone already done", () => {
    const d = deadlineFor("2026-06-30", 60, milestones, null, "", 5);
    expect(d.due).toBeNull();
    expect(d.aim).toBeNull();
    expect(d.source).toBeNull();
  });
  it("says near, missed the aim, or past", () => {
    const d = deadlineFor("2026-09-30", 60, milestones, 30, "", 5);
    expect(urgency(d, "2026-10-01")).toBeNull();
    expect(urgency(d, "2026-10-08")).toBe("near");
    expect(urgency(d, "2026-10-15")).toBe("near");
    expect(urgency(d, "2026-10-16")).toBe("missed-aim");
    expect(urgency(d, "2026-10-20")).toBe("missed-aim");
    expect(urgency(d, "2026-10-21")).toBe("past");
  });
});

describe("report references", () => {
  it("counts only what blocks", () => {
    const item = (group: "blocks" | "fix"): PreflightItem => ({ group, owner: "mel", text: "t", href: "/" });
    expect(blockers({ items: [item("blocks"), item("fix"), item("blocks")] })).toBe(2);
    expect(blockers({ items: [] })).toBe(0);
  });
  it("reads a report reference and refuses a malformed one", () => {
    expect(parseReport("qpr", "2026-Q3")).toEqual({ kind: "qpr", quarter: "2026-Q3" });
    expect(parseReport("annual", "2026")).toEqual({ kind: "annual", year: 2026 });
    expect(parseReport("face", "2026-09")).toEqual({ kind: "face", month: "2026-09" });
    expect(parseReport("qpr", "2026-Q5")).toBeNull();
    expect(parseReport("qpr", null)).toBeNull();
    expect(parseReport("other", "2026")).toBeNull();
  });
  it("links to pre-flight for the same report", () => {
    const r = parseReport("qpr", "2026-Q3")!;
    expect(periodOf(r)).toBe("2026-Q3");
    expect(preflightHref(r)).toBe("/progress/preflight?report=qpr&period=2026-Q3");
  });
  it("marks a file downloaded with blockers as a draft", () => {
    expect(draftMark(1)).toContain("1 item blocks");
    expect(draftMark(3)).toContain("3 items block");
    expect(draftMark(3)).toContain("Not for the donor");
  });
});

describe("a file made when pre-flight could not be read", () => {
  it("is still marked a draft, and says why", async () => {
    const { UNCHECKED } = await import("@/lib/preflight");
    expect(draftMark(UNCHECKED)).toContain("DRAFT, NOT CHECKED");
    expect(draftMark(UNCHECKED)).toContain("could not be run");
    // Callers test the number for truth to decide whether to mark the file: it must not be zero.
    expect(Boolean(UNCHECKED)).toBe(true);
  });
});
