import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION, decisionProblem, failedRules, inFieldQueue, isException, isStale, outcomeOf, outcomesById, selectionCounts, type Selection } from "@/lib/selection";

const who = { by: "nadia", byName: "Nadia", on: "2026-11-22" };
const rules: Selection = { ...EMPTY_SELECTION, outreach: "Announced at the village meeting.", criteria: [{ id: "a", text: "Farms 0.2 to 2 ha" }, { id: "b", text: "Lives in a project village" }], version: 1, criteriaBy: who };

describe("farmer selection", () => {
  it("needs the rules written before anyone is decided", () => {
    expect(decisionProblem(EMPTY_SELECTION, { outcome: "selected", met: [], reason: "" })).toMatch(/rules first/);
  });
  it("takes a farmer who meets every rule with no reason", () => {
    expect(decisionProblem(rules, { outcome: "selected", met: ["a", "b"], reason: "" })).toBeNull();
  });
  it("waitlists only a farmer who meets every rule, with a reason", () => {
    expect(decisionProblem(rules, { outcome: "waitlisted", met: ["a", "b"], reason: "" })).toMatch(/why this farmer is waitlisted/);
    expect(decisionProblem(rules, { outcome: "waitlisted", met: ["a"], reason: "All 40 places are taken." })).toMatch(/meet every rule/);
    expect(decisionProblem(rules, { outcome: "waitlisted", met: ["a", "b"], reason: "All 40 places are taken." })).toBeNull();
  });
  it("records did not qualify only with a failed rule and a reason", () => {
    expect(decisionProblem(rules, { outcome: "not_qualified", met: ["a"], reason: "" })).toMatch(/why this farmer did not qualify/);
    expect(decisionProblem(rules, { outcome: "not_qualified", met: ["a", "b"], reason: "Farms 6 hectares, above the limit." })).toMatch(/meets every rule/);
    expect(decisionProblem(rules, { outcome: "not_qualified", met: ["b"], reason: "Farms 6 hectares, above the limit." })).toBeNull();
  });
  it("needs a reason for an exception", () => {
    expect(decisionProblem(rules, { outcome: "selected", met: ["a"], reason: "" })).toMatch(/selected anyway/);
    expect(decisionProblem(rules, { outcome: "selected", met: ["a"], reason: "Moved to the village this season; the council confirmed it." })).toBeNull();
  });
  it("refuses ticks against rules that no longer exist", () => {
    expect(decisionProblem(rules, { outcome: "selected", met: ["a", "gone"], reason: "" })).toMatch(/changed/);
  });
  it("counts what a report asks for, for farmers on the list only", () => {
    const s: Selection = { ...rules, decisions: { F1: { selected: true, outcome: "selected", met: ["a", "b"], reason: "", version: 1, ...who }, F2: { selected: true, met: ["a"], reason: "Council confirmed residence.", version: 1, ...who }, F3: { selected: false, outcome: "not_qualified", met: [], reason: "Above the land limit.", version: 1, ...who }, F5: { selected: false, outcome: "waitlisted", met: ["a", "b"], reason: "Places are full.", version: 1, ...who }, GONE: { selected: true, met: ["a", "b"], reason: "", version: 1, ...who } } };
    const farmers = [{ id: "F1", gender: "Female" }, { id: "F2", gender: "Male" }, { id: "F3", gender: "Female" }, { id: "F4", gender: "Female" }, { id: "F5", gender: "Male" }];
    expect(selectionCounts(s, farmers)).toEqual({ total: 5, selected: 2, waitlisted: 1, notQualified: 1, notSelected: 0, undecided: 1, women: 3, womenSelected: 1, exceptions: 1, exceptionsWaiting: 1 });
    expect(isException(s, s.decisions.F2)).toBe(true);
    expect(isException(s, s.decisions.F1)).toBe(false);
  });
  it("marks a decision made under earlier rules without changing it", () => {
    const d = { selected: true, met: ["a", "b"], reason: "", version: 1, ...who };
    const later: Selection = { ...rules, version: 2, criteria: [...rules.criteria, { id: "c", text: "Agrees to the contribution" }] };
    expect(isStale(later, d)).toBe(true);
    expect(isException(later, d)).toBe(false);
    expect(isStale(rules, d)).toBe(false);
  });
  it("reads older not-selected decisions without rewriting them", () => {
    // Before waitlists: a rule left unticked means they did not qualify; every rule met stays "not selected".
    const failed = { selected: false, met: ["a"], reason: "Lives outside the villages.", version: 1, of: 2, ...who };
    const unclear = { selected: false, met: ["a", "b"], reason: "Too many applicants.", version: 1, of: 2, ...who };
    const s: Selection = { ...rules, decisions: { F1: failed, F2: unclear, F3: { selected: true, met: ["a", "b"], reason: "", version: 1, ...who } } };
    expect(outcomeOf(s, failed)).toBe("not_qualified");
    expect(failedRules(s, failed).map((c) => c.id)).toEqual(["b"]);
    expect(outcomeOf(s, unclear)).toBe("not_selected");
    expect(outcomeOf(s, s.decisions.F3)).toBe("selected");
    expect(selectionCounts(s, [{ id: "F1", gender: "Male" }, { id: "F2", gender: "Male" }])).toMatchObject({ notQualified: 1, notSelected: 1 });
  });
  it("keeps the waitlisted and those who did not qualify out of the field queue, and changes nothing without rules", () => {
    const s: Selection = { ...rules, decisions: { F1: { selected: true, outcome: "selected", met: ["a", "b"], reason: "", version: 1, ...who }, F2: { selected: false, outcome: "waitlisted", met: ["a", "b"], reason: "Places are full.", version: 1, ...who } } };
    const o = outcomesById(s)!;
    expect([inFieldQueue(o.F1), inFieldQueue(o.F2), inFieldQueue(o.F9)]).toEqual([true, false, true]);
    expect(inFieldQueue("not_qualified")).toBe(false);
    expect(outcomesById(EMPTY_SELECTION)).toBeNull();
  });
});


describe("an exception waits for a second person (review round 2, R2-20)", async () => {
  const { outcomesById, waitingConfirmation } = await import("@/lib/selection");
  it("is not served until someone else confirms it", () => {
    const s = { outreach: "", version: 1, criteria: [{ id: "ha", text: "Farms at least 1 hectare" }], decisions: { "F-0002": { selected: true, outcome: "selected", met: [], reason: "Known to the team", version: 1, of: 1, exception: true, by: "nadia", byName: "Nadia", on: "2026-11-28" } } } as never;
    expect(outcomesById(s)!["F-0002"]).toBe("waitlisted");
    const confirmed = { ...(s as object), decisions: { "F-0002": { ...(s as { decisions: Record<string, object> }).decisions["F-0002"], confirmed: { by: "karim", byName: "Karim", on: "2026-11-28" } } } } as never;
    expect(waitingConfirmation(confirmed, (confirmed as { decisions: Record<string, never> }).decisions["F-0002"])).toBe(false);
    expect(outcomesById(confirmed)!["F-0002"]).toBe("selected");
  });
});
