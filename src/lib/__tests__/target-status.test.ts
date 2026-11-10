import { describe, expect, it } from "vitest";
import { quarterOfToday, targetStatus } from "@/lib/target-status";

const row = (status: string, year: number, planned: number[] | null = null, yearTarget = 100) => ({ status, year, planned, yearTarget });

describe("Progress: one status word per target", () => {
  it("says On track for work under way and for a target met", () => {
    expect(targetStatus(row("on_track", 40), 3)).toMatchObject({ word: "on_track", detail: null });
    expect(targetStatus(row("completed", 100), 3)).toMatchObject({ word: "on_track", detail: "met" });
  });
  it("says Behind when late or not done", () => {
    expect(targetStatus(row("delayed", 10), 3)).toMatchObject({ word: "behind", detail: "delayed" });
    expect(targetStatus(row("not_implemented", 0), 4)).toMatchObject({ word: "behind", detail: "notDone" });
  });
  it("says No data when nothing is accepted yet, with why", () => {
    expect(targetStatus(row("not_started", 0, [4]), 2)).toMatchObject({ word: "no_data", detail: "notDue" });
    expect(targetStatus(row("not_started", 0, [2, 3]), 3)).toMatchObject({ word: "no_data", detail: "dueNow" });
    expect(targetStatus(row("not_started", 0, []), 3)).toMatchObject({ word: "no_data", detail: "notPlanned" });
    expect(targetStatus(row("not_started", 0), 3)).toMatchObject({ word: "no_data", detail: null });
  });
  it("never calls a target with nothing accepted On track, even when results are waiting", () => {
    expect(targetStatus(row("on_track", 0), 3).word).toBe("no_data");
  });
  it("reads the quarter from a date", () => {
    expect(quarterOfToday("2026-11-10")).toBe(4);
    expect(quarterOfToday("2026-03-31")).toBe(1);
  });
});
