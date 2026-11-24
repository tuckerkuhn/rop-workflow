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
    expect(suggestPriorities([p({}), p({ code: "B", short: "Grapes", approvals: [a] })])[0].text).toBe("Sign off the October monthly review (Grapes)");
    expect(suggestPriorities([p({ approvals: [{ ...a, short: "Maize" }] })])[0].text).toBe("Sign off the October monthly review");
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

import { weekScore, withCarried, type WeekPlan } from "@/lib/week";

describe("from one week to the next", () => {
  const last: WeekPlan = { week: "2026-11-16", confirmedAt: "2026-11-16T14:00:00Z", items: [
    { id: "approvals", text: "Decide the 2 approvals waiting on you", href: "/work", own: false, done: true },
    { id: "own:1", text: "Write the article", href: "", own: true, done: false },
    { id: "budget", text: "Explain the budget line that is over budget", href: "/progress/budget", own: false, done: false },
  ] };
  it("carries what was confirmed and not done to the top of the next week, once", () => {
    const out = withCarried(last, [{ id: "budget", text: "Explain the budget line that is over budget", href: "/progress/budget" }, { id: "weekly", text: "Get last week's weekly update sent", href: "/progress/weekly" }]);
    expect(out.map((x) => [x.id, !!x.carried, !!x.own])).toEqual([["carried:own:1", true, true], ["budget", true, false], ["weekly", false, false]]);
  });
  it("keeps one carried mark on a line of your own carried a second week", () => {
    const again: WeekPlan = { week: "2026-11-23", confirmedAt: "2026-11-23T14:00:00Z", items: [{ id: "carried:own:1", text: "Write the article", href: "", own: true, done: false }] };
    expect(withCarried(again, []).map((x) => x.id)).toEqual(["carried:own:1"]);
  });
  it("carries nothing from a week that was never confirmed, and never more than three", () => {
    const fresh = [1, 2, 3, 4].map((k) => ({ id: `f${k}`, text: `Fresh ${k}`, href: "/work" }));
    expect(withCarried({ ...last, confirmedAt: null }, fresh).map((x) => x.id)).toEqual(["f1", "f2", "f3"]);
    expect(withCarried(null, fresh)).toHaveLength(3);
    expect(withCarried(last, fresh)).toHaveLength(3);
  });
  it("scores a confirmed week", () => {
    expect(weekScore(last)).toEqual({ done: 1, of: 3, left: 2 });
    expect(weekScore({ ...last, confirmedAt: null })).toBeNull();
  });
});

import { weekKindOf, type FinanceWork, type MelWork } from "@/lib/week";

const fin = (over: Partial<FinanceWork>): FinanceWork => ({ unclosed: [], importWanted: "2026-10", importedTo: "2026-10", overspent: [], ahead: false, purchases: [], billsToVoucher: [], imported: 0, closed: [], filed: 0, ...over });
const mel = (over: Partial<MelWork>): MelWork => ({ results: { n: 0, since: null }, forms: { n: 0, since: null }, queried: 0, mismatched: 0, noData: 0, behind: [], ...over });

