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
