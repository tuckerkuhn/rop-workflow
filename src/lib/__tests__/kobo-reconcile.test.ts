import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cronAllowed } from "@/server/guard";
import { reconcileLine } from "@/server/kobo-reconcile";

const run = (over = {}) => ({ ok: true, fetched: 40, added: 0, updated: 0, removed: 0, results: { added: 0, updated: 0, removed: 0, flagged: 0 }, ...over });

describe("nightly KoboToolbox reconcile", () => {
  it("refuses to run with no secret set, and with a wrong one", () => {
    expect(cronAllowed("Bearer anything", undefined)).toMatchObject({ status: 503 });
    expect(cronAllowed(null, "synthetic-secret")).toMatchObject({ status: 401 });
    expect(cronAllowed("Bearer wrong-secret-xx", "synthetic-secret")).toMatchObject({ status: 401 });
    expect(cronAllowed("Bearer synthetic-secret", "synthetic-secret")).toBeNull();
  });
  it("says in one line what a run found", () => {
    expect(reconcileLine(run())).toBe("40 submissions checked: nothing had changed.");
    expect(reconcileLine(run({ added: 2, updated: 1, removed: 1 }))).toBe("40 submissions checked: 2 new, 1 edited, 1 deleted in KoboToolbox.");
  });
  it("says when an accepted result was changed in KoboToolbox and flagged", () => {
    expect(reconcileLine(run({ updated: 1, results: { added: 0, updated: 0, removed: 0, flagged: 1 } }))).toContain("1 accepted result was changed in KoboToolbox and flagged for MEL.");
  });
  it("says why a run failed", () => {
    expect(reconcileLine(run({ ok: false, error: "KoboToolbox did not answer." }))).toBe("Did not run: KoboToolbox did not answer.");
  });
  it("is on the schedule, before the daily email", () => {
    const crons = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] }).crons;
    expect(crons.find((c) => c.path === "/api/kobo/reconcile")?.schedule).toBe("45 0 * * *");
    expect(crons.find((c) => c.path === "/api/notify/digest")?.schedule).toBe("30 1 * * *");
  });
});

describe("the date of a result from KoboToolbox", async () => {
  const { koboResultRules } = await import("@/server/kobo-results");
  const { dateOf } = koboResultRules;
  it("is the form's own date question, not the day Kobo received it", () => {
    expect(dateOf({ install_date: "2026-11-10", _submission_time: "2026-11-12T08:00:00" }, "2026-11-12")).toBe("2026-11-10");
    expect(dateOf({ "group_a/training_date": "2026-09-29" }, "2026-10-02")).toBe("2026-09-29");
  });
  it("falls back to the day received when the form has no date, a wrong one or one in the future", () => {
    expect(dateOf({ area_ha: "1.5" }, "2026-11-12")).toBe("2026-11-12");
    expect(dateOf({ install_date: "2026-02-30" }, "2026-11-12")).toBe("2026-11-12");
    expect(dateOf({ install_date: "2026-12-01" }, "2026-11-12")).toBe("2026-11-12");
  });
  it("ignores Kobo's own start, end and today stamps", () => {
    expect(dateOf({ today: "2026-11-01", start: "2026-11-01T09:00:00", end: "2026-11-01T09:10:00" }, "2026-11-12")).toBe("2026-11-12");
  });
});
