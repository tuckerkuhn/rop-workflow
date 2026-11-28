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

describe("a possible match is reviewed by someone else (review round 2, R2-10)", async () => {
  const { reviewProblem } = await import("@/lib/staff-screening");
  const { screeningHold } = await import("@/lib/farmer-screening");
  const found = [{ date: "2026-11-20", result: "possible_match", by: "sima" }];
  it("not by whoever found it, not dated before it, and with a note", () => {
    expect(reviewProblem(found, { date: "2026-11-28", result: "clear", note: "Different date of birth on the list." }, "sima")).toMatch(/someone else reviews it/);
    expect(reviewProblem(found, { date: "2019-01-01", result: "clear", note: "Different date of birth on the list." }, "mina")).toMatch(/dated before the possible match/);
    expect(reviewProblem(found, { date: "2026-11-28", result: "clear" }, "mina")).toMatch(/Say how/);
    expect(reviewProblem(found, { date: "2026-11-28", result: "clear", note: "Different date of birth on the list." }, "mina")).toBeNull();
  });
  it("a farmer's screening is read by date and counts for a year", () => {
    const setup = { items: [{ key: "seed", name: "Seed", unit: "kg", perHa: 100, unitUsd: 2 }], packages: [], screenAboveUsd: 50 } as never;
    const f = (screenings: object[]) => ({ id: "F-1", hectares: 1, screenings }) as never;
    const by = { by: "nadia", byName: "Nadia", lists: "OFAC" };
    expect(screeningHold(f([{ ...by, date: "2026-11-01", result: "clear" }, { ...by, date: "2026-10-01", result: "possible_match" }]), setup, "2026-11-28")).toBeNull();
    expect(screeningHold(f([{ ...by, date: "2025-06-01", result: "clear" }]), setup, "2026-11-28")).toMatch(/more than a year ago/);
  });
});
