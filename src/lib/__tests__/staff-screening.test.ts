import { describe, expect, it } from "vitest";
import { hireBlock, screeningProblem, type Screening } from "@/lib/staff-screening";

/** MF-03 (D-23, D-05): staff are screened before the offer and every year after. */
const s = (date: string, result: "clear" | "possible_match" = "clear"): Screening => ({ person: "new-hire", date, lists: "OFAC SDN list; UN Security Council 1267 list", result, n: 1, by: "hr", at: `${date}T00:00:00Z` });

describe("staff screening", () => {
  it("is missing, current, a year old, or waiting on a person's review of a possible match", () => {
    expect(screeningProblem([], "2026-11-28")).toMatch(/Not screened/);
    expect(screeningProblem([s("2026-11-20")], "2026-11-28")).toBeNull();
    expect(screeningProblem([s("2025-11-27")], "2026-11-28")).toMatch(/more than 12 months ago/);
    expect(screeningProblem([s("2026-11-20", "possible_match")], "2026-11-28")).toMatch(/possible match\. A person reviews it/);
    // The review records a clear result: that is the last word.
    expect(screeningProblem([s("2026-11-20", "possible_match"), s("2026-11-21")], "2026-11-28")).toBeNull();
  });

  it("the offer waits for a clear, current screening", () => {
    expect(hireBlock(undefined, "2026-11-28")).toMatch(/^Screen the finalist before the offer\./);
    expect(hireBlock([s("2026-11-28")], "2026-11-28")).toBeNull();
  });
});
