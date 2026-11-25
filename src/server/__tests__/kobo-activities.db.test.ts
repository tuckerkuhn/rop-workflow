import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { seedDatabase } from "@/server/demo-seed";
import { ACTIVITIES_KEY, disconnect, koboState, saveActivityLinks, saveMappings } from "@/server/kobo-link";
import { fieldRecordsByActivity, koboFieldFacts } from "@/server/kobo-activities";
import { coversActivity, fieldRecordsText, suggestActivities } from "@/lib/kobo-activities";
import { encryptSecret } from "@/server/secrets";
import { ready } from "@/server/__tests__/test-db";

/**
 * KoboCollect forms linked to the workplan activities they record: suggested from the targets a
 * form counts toward, confirmed by a person and shown on the activity as a count of submissions.
 * No Kobo account is called: submissions are placed in the database as a sync leaves them.
 */
const code = "A-2027";
let projectId = "";
const TODAY = "2026-11-24";
const ROWS = [
  { code: "1.2.1.3", activityCode: "1.2.1" },
  { code: "2.1.1.1", activityCode: "2.1.1" },
];

beforeAll(async () => {
  process.env.KOBO_TOKEN_KEY = randomBytes(32).toString("base64");
  await ready;
  await seedDatabase();
  const [project] = await db.select().from(s.projects).where(eq(s.projects.code, code));
  projectId = project.id;
  await db.insert(s.koboConnections).values({ projectId, serverUrl: "https://kobo.invalid", tokenEncrypted: encryptSecret("not-a-real-token"), tokenHint: "oken" });
  await db.insert(s.koboForms).values([
    { projectId, assetUid: "aVISITS", name: "Farm visit", purpose: "visit" },
    { projectId, assetUid: "aSURVEY", name: "Household survey", purpose: "data" },
  ]);
  const ind = { projectId, unit: "farmers", target: "100", level: "output" as const, source: "results" as const, frequency: "monthly" as const };
  await db.insert(s.indicators).values([
    { ...ind, code: "IND-71", donorCode: "1.2.1.4", name: "Farmers visited", position: 71 },
    { ...ind, code: "IND-72", donorCode: "2.1.1.2", name: "Households surveyed", position: 72 },
  ]);
  const sub = (asset: string, id: number, at: string, extra: object = {}) => ({
    projectId,
    organizationId: project.organizationId,
    source: "kobo" as const,
    form: null,
    reviewStatus: "accepted" as const,
    koboAssetUid: asset,
    koboSubmissionUuid: `${asset}-${id}`,
    koboSubmissionId: id,
    completedAt: new Date(at),
    // A name a sync would have made a fingerprint; here it stands in for anything personal.
    payload: { _id: id, farmer_name: "Amina Testfarmer", _submitted_by: "enumerator.karim", visited: "yes" },
    ...extra,
  });
  await db.insert(s.evidence).values([
    sub("aVISITS", 1, "2026-10-03T08:00:00Z"),
    sub("aVISITS", 2, "2026-11-12T08:00:00Z"),
    sub("aVISITS", 3, "2026-08-20T08:00:00Z"),
    // Deleted in KoboToolbox: not counted.
    sub("aVISITS", 4, "2026-11-13T08:00:00Z", { koboRemovedAt: new Date("2026-11-20T00:00:00Z") }),
  ]);
  await saveMappings(code, [{ indicatorCode: "IND-71", assetUid: "aVISITS", question: "visited", method: "count_answered", value: null }], "tariq");
}, 120_000);

