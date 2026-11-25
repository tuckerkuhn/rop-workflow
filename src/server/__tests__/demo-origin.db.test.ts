import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { DEMO_OPPORTUNITY_ID, DEMO_PROPOSAL_ID, seedDemoOrigin } from "@/server/demo-origin";
import { measured } from "@/lib/measure";

/** The demo shows the whole chain: a fictional call, the proposal won, the project set up from it, an outcome with its baseline. */
let projectId = "";
let orgId = "";
beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  const [p] = await db.select().from(s.projects).where(eq(s.projects.code, "A-2027")).limit(1);
  projectId = p.id;
  orgId = p.organizationId;
}, 120_000);

const orgDoc = async (key: string) => (await db.select().from(s.organizationState).where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, key))).limit(1))[0]?.data as { items: { id: string; projectCode?: string; outcome?: string }[] };

describe("the demo's origin", { timeout: 60_000 }, () => {
  it("has a fictional call, a won proposal set up as A-2027, and the project's origin linking back", async () => {
    expect((await orgDoc("opportunities")).items.find((o) => o.id === DEMO_OPPORTUNITY_ID)?.projectCode).toBe("A-2027");
    const prop = (await orgDoc("funding-proposals")).items.find((o) => o.id === DEMO_PROPOSAL_ID);
    expect(prop).toMatchObject({ outcome: "won", projectCode: "A-2027" });
    const [origin] = await db.select().from(s.projectState).where(and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, "origin"))).limit(1);
    expect(origin?.data).toMatchObject({ proposalId: DEMO_PROPOSAL_ID, opportunityId: DEMO_OPPORTUNITY_ID, ceiling: 346200 });
  });

  it("adds the sample only once, and never touches other opportunities or proposals", async () => {
    const before = (await orgDoc("opportunities")).items.length;
    await seedDemoOrigin(projectId, orgId, "2026-11-25");
    expect((await orgDoc("opportunities")).items.length).toBe(before);
    expect((await orgDoc("funding-proposals")).items.filter((p) => p.id === DEMO_PROPOSAL_ID)).toHaveLength(1);
  });

  it("the income outcome has its baseline and waits for the season's survey", async () => {
    const [ind] = await db.select().from(s.indicators).where(and(eq(s.indicators.projectId, projectId), eq(s.indicators.code, "IND-5"))).limit(1);
    expect(Number(ind.baseline)).toBe(410);
    const m = measured({ baseline: Number(ind.baseline), unit: ind.unit, target: Number(ind.target) } as never, [], "change");
    expect(JSON.stringify(m)).toContain("No survey yet");
  });
});
