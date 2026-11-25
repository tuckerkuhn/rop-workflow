import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import { emptyPhotos } from "@/lib/photos";
import type { ResultInput } from "@/lib/results";
import { seedDatabase } from "@/server/demo-seed";
import { postFacts } from "@/server/photos-store";
import { addResult, reviewResult } from "@/server/results-store";
import { trackRecord } from "@/server/track-record";
import { ready } from "@/server/__tests__/test-db";

/**
 * Figures that reach donors and the public: posts draft from accepted results only, the track
 * record never adds women across indicators, and both name the donor entered in setup.
 */
const code = "TEST-COMMS";
const marcus = userById("marcus")!;
const hash = (c: string) => c.repeat(64);
const photo = (c: string) => [{ hash: hash(c), name: `${c}.jpg`, type: "image/jpeg", size: 1000 }];
const result = (o: Partial<ResultInput> & Pick<ResultInput, "indicator" | "value">): ResultInput => ({ date: "2026-10-01", province: "Kabul", note: "Training held for farmers in the province.", files: [], ...o });

beforeAll(async () => {
  await ready;
  await seedDatabase();
  const [org] = await db.select().from(s.organizations);
  // The old projects.donor column is left empty, as on every project made since it stopped being written.
  const [project] = await db.insert(s.projects).values({ organizationId: org.id, code, name: "Test comms project", country: "AF", stage: "Execute", kind: "real" }).returning();
  await db.insert(s.donors).values({ projectId: project.id, name: "Test Donor Fund" });
  await db.insert(s.indicators).values([
    { projectId: project.id, code: "IND-1", name: "Farmers trained", unit: "farmers", target: "500", level: "output", source: "results", frequency: "quarterly", position: 0 },
    { projectId: project.id, code: "IND-2", name: "Farmers with new markets", unit: "farmers", target: "300", level: "output", source: "results", frequency: "quarterly", position: 1 },
  ]);
  const a = await addResult(code, result({ indicator: "IND-1", value: 120, female: 40, male: 80, files: photo("a") }), "omar");
  const b = await addResult(code, result({ indicator: "IND-2", value: 90, female: 30, male: 60 }), "omar");
  await reviewResult(code, a.id, "accepted", "nadia", null);
  await reviewResult(code, b.id, "accepted", "nadia", null);
  // Not accepted: its figures must never reach a post.
  await addResult(code, result({ indicator: "IND-1", value: 7777, female: 3333, male: 4444, files: photo("b") }), "omar");
}, 120_000);

describe("post facts", { timeout: 60_000 }, () => {
  it("use no figure from a result MEL has not accepted", async () => {
    const facts = await postFacts(code, emptyPhotos, "donor", [hash("a"), hash("b")]);
    const text = JSON.stringify(facts);
    for (const n of ["7777", "3333", "4444", "7897"]) expect(text).not.toContain(n);
    expect(facts.records[1]).toEqual({ result: "(not accepted by MEL: use no figures from this record)", date: "2026-10-01", province: "Kabul" });
    expect(facts.records[0]).toMatchObject({ women: 40, men: 80 });
  });

  it("carry the project's accepted totals against targets, one per indicator", async () => {
    const facts = await postFacts(code, emptyPhotos, "donor", [hash("a")]);
    expect(facts.project_totals_to_date).toEqual([
      { indicator: "Farmers trained", unit: "farmers", achieved: 120, target: 500, women: 40, men: 80 },
      { indicator: "Farmers with new markets", unit: "farmers", achieved: 90, target: 300, women: 30, men: 60 },
    ]);
  });

  it("name the donor from the donors table", async () => {
    expect((await postFacts(code, emptyPhotos, "donor", [])).donor).toBe("Test Donor Fund");
  });
});

describe("track record", { timeout: 60_000 }, () => {
  it("does not add women across indicators, and names the donor from the donors table", async () => {
    const pr = (await trackRecord(marcus)).projects.find((p) => p.code === code)!;
    expect(pr.donor).toBe("Test Donor Fund");
    expect(pr.achieved.map((a) => a.women)).toEqual([40, 30]);
    // The largest single indicator, never 40 + 30.
    expect(pr.womenAtLeast).toBe(40);
    expect(pr).not.toHaveProperty("women");
  });
});
