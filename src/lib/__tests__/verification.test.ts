import { describe, expect, it } from "vitest";
import { bulkProblem, clampRate, drawMonth, pick, pickSample, sampleSize } from "@/lib/verification";

/** MF-10 (D-26): a sample opened before bulk acceptance; a monthly verification sample. */
describe("verification", () => {
  it("opens 10% of a batch first (at least one, at most five), chosen at random but the same for the same batch", () => {
    expect([1, 9, 10, 11, 60].map(sampleSize)).toEqual([1, 1, 1, 2, 5]);
    const ids = Array.from({ length: 30 }, (_, i) => `id-${i}`);
    expect(pickSample(ids, "s")).toEqual(pickSample([...ids].reverse(), "s"));
    expect(pickSample(ids, "s")).toHaveLength(3);
    expect(bulkProblem(ids, [])).toMatch(/Open 3 records/);
    expect(bulkProblem(ids, pickSample(ids, "s"))).toBeNull();
  });

  it("draws 2 to 5% of farmers a month, never assigning a visit to the person who collected the records", () => {
    expect(clampRate(0.5)).toBe(0.05);
    expect(clampRate(undefined)).toBe(0.03);
    const farmers = Array.from({ length: 100 }, (_, i) => ({ id: `F-${i}`, collectors: [i % 2 ? "farida" : "bilal"] }));
    const v = drawMonth("A-2027", "2026-11", farmers, ["omar", "farida"], 0.03);
    expect(v).toHaveLength(3);
    for (const x of v) expect(x.assignee).not.toBe(x.collector);
    // The same month draws the same farmers again: no redrawing for a convenient set.
    expect(drawMonth("A-2027", "2026-11", farmers, ["omar", "farida"], 0.03).map((x) => x.farmer)).toEqual(v.map((x) => x.farmer));
    expect(drawMonth("A-2027", "2026-12", farmers, ["omar"], 0.03).map((x) => x.farmer)).not.toEqual(v.map((x) => x.farmer));
    expect(pick([1, 2, 3], 5, "x")).toHaveLength(3);
  });
});

describe("the server draws the sample itself (review round 2, R2-19)", async () => {
  const { bulkProblem, pickSample } = await import("@/lib/verification");
  const ids = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  it("opening the first two of the batch is not the random sample", () => {
    const drawn = pickSample(ids, "results:2026-11-28");
    const firstTwo = ids.slice(0, 2);
    expect(bulkProblem(ids, firstTwo)).toBeNull();
    if (!drawn.every((id) => firstTwo.includes(id))) expect(bulkProblem(ids, firstTwo, "results:2026-11-28")).toMatch(/drawn for this batch/);
    expect(bulkProblem(ids, drawn, "results:2026-11-28")).toBeNull();
  });
});
