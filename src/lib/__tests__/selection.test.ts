import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION, decisionProblem, isException, isStale, selectionCounts, type Selection } from "@/lib/selection";

const who = { by: "nadia", byName: "Nadia", on: "2026-11-22" };
const rules: Selection = { ...EMPTY_SELECTION, outreach: "Announced at the village meeting.", criteria: [{ id: "a", text: "Farms 0.2 to 2 ha" }, { id: "b", text: "Lives in a project village" }], version: 1, criteriaBy: who };

describe("farmer selection", () => {
  it("needs the rules written before anyone is decided", () => {
    expect(decisionProblem(EMPTY_SELECTION, { selected: true, met: [], reason: "" })).toMatch(/rules first/);
  });
  it("takes a farmer who meets every rule with no reason", () => {
    expect(decisionProblem(rules, { selected: true, met: ["a", "b"], reason: "" })).toBeNull();
  });
  it("needs a reason to leave someone out, whatever they meet", () => {
    expect(decisionProblem(rules, { selected: false, met: ["a", "b"], reason: "" })).toMatch(/why this farmer is not selected/);
    expect(decisionProblem(rules, { selected: false, met: [], reason: "Farms 6 hectares, above the limit." })).toBeNull();
  });
  it("needs a reason for an exception", () => {
    expect(decisionProblem(rules, { selected: true, met: ["a"], reason: "" })).toMatch(/selected anyway/);
    expect(decisionProblem(rules, { selected: true, met: ["a"], reason: "Moved to the village this season; the council confirmed it." })).toBeNull();
  });
  it("refuses ticks against rules that no longer exist", () => {
    expect(decisionProblem(rules, { selected: true, met: ["a", "gone"], reason: "" })).toMatch(/changed/);
  });
  it("counts what a report asks for, for farmers on the list only", () => {
    const s: Selection = { ...rules, decisions: { F1: { selected: true, met: ["a", "b"], reason: "", version: 1, ...who }, F2: { selected: true, met: ["a"], reason: "Council confirmed residence.", version: 1, ...who }, F3: { selected: false, met: [], reason: "Above the land limit.", version: 1, ...who }, GONE: { selected: true, met: ["a", "b"], reason: "", version: 1, ...who } } };
    const farmers = [{ id: "F1", gender: "Female" }, { id: "F2", gender: "Male" }, { id: "F3", gender: "Female" }, { id: "F4", gender: "Female" }];
    expect(selectionCounts(s, farmers)).toEqual({ total: 4, selected: 2, notSelected: 1, undecided: 1, women: 3, womenSelected: 1, exceptions: 1 });
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
});
