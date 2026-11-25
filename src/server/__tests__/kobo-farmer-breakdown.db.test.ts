import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { seedDatabase } from "@/server/demo-seed";
import { koboToResults } from "@/server/kobo-results";
import { saveMappings } from "@/server/kobo-link";
import { koboMismatches, loadResults, reviewResult } from "@/server/results-store";
import { encryptSecret } from "@/server/secrets";
import { ready } from "@/server/__tests__/test-db";

/**
 * Women, men and young people from the farmer record, when a KoboCollect submission names the
 * farmer (picked from farmers.csv) and no question on the form gives them. No Kobo account is
 * called: submissions are placed in the database as a sync leaves them.
 */
const code = "A-2027";
let projectId = "";
let organizationId = "";

const result = async (indicator: string, id: number) => (await loadResults(code)).find((r) => r.indicator === indicator && r.kobo?.asset === "aVISIT" && r.kobo.id === id)!;
const people = (r: { female?: number; male?: number; youth?: number }) => [r.female, r.male, r.youth];
// The farmer record holds the name in tests only, to show it never reaches a result.
const farmer = (id: string, gender: "Female" | "Male", ageBand: string) => ({ projectId, organizationId, itemKey: id, kind: "farmer", data: { kind: "farmer", id, name: "Secret Person", gender, ageBand, community: "Hidden Village", hectares: 1 } });

beforeAll(async () => {
  process.env.KOBO_TOKEN_KEY = randomBytes(32).toString("base64");
  await ready;
  await seedDatabase();
  const [project] = await db.select().from(s.projects).where(eq(s.projects.code, code));
  projectId = project.id;
  organizationId = project.organizationId!;
  await db.insert(s.koboConnections).values({ projectId, serverUrl: "https://kobo.invalid", tokenEncrypted: encryptSecret("not-a-real-token"), tokenHint: "oken" });
  await db.insert(s.koboForms).values({ projectId, assetUid: "aVISIT", name: "Farm visit", purpose: "data" });
  const ind = { projectId, target: "100", level: "output" as const, source: "results" as const, frequency: "monthly" as const, disaggregation: ["sex"] };
  await db.insert(s.indicators).values([
    { ...ind, code: "IND-13", name: "Farmers who planted", unit: "farmers", position: 13 },
    { ...ind, code: "IND-14", name: "Area planted", unit: "ha", position: 14 },
    { ...ind, code: "IND-15", name: "Farmers visited", unit: "farmers", position: 15 },
  ]);
  await db.insert(s.fieldItems).values([farmer("T-1", "Female", "18–29 (youth)"), farmer("T-2", "Male", "30–49"), farmer("T-3", "Female", "50+")]);
  const sub = (id: number, payload: Record<string, unknown>) => ({ projectId, organizationId, source: "kobo" as const, form: null, reviewStatus: "accepted" as const, koboAssetUid: "aVISIT", koboSubmissionUuid: `v-${id}`, koboSubmissionId: id, completedAt: new Date("2026-11-01T08:00:00Z"), payload: { ...payload, _id: id } });
  await db.insert(s.evidence).values([
    sub(1, { farmer: "T-1", planted: "yes", area_planted: "0.5" }),
    sub(2, { farmer: "T-2", planted: "yes", area_planted: "1" }),
    // The form says male; the farmer record says female: the form wins.
    sub(3, { farmer: "T-3", planted: "yes", area_planted: "2", farmer_sex: "male" }),
    // No farmer record yet for these two.
    sub(4, { farmer: "T-4", planted: "yes", area_planted: "1" }),
    sub(5, { farmer: "T-5", planted: "yes", area_planted: "1" }),
  ]);
  await saveMappings(
    code,
    [
      { indicatorCode: "IND-13", assetUid: "aVISIT", question: "planted", method: "count_answer", value: "yes" },
      { indicatorCode: "IND-14", assetUid: "aVISIT", question: "area_planted", method: "sum", value: null },
      { indicatorCode: "IND-15", assetUid: "aVISIT", question: "planted", method: "count_answer", value: "yes", breakdown: { shape: "person", sex: "farmer_sex", female: "female", male: "male", age: null, young: null } },
    ],
    "tariq",
  );
}, 120_000);

describe("women, men and young people from the farmer record", { timeout: 60_000 }, () => {
  it("fills women or men from the farmer's sex and young people from the age band when it is sure", async () => {
    expect((await koboToResults(code)).added).toBe(15);
    expect(people(await result("IND-13", 1))).toEqual([1, 0, 1]);
    // 30 to 49 may or may not be 35 or under: left empty.
    expect(people(await result("IND-13", 2))).toEqual([0, 1, undefined]);
    expect(people(await result("IND-13", 3))).toEqual([1, 0, 0]);
  });

  it("a target counted in hectares is not one farmer per submission: left empty", async () => {
    for (const id of [1, 2, 3]) expect(people(await result("IND-14", id))).toEqual([undefined, undefined, undefined]);
  });

  it("a mapped form question wins over the farmer record, even unanswered", async () => {
    expect(people(await result("IND-15", 3))).toEqual([0, 1, 0]);
    // The sex question is mapped but not answered: no sex from the record; the age still comes from it.
    expect(people(await result("IND-15", 1))).toEqual([undefined, undefined, 1]);
  });

  it("only counts reach the result: never the farmer's name, village or ID", async () => {
    for (const r of (await loadResults(code)).filter((x) => x.kobo?.asset === "aVISIT")) expect(JSON.stringify(r)).not.toMatch(/Secret Person|Hidden Village|T-[1-5]|ageBand|gender/);
  });

  it("a farmer record added later fills a queried result (back to MEL) but never an accepted one", async () => {
    const accepted = await result("IND-13", 4);
    const queried = await result("IND-13", 5);
    expect(people(accepted)).toEqual([undefined, undefined, undefined]);
    await reviewResult(code, accepted.id, "accepted", "omar", null);
    await reviewResult(code, queried.id, "queried", "omar", "No women and men on this one");
    await db.insert(s.fieldItems).values([farmer("T-4", "Male", "50+"), farmer("T-5", "Female", "18–29 (youth)")]);
    await koboToResults(code);
    const kept = await result("IND-13", 4);
    expect([kept.status, ...people(kept)]).toEqual(["accepted", undefined, undefined, undefined]);
    expect((await koboMismatches(projectId)).has(accepted.id)).toBe(true);
    const back = await result("IND-13", 5);
    expect([back.status, ...people(back)]).toEqual(["pending", 1, 0, 1]);
    expect(back.history?.at(-1)).toMatchObject({ query: "No women and men on this one", previous: { value: 1 } });
  });
});
