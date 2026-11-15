import { describe, expect, it } from "vitest";
import { targetGroups } from "@/lib/framework";

type N = { key: string; text: string | null; indicators: string[]; children: N[] };
const node = (key: string, indicators: string[] = [], children: N[] = [], text: string | null = null): N => ({ key, text, indicators, children });

describe("the Progress table lists every target once", () => {
  it("groups by outcome, then output with its activities' targets", () => {
    const g = targetGroups({ outcomes: [node("1", ["o"], [node("1.1", ["a"], [node("1.1.1", ["b", "c"])], "Farmers trained"), node("1.2", [], [node("1.2.1", ["d"])])])] });
    expect(g.map((x) => [x.kind, x.key, x.rows])).toEqual([
      ["outcome", "1", ["o"]],
      ["output", "1.1", ["a", "b", "c"]],
      ["output", "1.2", ["d"]],
    ]);
    expect(g[1].text).toBe("Farmers trained");
  });

  it("shows targets that have no place in the framework instead of dropping them", () => {
    const g = targetGroups({ outcomes: [], unplaced: ["x", "y"] });
    expect(g).toEqual([{ key: "other", kind: "other", text: null, rows: ["x", "y"] }]);
  });

  it("leaves out nothing and repeats nothing", () => {
    const all = ["o", "a", "b", "c", "d", "x"];
    const g = targetGroups({ outcomes: [node("1", ["o"], [node("1.1", ["a"], [node("1.1.1", ["b", "c"])]), node("1.2", [], [node("1.2.1", ["d"])])])], unplaced: ["x"] });
    expect(g.flatMap((x) => x.rows).sort()).toEqual([...all].sort());
  });

  it("skips empty groups and uses suggested wording when none is saved", () => {
    const g = targetGroups({ outcomes: [{ key: "2", text: null, indicators: [], children: [{ key: "2.1", text: null, suggested: { text: "Water managed" }, indicators: ["w"] }] }] });
    expect(g).toEqual([{ key: "2.1", kind: "output", text: "Water managed", rows: ["w"] }]);
  });
});
