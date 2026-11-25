import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { DEMO_OPPORTUNITY_ID, DEMO_PROPOSAL_ID, seedDemoOrigin } from "@/server/demo-origin";
import { readiness, type FundingProposal } from "@/lib/funding-proposals";
import { opportunityChain } from "@/lib/opportunities";
import { userById } from "@/lib/demo";
import { loadOpportunities } from "@/server/opportunities-store";
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

  it("the won proposal looks like a real one: a checklist of final items, each with a demo owner", async () => {
    const prop = (await orgDoc("funding-proposals")).items.find((o) => o.id === DEMO_PROPOSAL_ID) as unknown as FundingProposal;
    expect(prop.items.length).toBeGreaterThanOrEqual(5);
    expect(prop.items.every((i) => i.status === "final" && i.kind === "checkbox" && !!i.owner)).toBe(true);
    expect(prop.items.map((i) => i.title)).toEqual(expect.arrayContaining(["Technical narrative", "Budget", "Budget notes", "Logframe", "Registration certificate"]));
    const r = readiness(prop);
    expect(r.checks.done).toBe(r.checks.of);
    expect(r.blockers).toEqual([]);
  });

  it("the opportunities view links the call to its proposal and its project, for someone who runs proposals", async () => {
    const v = await loadOpportunities(orgId, userById("tucker")!);
    const o = v.items.find((x) => x.id === DEMO_OPPORTUNITY_ID)!;
    const c = opportunityChain(o, v.proposals);
    expect(c.proposal).toMatchObject({ id: DEMO_PROPOSAL_ID, href: `/work/proposals?open=${DEMO_PROPOSAL_ID}` });
    expect(c.proposal?.label).toMatch(/^Proposal: .+ \(Won\)$/);
    expect(c.project).toMatchObject({ code: "A-2027", label: "Project A-2027" });
    // Someone outside the proposal sees the project, not the proposal.
    const field = await loadOpportunities(orgId, userById("farida")!);
    expect(opportunityChain(field.items.find((x) => x.id === DEMO_OPPORTUNITY_ID)!, field.proposals).proposal).toBeNull();
  });

  it("fills an earlier sample proposal that has no items in place, then leaves it alone", async () => {
    const book = await orgDoc("funding-proposals");
    const emptied = { ...book, items: book.items.map((p) => (p.id === DEMO_PROPOSAL_ID ? { ...p, items: [] } : p)) };
    await db.update(s.organizationState).set({ data: emptied }).where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, "funding-proposals")));
    await seedDemoOrigin(projectId, orgId, "2026-11-25");
    const after = (await orgDoc("funding-proposals")).items as unknown as FundingProposal[];
    expect(after.filter((p) => p.id === DEMO_PROPOSAL_ID)).toHaveLength(1);
    const items = after.find((p) => p.id === DEMO_PROPOSAL_ID)!.items;
    expect(items.length).toBeGreaterThan(0);
    expect(after.length).toBe(book.items.length);
  });

  it("the income outcome has its baseline and waits for the season's survey", async () => {
    const [ind] = await db.select().from(s.indicators).where(and(eq(s.indicators.projectId, projectId), eq(s.indicators.code, "IND-5"))).limit(1);
    expect(Number(ind.baseline)).toBe(410);
    const m = measured({ baseline: Number(ind.baseline), unit: ind.unit, target: Number(ind.target) } as never, [], "change");
    expect(JSON.stringify(m)).toContain("No survey yet");
  });
});
