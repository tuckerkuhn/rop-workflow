import { describe, expect, it } from "vitest";
import { mondayOf, safeHref, suggestPriorities, weekNumbers, weekSummary, withProject, type ProjectWeek } from "@/lib/week";

const p = (over: Partial<ProjectWeek>): ProjectWeek => ({ code: "A-2027", short: "Maize", late: 0, reports: [], blocking: 0, blockingHref: "/progress/report#checks", approvals: [], complaintsLate: 0, complaintsNew: 0, complaintsAnswered: 0, released: [], ...over });
const text = (s: { parts: { t: string }[] }) => s.parts.map((x) => x.t).join("");
const q4 = { label: "Q4 quarterly report", due: "2027-01-15", days: 5, late: false, href: "/progress/report?q=2026-Q4#checks" };

describe("the week ahead", () => {
  it("finds the Monday of any day", () => {
    expect(mondayOf("2026-11-22")).toBe("2026-11-16");
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });
  it("says a quiet week in plain words, with nothing flagged", () => {
    const s = weekSummary([p({})], "2026-11-23");
    expect(s.map(text)).toEqual(["No report is due in the next 14 days.", "Nothing is blocked and no project is behind its targets.", "Nothing is waiting on you.", "No report was released and no complaint came in or was answered in the last seven days."]);
    expect(s.some((x) => x.flag)).toBe(false);
  });
  it("names what is due, what is at risk, what waits and what changed, each figure a link", () => {
    const s = weekSummary([p({ reports: [q4], blocking: 10, late: 2, approvals: [{ text: "Voucher 12", href: "/work", since: "2027-01-04", short: "Maize" }, { text: "Leave", href: "/leave", since: "2027-01-08", short: "Maize" }], complaintsNew: 1, complaintsAnswered: 1 })], "2027-01-10");
    expect(text(s[0])).toBe("1 report is due in the next 14 days: Q4 quarterly report for Maize in 5 days.");
    expect(text(s[1])).toBe("The next Maize report is blocked by 10 things. Maize has 2 results behind this year's target. ");
    expect(s[1].flag).toBe(true);
    expect(text(s[2])).toBe("2 approvals are waiting on you, the oldest for 6 days.");
    expect(text(s[3])).toBe("In the last seven days 1 complaint or question was answered and 1 new complaint or question came in.");
    expect(s[0].parts.some((x) => "href" in x && x.href === q4.href)).toBe(true);
  });
  it("puts a late report first and flags it", () => {
    const s = weekSummary([p({ reports: [{ ...q4, days: -3, late: true }] })], "2027-01-18");
    expect(text(s[0])).toBe("1 report is late: Q4 quarterly report for Maize. ");
    expect(s[0].flag).toBe(true);
  });
  it("gives three numbers with a level each", () => {
    const [a, b, c] = weekNumbers([p({}), p({ code: "B", short: "Grapes", late: 3, reports: [q4], complaintsLate: 2 })]);
    expect([a.value, a.level]).toEqual(["1 of 2", "warning"]);
    expect([b.value, b.level]).toEqual(["1", "warning"]);
    expect([c.value, c.level, c.href]).toEqual(["2", "critical", "/progress/feedback?project=B"]);
    expect(weekNumbers([p({})]).map((x) => x.level)).toEqual(["good", "good", "good"]);
  });
  it("proposes at most three priorities, the most pressing first", () => {
    const many = Array.from({ length: 4 }, (_, k) => p({ code: `P${k}`, short: `P${k}`, late: 1, reports: [{ ...q4, late: true, days: -1 }], blocking: 2, complaintsLate: 1, approvals: [{ text: "x", href: "/work", since: null, short: `P${k}` }] }));
    const out = suggestPriorities(many);
    expect(out).toHaveLength(3);
    expect(out[0].id).toBe("late:P0:Q4 quarterly report");
    expect(suggestPriorities([p({})])).toEqual([]);
    expect(suggestPriorities([p({ reports: [q4], blocking: 3 })]).map((x) => x.text)).toEqual(["Clear what blocks the next Maize report (3 things)"]);
  });
  it("keeps only links into the app", () => {
    expect(safeHref("/progress/report?q=2026-Q4#checks")).toBe("/progress/report?q=2026-Q4#checks");
    expect(safeHref("https://evil.example")).toBe("");
    expect(safeHref("//evil.example")).toBe("");
    expect(safeHref("javascript:alert(1)")).toBe("");
  });
});

