import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { FRAMEWORK_KEY } from "@/lib/framework";
import { MEASURES_KEY } from "@/lib/measure";
import { indicatorsFromDocuments, INDICATOR_DOCS_KEY, setupDesignSchema, type DesignIndicator } from "@/lib/setup-design";
import { createProject, projectDesign, updateProject } from "@/server/project-store";
import { ready } from "@/server/__tests__/test-db";

/** Setup from a stubbed reading of fictional documents (no AI) saves everything they said about each indicator. */
const base: DesignIndicator = { donorCode: "", name: "", unit: "farmers", target: null, level: "output", yearTargets: [], baseline: null, baselineYear: null, breakdowns: [], verification: "", frequency: "not_stated", result: "", statedAs: "count", surveyed: false, source: "" };
const read = setupDesignSchema.shape.indicators.parse([
  { ...base, donorCode: "1.1.1.1", name: "Farmers trained in orchard care", target: 600, baseline: 0, baselineYear: 2027, breakdowns: ["sex", "age", "district"], verification: "Attendance sheets", frequency: "monthly", result: "Farmers apply improved orchard practices", source: "Logframe, row 4" },
  { ...base, donorCode: "1.1", name: "Share of households using drip irrigation", unit: "% of households", level: "outcome", baseline: 12.5, baselineYear: 2027, verification: "Endline survey", frequency: "annual", result: "Water is used better on farms", statedAs: "rate_share_or_average", surveyed: true, source: "Logframe, row 2" },
]);

const project = async (code: string) => (await db.select().from(s.projects).where(eq(s.projects.code, code)))[0];
const state = async (projectId: string, key: string) => (await db.select().from(s.projectState).where(and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, key))))[0]?.data as Record<string, unknown> | undefined;

beforeAll(async () => {
  await ready;
  await db.insert(s.organizations).values({ name: "Fictional Org" });
}, 120_000);

describe("project setup keeps what the documents say about each indicator", { timeout: 60_000 }, () => {
  let code = "";
  it("saves baseline, breakdowns, means of verification, frequency, result and measure; keeps the one with no target", async () => {
    const { indicators } = indicatorsFromDocuments(read);
    code = await createProject({ name: "Fictional Orchard Project", country: "GT", crop: "", goal: "", startDate: "2028-01-01", endDate: "2029-12-31", indicators, donors: [] });
    const p = (await project(code))!;
    const rows = await db.select().from(s.indicators).where(eq(s.indicators.projectId, p.id)).orderBy(asc(s.indicators.position));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ code: "IND-1", baseline: "0.00", disaggregation: ["sex", "age", "district"], verification: "Attendance sheets", frequency: "monthly", result: "Farmers apply improved orchard practices" });
    expect(rows[1]).toMatchObject({ code: "IND-2", target: "0.00", baseline: "12.50", frequency: "end_of_season", verification: "Endline survey", result: "Water is used better on farms" });
    expect(await state(p.id, INDICATOR_DOCS_KEY)).toEqual({ "IND-1": { baselineYear: 2027, frequencyAsWritten: null, source: "Logframe, row 4" }, "IND-2": { baselineYear: 2027, frequencyAsWritten: "yearly", source: "Logframe, row 2" } });
    // A share from a survey: its latest figure. The count keeps its default (nothing saved).
    expect(await state(p.id, MEASURES_KEY)).toEqual({ "IND-2": "latest" });
    const fw = (await state(p.id, FRAMEWORK_KEY)) as { nodes: Record<string, { text: string }> };
    expect(fw.nodes["1"].text).toBe("Water is used better on farms");
    expect(fw.nodes["1.1"].text).toBe("Farmers apply improved orchard practices");
  });

  it("shows them again in setup; an older form that sends none leaves them as they are", async () => {
    const design = (await projectDesign(code))!;
    expect(design.indicators[1]).toMatchObject({ baseline: 12.5, baselineYear: 2027, frequencyAsWritten: "yearly", docSource: "Logframe, row 2", measure: "latest" });
    expect(design.indicators[0].measure).toBeUndefined();
    const bare = design.indicators.map(({ code: c, name, unit, target, level, frequency }) => ({ code: c, name, unit, target, level, frequency }));
    await updateProject(code, { name: design.name, country: design.country, crop: "", goal: "", startDate: "2028-01-01", endDate: "2029-12-31", indicators: bare });
    const again = (await projectDesign(code))!;
    expect(again.indicators[0]).toMatchObject({ baseline: 0, disaggregation: ["sex", "age", "district"], verification: "Attendance sheets", result: "Farmers apply improved orchard practices", baselineYear: 2027 });
    expect(again.indicators[1].measure).toBe("latest");
    // And the round trip through the form keeps them too.
    await updateProject(code, { name: design.name, country: design.country, crop: "", goal: "", startDate: "2028-01-01", endDate: "2029-12-31", indicators: again.indicators });
    expect((await projectDesign(code))!.indicators).toEqual(again.indicators);
  });

  it("a removed target's measure goes with it, and a new target given its freed code starts as a sum", async () => {
    const design = (await projectDesign(code))!;
    const p = (await db.select().from(s.projects).where(eq(s.projects.code, code)))[0];
    const meta = { name: design.name, country: design.country, crop: "", goal: "", startDate: "2028-01-01", endDate: "2029-12-31" };
    // IND-2 (measured "latest") removed: IND-1 is now the highest code, so the next new target is IND-2 again.
    await updateProject(code, { ...meta, indicators: [design.indicators[0]] });
    expect(await state(p.id, MEASURES_KEY)).toEqual({});
    const rest = { ...design.indicators[1], code: undefined, measure: undefined, name: "Households with a kitchen garden" };
    await updateProject(code, { ...meta, indicators: [design.indicators[0], rest] });
    const after = (await projectDesign(code))!;
    expect(after.indicators[1].code).toBe("IND-2");
    expect(after.indicators[1].measure).toBeUndefined();
  });
});