describe("suggesting the activities a form records", () => {
  it("takes the activity of each target the form is mapped to", () => {
    const inds = [
      { code: "IND-71", donorCode: "1.2.1.4" },
      { code: "IND-73", donorCode: "1.2.1.5" },
      { code: "IND-72", donorCode: "2.1.1.2" },
      { code: "1.3.2.1", donorCode: null },
    ];
    const s = suggestActivities(
      [
        { indicatorCode: "IND-71", assetUid: "aVISITS" },
        { indicatorCode: "IND-73", assetUid: "aVISITS" },
        { indicatorCode: "IND-72", assetUid: "aSURVEY" },
        { indicatorCode: "1.3.2.1", assetUid: "aSURVEY" },
        { indicatorCode: "IND-99", assetUid: "aOTHER" },
      ],
      inds,
    );
    expect(s).toEqual({ aVISITS: ["1.2.1"], aSURVEY: ["1.3.2", "2.1.1"] });
  });
  it("an activity covers its sub-activities, not its neighbours", () => {
    expect(coversActivity("1.2.1", { code: "1.2.1.3", activityCode: "1.2.1" })).toBe(true);
    expect(coversActivity("1.2.1.3", { code: "1.2.1.3" })).toBe(true);
    expect(coversActivity("1.2.1", { code: "1.2.10.1" })).toBe(false);
  });
});

describe("linking forms to activities", { timeout: 60_000 }, () => {
  it("saves the confirmed link and puts it on the record", async () => {
    await saveActivityLinks(code, [{ form: "aVISITS", activities: ["1.2.1"], origin: "suggested" }], "tariq");
    expect((await koboState(code)).activities).toEqual({ aVISITS: ["1.2.1"] });
    const log = await db.select().from(s.auditLog).where(and(eq(s.auditLog.projectId, projectId), eq(s.auditLog.action, "kobo_activities_saved")));
    expect(log).toHaveLength(1);
    expect(log[0].detail).toMatchObject({ by: "tariq", links: [{ form: "aVISITS", activities: ["1.2.1"], origin: "suggested" }] });
    // Saving the same again changes nothing and writes nothing new.
    await saveActivityLinks(code, [{ form: "aVISITS", activities: ["1.2.1"], origin: "manual" }, { form: "aSURVEY", activities: [], origin: "manual" }], "tariq");
    expect(await db.select().from(s.auditLog).where(and(eq(s.auditLog.projectId, projectId), eq(s.auditLog.action, "kobo_activities_saved")))).toHaveLength(1);
  });
  it("refuses a form that is not chosen or an activity the project does not have", async () => {
    await expect(saveActivityLinks(code, [{ form: "aNOPE", activities: ["1.2.1"], origin: "manual" }], "tariq")).rejects.toThrow(/not chosen/);
    await expect(saveActivityLinks(code, [{ form: "aVISITS", activities: ["9.9.9"], origin: "manual" }], "tariq")).rejects.toThrow(/No activity 9\.9\.9/);
  });
  it("the activity shows the linked form's submissions this quarter, counts only", async () => {
    const by = await fieldRecordsByActivity(code, ROWS, TODAY);
    expect(by["1.2.1.3"]).toEqual([{ form: "aVISITS", name: "Farm visit", purpose: "visit", quarter: 2, total: 3 }]);
    expect(by["2.1.1.1"]).toBeUndefined();
    expect(fieldRecordsText(by["1.2.1.3"][0])).toBe("2 farm visits recorded in KoboCollect this quarter");
    // Nothing personal leaves: no farmer, no enumerator, no answer.
    const text = JSON.stringify(by);
    for (const word of ["Amina", "Testfarmer", "karim", "enumerator", "visited", "payload"]) expect(text).not.toContain(word);
  });
  it("gives the quarterly report the count under the activity", async () => {
    expect(await koboFieldFacts(code, { from: "2026-10-01", to: "2026-12-31" }, ["1.2.1", "2.1.1"])).toEqual({ kobo_field_records_this_quarter: [{ activity: "1.2.1", form: "Farm visit", records_this_quarter: 2 }] });
    expect(await koboFieldFacts(code, { from: "2026-01-01", to: "2026-03-31" }, ["1.2.1"])).toEqual({});
  });
  it("disconnecting KoboToolbox removes the links", async () => {
    await disconnect(code);
    const [row] = await db.select().from(s.projectState).where(and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, ACTIVITIES_KEY)));
    expect(row).toBeUndefined();
    expect(await fieldRecordsByActivity(code, ROWS, TODAY)).toEqual({});
  });
});