describe("approvals across projects", () => {
  it("opens each link on its own project", () => {
    expect(withProject("/progress/review", "B-1")).toBe("/progress/review?project=B-1");
    expect(withProject("/progress/report?q=2026-Q4#checks", "B-1")).toBe("/progress/report?q=2026-Q4&project=B-1#checks");
    expect(withProject("/progress/results#field-records", "B-1")).toBe("/progress/results?project=B-1#field-records");
    expect(withProject("/progress/results?project=A", "B-1")).toBe("/progress/results?project=A");
    expect(withProject("/approve/A-2027/x", "B-1")).toBe("/approve/A-2027/x");
  });
  it("names the project when there is more than one", () => {
    const a = { text: "Sign off the October monthly review", href: "/progress/review?project=B", since: "2027-01-02", short: "Grapes" };
    expect(suggestPriorities([p({}), p({ code: "B", short: "Grapes", approvals: [a] })])[0].text).toBe("Decide for Grapes: Sign off the October monthly review");
    expect(suggestPriorities([p({ approvals: [{ ...a, short: "Maize" }] })])[0].text).toBe("Decide: Sign off the October monthly review");
  });
});

import { suggestFor, weekSummaryFor, type ProjectWork } from "@/lib/week";

const work = (over: Partial<ProjectWork>): ProjectWork => ({ overBudget: 0, toCheck: 0, queried: 0, fieldIssues: 0, farmers: 0, undecided: 0, rulesWritten: true, lastWeekSent: true, thisWeekStarted: true, weeklyKept: true, ...over });

describe("a week for each job", () => {
  it("leaves leadership's four sentences as they are", () => {
    expect(weekSummaryFor("lead", [p({})], "2026-11-23").map(text)).toEqual(weekSummary([p({})], "2026-11-23").map(text));
  });
  it("tells a project manager about money, checks and the weekly update", () => {
    const s = weekSummaryFor("manager", [p({ work: work({ overBudget: 1, toCheck: 10, queried: 2, lastWeekSent: false }) })], "2026-11-23");
    expect(text(s[1])).toBe("1 budget line is over budget. 10 results wait for MEL to check and will not count until then. ");
    expect(s[1].flag).toBe(true);
    expect(text(s[2])).toBe("Nothing is waiting on you. 2 results MEL sent back are to correct.");
    expect(text(s[3])).toMatch(/Last week's weekly update was not sent\.$/);
    expect(suggestFor("manager", [p({ work: work({ overBudget: 1, queried: 2, lastWeekSent: false }) })]).map((x) => x.id)).toEqual(["budget", "queried", "weekly"]);
  });
  it("tells a technical lead about the farmers, the field and the team's updates", () => {
    const s = weekSummaryFor("technical", [p({ late: 1, work: work({ farmers: 12, undecided: 5, fieldIssues: 3, queried: 2, thisWeekStarted: false }) })], "2026-11-23");
    expect(text(s[0])).toBe("5 of 12 farmers are still waiting on a selection decision.");
    expect(text(s[1])).toBe("3 field issues are open. 2 results were sent back by MEL to correct. Maize has 1 result behind this year's target. ");
    expect(text(s[2])).toBe("Nothing is waiting on you.");
    expect(text(s[3])).toBe("This week's weekly update is not started.");
    expect(s[0].parts[0]).toMatchObject({ href: "/work/selection?project=A-2027" });
    expect(suggestFor("technical", [p({ work: work({ farmers: 12, undecided: 5, fieldIssues: 3, queried: 2 }) })]).map((x) => x.id)).toEqual(["selection", "issues", "queried"]);
  });
  it("says a quiet field week plainly, and asks for the rules before anything else", () => {
    const quiet = weekSummaryFor("technical", [p({ work: work({ farmers: 12 }) })], "2026-11-23");
    expect(quiet.map(text)).toEqual(["All 12 farmers on the list have a selection decision.", "No field issue is open, no result was sent back and no result is behind target.", "Nothing is waiting on you.", "The weekly updates are up to date."]);
    expect(quiet.some((x) => x.flag)).toBe(false);
    const none = [p({ work: work({ farmers: 12, rulesWritten: false }) })];
    expect(text(weekSummaryFor("technical", none, "2026-11-23")[0])).toBe("The selection rules are not written yet, with 12 farmers on the list.");
    expect(suggestFor("technical", none).map((x) => x.id)).toEqual(["rules"]);
  });
  it("does not call a project that never wrote a weekly update up to date", () => {
    const none = [p({ work: work({ farmers: 3, weeklyKept: false }) })];
    expect(text(weekSummaryFor("technical", none, "2026-11-23")[3])).toBe("No weekly update has been written for this project yet.");
    expect(text(weekSummaryFor("manager", none, "2026-11-23")[3])).not.toMatch(/weekly/);
  });
  it("words a single item as one thing", () => {
    expect(suggestFor("manager", [p({ work: work({ overBudget: 1, queried: 1 }) })]).map((x) => x.text)).toEqual(["Explain the budget line that is over budget", "Have the result MEL sent back corrected"]);
  });
});
