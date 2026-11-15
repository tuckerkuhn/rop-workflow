import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { seedDatabase } from "@/server/demo-seed";
import { koboToResults } from "@/server/kobo-results";
import { userById } from "@/lib/demo";
import { loadHome } from "@/server/home-store";
import { koboMismatches, loadResults, reopenResult, reviewResult } from "@/server/results-store";
import { encryptSecret } from "@/server/secrets";
import { ready } from "@/server/__tests__/test-db";

/**
 * Results counted from KoboToolbox, through MEL review. No Kobo account is called: a submission is
 * placed in the database as a sync leaves it, then changed as an edit in KoboToolbox would change it.
 */
const code = "A-2027";
let submission = "";
let projectId = "";
const answer = (attended: string) => db.update(s.evidence).set({ payload: { attended, _id: 1 } }).where(eq(s.evidence.id, submission));
const result = async () => (await loadResults(code)).find((r) => r.indicator === "IND-9")!;
const flags = async () => (await db.select().from(s.auditLog).where(eq(s.auditLog.action, "kobo_changed_after_acceptance"))).length;

beforeAll(async () => {
  process.env.KOBO_TOKEN_KEY = randomBytes(32).toString("base64");
  await ready;
  await seedDatabase();
  const [project] = await db.select().from(s.projects).where(eq(s.projects.code, code));
  projectId = project.id;
  await db.insert(s.koboConnections).values({ projectId: project.id, serverUrl: "https://kobo.invalid", tokenEncrypted: encryptSecret("not-a-real-token"), tokenHint: "oken" });
  await db.insert(s.koboForms).values({ projectId: project.id, assetUid: "aTRAIN", name: "Training", purpose: "data" });
  const [ind] = await db.insert(s.indicators).values({ projectId: project.id, code: "IND-9", name: "Farmers trained", unit: "farmers", target: "100", level: "output", source: "results", frequency: "monthly", position: 9 }).returning();
  await db.insert(s.koboMappings).values({ indicatorId: ind.id, assetUid: "aTRAIN", question: "attended", method: "sum" });
  const [sub] = await db
    .insert(s.evidence)
    .values({ projectId: project.id, organizationId: project.organizationId, source: "kobo", form: null, reviewStatus: "accepted", koboAssetUid: "aTRAIN", koboSubmissionUuid: "u-1", koboSubmissionId: 1, completedAt: new Date("2026-11-01T08:00:00Z"), payload: { attended: "25", _id: 1 } })
    .returning();
  submission = sub.id;
}, 120_000);

describe("results from KoboToolbox, through MEL review", { timeout: 60_000 }, () => {
  it("a submission becomes a result waiting for MEL, once", async () => {
    expect((await koboToResults(code)).added).toBe(1);
    expect((await koboToResults(code)).added).toBe(0);
    expect(await result()).toMatchObject({ status: "pending", value: 25 });
  });

  it("a queried result stays queried until it is fixed in KoboToolbox, then returns to MEL", async () => {
    const id = (await result()).id;
    await reviewResult(code, id, "queried", "omar", "25 looks too high for one session");
    await koboToResults(code);
    expect((await result()).status).toBe("queried");
    await answer("15");
    expect((await koboToResults(code)).updated).toBe(1);
    const r = await result();
    expect(r).toMatchObject({ status: "pending", value: 15, query: null });
    expect(r.history).toHaveLength(1);
    expect(r.history![0]).toMatchObject({ query: "25 looks too high for one session", reply: "Corrected in KoboToolbox", previous: { value: 25 } });
    await reviewResult(code, id, "accepted", "omar", null);
    expect((await result()).status).toBe("accepted");
  });

  it("a change after acceptance does not alter the result, and is logged once however often the sync runs", async () => {
    await answer("40");
    for (let k = 0; k < 3; k++) await koboToResults(code);
    expect((await result()).value).toBe(15);
    expect(await flags()).toBe(1);
  });

  it("tells MEL on Home that the accepted result no longer matches, until it does again", async () => {
    const id = (await result()).id;
    const omar = userById("omar")!;
    const row = async () => (await loadHome(code, omar)).actions.find((a) => a.key === "kobo-mismatch");
    expect([...(await koboMismatches(projectId))]).toEqual([id]);
    expect((await row())?.text).toBe("1 accepted result no longer matches KoboToolbox: reopen it to check the new figure");
    expect((await row())?.bucket).toBe("fix");
    // The edit is undone in KoboToolbox: nothing left to check.
    await answer("15");
    await koboToResults(code);
    await koboToResults(code);
    expect((await koboMismatches(projectId)).size).toBe(0);
    expect(await row()).toBeUndefined();
    expect(await db.select().from(s.auditLog).where(eq(s.auditLog.action, "kobo_matches_again"))).toHaveLength(1);
    // Changed again to the same figure as before: noted again, not swallowed as a repeat.
    await answer("40");
    await koboToResults(code);
    expect(await flags()).toBe(2);
    expect((await koboMismatches(projectId)).has(id)).toBe(true);
  });

  it("MEL reopens it, the next sync brings the new figure back to check, and accepting it settles it", async () => {
    const id = (await result()).id;
    await reopenResult(code, id, "omar", "KoboToolbox now says 40: check with the trainer");
    expect((await koboMismatches(projectId)).size).toBe(0);
    await koboToResults(code);
    expect(await result()).toMatchObject({ status: "pending", value: 40 });
    await reviewResult(code, id, "accepted", "omar", null);
    await koboToResults(code);
    expect((await koboMismatches(projectId)).size).toBe(0);
    expect((await result()).value).toBe(40);
  });
});
