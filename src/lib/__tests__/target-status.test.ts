import { describe, expect, it } from "vitest";
import { countTargetWords, quarterOfToday, TARGET_WORD_EN, targetStatus, targetStatusText, wordOfStatus } from "@/lib/target-status";
import { STATUSES, STATUS_LABEL } from "@/lib/qpr";
import { prEn } from "@/lib/i18n/surge";

const row = (status: string, year: number, planned: number[] | null = null, yearTarget = 100) => ({ status, year, planned, yearTarget });

describe("one status vocabulary for targets", () => {
  it("says Done for a target met and On track for work under way", () => {
    expect(targetStatus(row("completed", 100), 3)).toMatchObject({ word: "done", detail: null });
    expect(targetStatus(row("on_track", 40), 3)).toMatchObject({ word: "on_track", detail: null });
  });
  it("says Behind when late or not done, keeping which", () => {
    expect(targetStatus(row("delayed", 10), 3)).toMatchObject({ word: "behind", detail: "delayed" });
    expect(targetStatus(row("not_implemented", 0), 4)).toMatchObject({ word: "behind", detail: "notDone" });
  });
  it("says Not started, with whether it is due later, due now or missing from the workplan", () => {
    expect(targetStatus(row("not_started", 0, [4]), 2)).toMatchObject({ word: "not_started", detail: "notDue" });
    expect(targetStatus(row("not_started", 0, [2, 3]), 3)).toMatchObject({ word: "not_started", detail: "dueNow", tone: "ochre" });
    expect(targetStatus(row("not_started", 0, []), 3)).toMatchObject({ word: "not_started", detail: "notPlanned" });
    expect(targetStatus(row("not_started", 0), 3)).toMatchObject({ word: "not_started", detail: null });
  });
  it("says No data, never On track, when nothing is accepted yet", () => {
    expect(targetStatus(row("on_track", 0), 3).word).toBe("no_data");
    expect(targetStatus(row("something-else", 5), 3).word).toBe("no_data");
  });
  it("gives every report status a word, and the Word report keeps UNDP's terms", () => {
    for (const s of STATUSES) expect(TARGET_WORD_EN[wordOfStatus(s).word]).toBeTruthy();
    expect(Object.values(STATUS_LABEL)).toEqual(["Completed", "On track", "Delayed", "Not implemented", "Not yet started"]);
  });
  it("has a translatable word for each", () => {
    for (const w of Object.keys(TARGET_WORD_EN)) expect(prEn[`prog.w.${w}` as keyof typeof prEn]).toBe(TARGET_WORD_EN[w as keyof typeof TARGET_WORD_EN]);
  });
  it("reads as one line in English", () => expect(targetStatusText(targetStatus(row("not_implemented", 0), 4))).toBe("Behind · not done"));
  it("counts targets by word, with on track and nothing accepted as No data (All projects)", () => {
    const c = countTargetWords([row("completed", 100), row("on_track", 40), row("on_track", 0), row("delayed", 10), row("not_started", 0, [4])], 3);
    expect(c).toEqual({ done: 1, on_track: 1, behind: 1, not_started: 1, no_data: 1 });
  });
  it("reads the quarter from a date", () => {
    expect(quarterOfToday("2026-11-10")).toBe(4);
    expect(quarterOfToday("2026-03-31")).toBe(1);
  });
});
