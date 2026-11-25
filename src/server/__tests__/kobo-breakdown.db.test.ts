import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { seedDatabase } from "@/server/demo-seed";
import { koboResultRules, koboToResults } from "@/server/kobo-results";
import { koboState, saveMappings } from "@/server/kobo-link";
import { koboMismatches, loadResults, reviewResult } from "@/server/results-store";
import { dataChecks } from "@/lib/data-checks";
import type { KoboBreakdown, KoboMapping } from "@/lib/kobo-setup";
import { encryptSecret } from "@/server/secrets";
import { ready } from "@/server/__tests__/test-db";

/**
 * Women, men and young people on results from KoboToolbox: from count questions (a group per
 * submission) or from one person's sex and age (a person per submission). No Kobo account is
 * called: submissions are placed in the database as a sync leaves them.
 */
const code = "A-2027";
let projectId = "";

const COUNTS: KoboBreakdown = { shape: "counts", women: "group/n_women", men: "group/n_men", youth: "group/n_youth" };
const PERSON: KoboBreakdown = { shape: "person", sex: "farmer_sex", female: "female", male: "male", age: "farmer_age", young: null };
const base: KoboMapping[] = [
  { indicatorCode: "IND-11", assetUid: "aGROUP", question: "group/participants", method: "sum", value: null },
  { indicatorCode: "IND-12", assetUid: "aFARM", question: "attended", method: "count_answer", value: "yes" },
];
const results = async () => (await loadResults(code)).filter((r) => r.kobo && ["aGROUP", "aFARM"].includes(r.kobo.asset));
const bySub = async (asset: string, id: number) => (await results()).find((r) => r.kobo?.asset === asset && r.kobo.id === id)!;

beforeAll(async () => {
  process.env.KOBO_TOKEN_KEY = randomBytes(32).toString("base64");
  await ready;
  await seedDatabase();
  const [project] = await db.select().from(s.projects).where(eq(s.projects.code, code));
  projectId = project.id;
  await db.insert(s.koboConnections).values({ projectId, serverUrl: "https://kobo.invalid", tokenEncrypted: encryptSecret("not-a-real-token"), tokenHint: "oken" });
  await db.insert(s.koboForms).values([
    { projectId, assetUid: "aGROUP", name: "Group training", purpose: "data" },
    { projectId, assetUid: "aFARM", name: "Farmer attendance", purpose: "data" },
  ]);
  const ind = { projectId, unit: "farmers", target: "100", level: "output" as const, source: "results" as const, frequency: "monthly" as const, disaggregation: ["sex"] };
  await db.insert(s.indicators).values([
    { ...ind, code: "IND-11", name: "Farmers trained in groups", position: 11 },
    { ...ind, code: "IND-12", name: "Farmers attending", position: 12 },
  ]);
  const sub = (asset: string, id: number, payload: Record<string, unknown>) => ({ projectId, organizationId: project.organizationId, source: "kobo" as const, form: null, reviewStatus: "accepted" as const, koboAssetUid: asset, koboSubmissionUuid: `${asset}-${id}`, koboSubmissionId: id, completedAt: new Date("2026-11-01T08:00:00Z"), payload: { ...payload, _id: id } });
  await db.insert(s.evidence).values([
    sub("aGROUP", 1, { "group/participants": "20", "group/n_women": "8", "group/n_men": "12", "group/n_youth": "5" }),
    // As stored after a sync: the farmer's name is already a fingerprint (kobo-protect).
    sub("aFARM", 2, { attended: "yes", farmer_sex: "female", farmer_age: "24", farmer_name: "pseudonym:0123456789abcdef" }),
    sub("aFARM", 3, { attended: "yes", farmer_sex: "male", farmer_age: "50", farmer_name: "pseudonym:fedcba9876543210" }),
  ]);
}, 120_000);

