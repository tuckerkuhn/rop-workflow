import { describe, expect, it } from "vitest";
import { lessonForReport, lessonsInQuarter, type Lesson } from "@/lib/learning";
import { qprFacts } from "@/server/qpr-drafts";
import type { QprData } from "@/server/qpr-store";

/** The quarterly report's Lessons Learned comes from the lessons record: the quarter's lessons only. */

const lesson = (id: string, date: string, extra: Partial<Lesson> = {}): Lesson => ({
  id,
  date,
  area: "Programme",
  happened: "Seedlings arrived two weeks late in Kandahar.",
  lesson: "Order seedlings before the cold season starts",
  action: "Place orders in August.",
  by: "u-1",
  byName: "Staff Member",
  applied: null,
  ...extra,
});

const record = [lesson("before", "2026-06-30"), lesson("last", "2026-09-30"), lesson("first", "2026-07-01"), lesson("mid", "2026-08-15"), lesson("after", "2026-10-01")];

describe("lessons in a quarter", () => {
  it("keeps only the lessons dated in the quarter, oldest first", () => {
    expect(lessonsInQuarter(record, "2026-Q3").map((l) => l.id)).toEqual(["first", "mid", "last"]);
    expect(lessonsInQuarter(record, "2026-Q2").map((l) => l.id)).toEqual(["before"]);
    expect(lessonsInQuarter(record, "2026-Q1")).toEqual([]);
  });

  it("leaves out who recorded the lesson", () => {
    const [l] = lessonsInQuarter(record, "2026-Q4");
    expect(l).toEqual({ id: "after", date: "2026-10-01", area: "Programme", happened: record[4].happened, lesson: record[4].lesson, action: record[4].action });
  });

  it("writes a lesson as one paragraph for the report", () => {
    const [l] = lessonsInQuarter(record, "2026-Q4");
    expect(lessonForReport(l)).toBe("Programme. What happened: Seedlings arrived two weeks late in Kandahar. What we learned: Order seedlings before the cold season starts. What we will do differently: Place orders in August.");
  });
});

describe("drafting facts", () => {
  const d = {
    project: { code: "P", name: "Project", goal: "Goal", donor: "UNDP", start: null, end: null },
    quarter: "2026-Q3",
    activities: [],
    rows: [],
    results: [],
    updates: [],
    lessons: lessonsInQuarter([...record, lesson("named", "2026-08-20", { happened: "Haji Baryal Noorzad lost his seedlings to frost." })], "2026-Q3"),
  } as unknown as QprData;

  it("include the quarter's lessons and no others", () => {
    const facts = qprFacts(d);
    expect(facts.lessons_this_quarter.map((l) => l.date)).toEqual(["2026-07-01", "2026-08-15", "2026-08-20", "2026-09-30"]);
    expect(facts.lessons_this_quarter[0]).toEqual({ date: "2026-07-01", area: "Programme", happened: record[2].happened, lesson: record[2].lesson, action: record[2].action });
  });

  it("carry no names: not the farmer's, not the person who recorded it", () => {
    const text = JSON.stringify(qprFacts(d).lessons_this_quarter);
    expect(text).not.toContain("Baryal");
    expect(text).not.toContain("Noorzad");
    expect(text).not.toContain("Staff Member");
    expect(text).not.toContain("u-1");
  });
});