describe("a week for Finance and for MEL", () => {
  const person = (over: Partial<{ kind: string; project: string[]; field: string[] }>) => ({ kind: "employee", project: [], field: [], ...over });
  it("chooses one week per person, the first that fits", () => {
    expect(weekKindOf(person({ project: ["finance-import"] }), ["lead", "finance"])).toBe("lead");
    expect(weekKindOf(person({ project: ["technical-lead", "mel-owner"] }), ["mel"])).toBe("technical");
    expect(weekKindOf(person({ field: ["manager"] }), ["field", "finance"])).toBe("manager");
    expect(weekKindOf(person({}), ["finance", "procurement"])).toBe("finance");
    expect(weekKindOf(person({ field: ["mel"] }), ["field"])).toBe("mel");
    expect(weekKindOf(person({ project: ["mel-owner"] }), ["mel", "finance"])).toBe("finance");
    expect(weekKindOf(person({ field: ["extension"] }), ["field"])).toBeNull();
    expect(weekKindOf(person({ kind: "donor" }), ["lead"])).toBeNull();
  });

  it("tells Finance about month close, imports, budget lines, what waits and what changed", () => {
    const projects = [p({ approvals: [{ text: "Approve the purchase", href: "/work", since: "2026-11-10", short: "Maize", key: "purchase:PR-1" }], finance: fin({ importedTo: "2026-09", unclosed: [{ month: "2026-09", blockers: 2 }], overspent: ["1.1", "2.3"], purchases: [{ id: "PR-1", title: "Seed", step: "Pay the supplier", since: "2026-11-17" }], billsToVoucher: [{ id: "B-1", since: "2026-11-20" }], imported: 1, closed: ["2026-08"] }) })];
    const org = { expenses: { n: 2, since: "2026-11-19" }, payroll: [{ month: "2026-11", since: "2026-11-21" }] };
    const s = weekSummaryFor("finance", projects, "2026-11-23", org);
    expect(s.map((x) => x.kind)).toEqual(["due", "risk", "waiting", "changed"]);
    expect(text(s[0])).toBe("Maize: spending for October 2026 is not imported yet (imported to September 2026). September 2026 is not closed for Maize: 2 vouchers still to finish, file or post. ");
    expect(s[0].flag).toBe(true);
    expect(s[0].parts.find((x) => x.href)?.href).toBe("/progress/budget?project=A-2027");
    expect(text(s[1])).toBe("Maize has 2 budget lines over budget: 1.1, 2.3. ");
    // Home's purchase row is the same purchase: counted once.
    expect(text(s[2])).toBe("Waiting on you: 1 purchase step, the voucher for 1 approved bill, 2 expense reports and the November 2026 payroll, the oldest for 6 days.");
    expect(s[2].parts.find((x) => x.t === "1 purchase step")?.href).toBe("/work?source=procurement&open=PR-1&project=A-2027");
    expect(text(s[3])).toBe("In the last seven days spending was imported for Maize and August 2026 was closed for Maize.");
    expect(suggestFor("finance", projects, org).map((x) => x.text)).toEqual(["Approve the November 2026 payroll", "Pay the supplier: PR-1 Seed", "Check the 2 expense reports waiting on you"]);
  });

  it("says a quiet Finance week plainly", () => {
    const s = weekSummaryFor("finance", [p({ finance: fin({}) })], "2026-11-23");
    expect(s.map(text)).toEqual(["Every past month is closed and spending is imported.", "No budget line is over budget and no project is spending ahead of the time gone.", "Nothing is waiting on you.", "No spending was imported and no month was closed in the last seven days."]);
    expect(s.some((x) => x.flag)).toBe(false);
    expect(suggestFor("finance", [p({ finance: fin({ unclosed: [{ month: "2026-10", blockers: 0 }] }) })]).map((x) => x.text)).toEqual(["Close October 2026 for Maize"]);
  });

  it("tells MEL what waits to be checked, oldest first, what was sent back, the targets and the reports", () => {
    const projects = [p({ blocking: 4, reports: [{ ...q4, days: 21 }], released: ["Q3 2026 quarterly report"], mel: mel({ results: { n: 4, since: "2026-11-11" }, forms: { n: 3, since: "2026-11-18" }, queried: 2, mismatched: 1, noData: 3, behind: ["1.1", "2.3"] }) })];
    const s = weekSummaryFor("mel", projects, "2026-11-23");
    expect(s.map(text)).toEqual([
      "Waiting for you to check: 4 results, the oldest for 12 days and 3 field forms from KoboCollect, the oldest for 5 days.",
      "2 results sent back for correction are still not corrected. 1 accepted result no longer matches KoboToolbox: reopen to check the new figure. ",
      "Before the next Maize report, 3 targets have no data, 2 targets are behind (1.1, 2.3) and 4 checks block the report. ",
      "The Q4 quarterly report for Maize is due in 21 days. In the last seven days Q3 2026 quarterly report for Maize was released.",
    ]);
    expect(s[0].flag).toBe(true);
    expect(s[0].parts.find((x) => x.t === "3 field forms")?.href).toBe("/progress/results?project=A-2027#field-records");
    expect(suggestFor("mel", projects).map((x) => x.id)).toEqual(["check-results", "check-forms", "block:A-2027"]);
  });

  it("says a quiet MEL week plainly", () => {
    const s = weekSummaryFor("mel", [p({ mel: mel({}) })], "2026-11-23");
    expect(s.map(text)).toEqual(["No result or field form is waiting for you to check.", "No result sent back is waiting to be corrected.", "Every target has data, none is behind and nothing blocks the next report.", "No report is due in the next 30 days. "]);
    expect(s.some((x) => x.flag)).toBe(false);
    expect(suggestFor("mel", [p({ mel: mel({}) })])).toEqual([]);
  });
});

import { booksCheckParts } from "@/lib/week";
describe("the nightly check of the books on the week", () => {
  it("names a problem, says when it stopped running, and is silent otherwise", () => {
    const text = (parts: { t: string }[]) => parts.map((p) => p.t).join("");
    expect(booksCheckParts(null, "2027-01-10")).toEqual([]);
    expect(booksCheckParts({ at: "2027-01-10T03:15:00Z", ok: true, problems: [] }, "2027-01-10")).toEqual([]);
    expect(text(booksCheckParts({ at: "2027-01-10T03:15:00Z", ok: false, problems: ["The trial balance is off by 10.00.", "October no longer matches the bank."] }, "2027-01-10"))).toBe(
      "The nightly check of the books found a problem: The trial balance is off by 10.00 (and 1 more). Finance looks at it before anything else is posted.",
    );
    expect(text(booksCheckParts({ at: "2027-01-05T03:15:00Z", ok: true, problems: [] }, "2027-01-10"))).toBe("The nightly check of the books has not run since 2027-01-05.");
  });
});