describe("the rules for one submission", () => {
  const { breakdownOf } = koboResultRules;
  it("count questions give the numbers they hold", () => {
    expect(breakdownOf(COUNTS, { group: {}, "group/n_women": "8", "group/n_men": "12", "group/n_youth": "5" })).toEqual({ female: 8, male: 12, youth: 5 });
    // Unanswered or not a whole number: left empty, never guessed.
    expect(breakdownOf(COUNTS, { "group/n_women": "", "group/n_men": "3.5" })).toEqual({});
    // More young people than people cannot be right: the youth figure is left out.
    expect(breakdownOf(COUNTS, { "group/n_women": "1", "group/n_men": "1", "group/n_youth": "4" })).toEqual({ female: 1, male: 1 });
  });
  it("one person's sex gives 1 or 0 and their age says whether they are young", () => {
    expect(breakdownOf(PERSON, { farmer_sex: "female", farmer_age: "24" })).toEqual({ female: 1, male: 0, youth: 1 });
    expect(breakdownOf(PERSON, { farmer_sex: "male", farmer_age: "50" })).toEqual({ female: 0, male: 1, youth: 0 });
    expect(breakdownOf({ ...PERSON, age: "age_group", young: "18_35" }, { farmer_sex: "male", age_group: "18_35" })).toEqual({ female: 0, male: 1, youth: 1 });
    // Another answer, or none: not counted either way.
    expect(breakdownOf(PERSON, { farmer_sex: "prefer_not" })).toEqual({});
  });
  it("nothing mapped gives nothing", () => {
    expect(breakdownOf(null, { farmer_sex: "female" })).toEqual({});
  });
});

describe("women, men and young people on results from KoboToolbox", { timeout: 60_000 }, () => {
  it("without the questions mapped, results have no women, men or young people (as before)", async () => {
    await saveMappings(code, base, "tariq");
    expect((await koboToResults(code)).added).toBe(3);
    for (const r of await results()) expect([r.female, r.male, r.youth]).toEqual([undefined, undefined, undefined]);
  });

  it("once mapped, the next sync fills results waiting for MEL but never changes an accepted one", async () => {
    const accepted = await bySub("aFARM", 3);
    await reviewResult(code, accepted.id, "accepted", "omar", null);
    await saveMappings(code, [{ ...base[0], breakdown: COUNTS }, { ...base[1], breakdown: PERSON }], "tariq");
    const st = await koboState(code);
    expect(st.mappings.find((m) => m.indicatorCode === "IND-11")?.breakdown).toEqual(COUNTS);

    const out = await koboToResults(code);
    expect(out).toMatchObject({ added: 0, updated: 2, flagged: 1 });
    expect(await bySub("aGROUP", 1)).toMatchObject({ status: "pending", value: 20, female: 8, male: 12, youth: 5 });
    expect(await bySub("aFARM", 2)).toMatchObject({ status: "pending", value: 1, female: 1, male: 0, youth: 1 });
    // Accepted: left as MEL accepted it but noted as no longer matching KoboToolbox, once.
    const kept = await bySub("aFARM", 3);
    expect([kept.status, kept.female, kept.male, kept.youth]).toEqual(["accepted", undefined, undefined, undefined]);
    expect([...(await koboMismatches(projectId))]).toEqual([accepted.id]);
    await koboToResults(code);
    expect(await db.select().from(s.auditLog).where(eq(s.auditLog.action, "kobo_changed_after_acceptance"))).toHaveLength(1);
  });

  it("only counts reach the result: no answer, name or fingerprint", async () => {
    for (const r of await results()) expect(JSON.stringify(r)).not.toMatch(/pseudonym|farmer_sex|farmer_name/);
  });

  it("the data checker no longer stops a filled result for missing women and men", async () => {
    const all = await loadResults(code);
    const r = await bySub("aGROUP", 1);
    expect(dataChecks(r, all, { code: "IND-11", unit: "farmers", disaggregation: ["sex"] }).join(" ")).not.toMatch(/no women and men/);
  });
});
