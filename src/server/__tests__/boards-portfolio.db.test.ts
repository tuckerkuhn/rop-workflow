import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));
vi.mock("@/server/hr-store", async (original) => {
  const real = await original<typeof import("@/server/hr-store")>();
  return { ...real, loadHr: async () => ({ state: { people: {}, rules: { holders: { ceo: ["tucker"], management: ["karim"] } } } }) };
});

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById, type AppUser } from "@/lib/demo";
import { DEFAULT_STEP_SETTINGS, type Grant } from "@/lib/grants";
import { inOwnOrganization, inOwnOrganizationOf, type Viewer } from "@/server/auth";
import { grantBoard, procurementBoard, projectProcurementCards } from "@/server/boards-store";
import { seedDatabase, seedProcurementRows } from "@/server/demo-seed";
import { loadGrantBoardInputs, loadGrants } from "@/server/grants-store";
import { loadHome } from "@/server/home-store";
import { loadPortfolio } from "@/server/portfolio-store";
import { DEMO_PROJECT } from "@/server/procurement-guard";
import { loadProgressSummary } from "@/server/progress-summary-store";
import { requestOnlyReads, withRequestMemo } from "@/server/request-memo";
import { ready } from "@/server/__tests__/test-db";

/**
 * All projects and the cross-project boards read each project's data side by side rather than
 * one project after another, and the portfolio reads only the monthly review (not the whole of
 * Home) for each. Their answers must stay what Home and the one-project reads say.
 */
const tucker = userById("tucker")!;
const karim = userById("karim")!;
let orgId = "";
const viewer = (u: AppUser): Viewer => ({ user: u, actor: u, actorStaffId: null, organizationId: orgId, viewingAs: false });

const readOnly = <T,>(read: () => Promise<T>) =>
  withRequestMemo(async () => {
    requestOnlyReads();
    return read();
  });
const plain = <T,>(v: T) => JSON.parse(JSON.stringify(v)) as T;

/** The SQL sent while `run` runs. */
async function queries(run: () => Promise<unknown>): Promise<string[]> {
  const client = (db as unknown as { $client: { query: (...a: unknown[]) => unknown } }).$client;
  const spy = vi.spyOn(client, "query");
  try {
    await run();
    return spy.mock.calls.map(([q]) => String(typeof q === "object" && q && "text" in q ? (q as { text: string }).text : q));
  } finally {
    spy.mockRestore();
  }
}

const grant = (id: string, over: Partial<Grant>): Grant => ({
  id,
  rev: 1,
  business: `Business ${id}`,
  province: "Kandahar",
  type: "matching",
  purpose: "Cold storage",
  value: 10000,
  investment: 25000,
  womenOwned: false,
  step: "application",
  since: "2026-10-01",
  status: "open",
  checks: {},
  approval: null,
  contributions: [{ amount: 3000, proof: "receipt", by: "karim", byName: "K", at: "2026-10-02" }],
  procurements: [],
  closedWhy: null,
  history: [],
  ...over,
});

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  const [demo] = await db.select().from(s.projects).where(eq(s.projects.code, DEMO_PROJECT));
  orgId = demo.organizationId!;
  // Two more running projects (one real, one sandbox) with purchases, grants and a budget, and one still in Develop.
  const made = await db
    .insert(s.projects)
    .values([
      { organizationId: orgId, code: "B-2027", name: "Second Project (SP)", country: "AF", startDate: "2026-10-01", endDate: "2028-12-31", stage: "Execute", kind: "real" },
      { organizationId: orgId, code: "S-2027", name: "Try Things", country: "AF", startDate: "2026-10-01", endDate: "2028-12-31", stage: "Execute", kind: "sandbox" },
      { organizationId: orgId, code: "D-2027", name: "Still Developing (DEV)", country: "AF", startDate: "2027-01-01", endDate: "2028-12-31", stage: "Develop", kind: "real" },
    ])
    .returning();
  const lines = await db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, demo.id));
  for (const [k, p] of made.slice(0, 2).entries()) {
    await seedProcurementRows(p.id, orgId, k * 3);
    await db.insert(s.projectState).values({
      projectId: p.id,
      key: "grants",
      data: { items: [grant(`G-00${k + 1}`, { value: 30000 + k, step: "approval" }), grant(`G-01${k}`, { womenOwned: true, type: "inKind" })], steps: DEFAULT_STEP_SETTINGS },
    });
    await db.insert(s.budgetLines).values(lines.map((l) => ({ ...l, id: undefined, projectId: p.id })));
  }
}, 120_000);

describe("All projects", { timeout: 120_000 }, () => {
  it("says for each running project what Home and the Progress summary say", async () => {
    const { rows } = await loadPortfolio(tucker);
    expect(rows.map((r) => [r.code, r.ready])).toEqual([
      [DEMO_PROJECT, true],
      ["B-2027", true],
      ["D-2027", false],
    ]);
    for (const row of rows) {
      if (!row.ready) continue;
      const [home, sum] = [await loadHome(row.code, tucker), await loadProgressSummary(row.code, tucker)];
      const w = home.schedule.words;
      expect(row).toEqual({
        code: row.code,
        name: home.project.name,
        // As Home says it, except that a name with no "(ACRP)" falls back to the code here.
        short: /\(([^)]+)\)\s*$/.test(home.project.name) ? home.project.short : row.code,
        stage: home.project.stage,
        ready: true,
        indicators: home.schedule.total,
        met: w.done,
        onTrack: w.on_track,
        noData: w.no_data,
        late: home.schedule.late.length,
        level: home.schedule.level,
        lateNames: home.schedule.late.slice(0, 3).map((l) => `${l.code} ${l.name}`),
        budget: { currency: home.budget.currency, approved: home.budget.approved, spentPct: home.budget.spentPct, timePct: home.budget.timePct, ahead: home.budget.ahead, overspent: home.budget.overspent.length },
        topConcern: (sum.concerns.find((c) => /^(late-|due$|acts-|unplanned-)/.test(c.key)) ?? sum.concerns[0])?.text ?? null,
        topWin: sum.wins[0]?.text ?? null,
      });
    }
    // The demo project has targets and a budget, so the comparison above is not of empty rows.
    expect(rows[0]).toMatchObject({ ready: true, budget: { approved: expect.any(Number) } });
    if (rows[0].ready) expect(rows[0].indicators).toBeGreaterThan(0);
  });
  it("gives the same answer inside a read-only request, where the summary shares each project's review", async () => {
    expect(plain(await readOnly(() => loadPortfolio(tucker)))).toEqual(plain(await loadPortfolio(tucker)));
  });
});

describe("the boards across projects", { timeout: 120_000 }, () => {
  it("lists each project's procurements as its own board does, in the projects' order, from one read of the purchases", async () => {
    for (const min of ["Large", "Medium"] as const) {
      const each = [...(await projectProcurementCards({ code: "B-2027", name: "Second Project (SP)", sandbox: false }, min)), ...(await projectProcurementCards({ code: "S-2027", name: "Try Things", sandbox: true }, min))];
      expect(each.length).toBeGreaterThan(0);
      expect(plain((await procurementBoard(viewer(karim), min)).cards)).toEqual(plain(each));
      expect(plain((await readOnly(() => procurementBoard(viewer(karim), min))).cards)).toEqual(plain(each));
    }
    const sent = await queries(() => procurementBoard(viewer(karim), "Medium"));
    expect(sent.filter((q) => /from "procurements"/.test(q))).toHaveLength(1);
  });
  it("shows nothing to someone without procurement access", async () => {
    expect(await procurementBoard(viewer({ ...karim, procurementAccess: "none" }), "Large")).toEqual({ cards: [] });
  });
  it("lists every grant of every project, in the projects' order", async () => {
    const { cards, steps } = await grantBoard(viewer(karim));
    expect(steps).toEqual(DEFAULT_STEP_SETTINGS);
    expect(cards.map((c) => [c.project.code, c.id, c.project.sandbox])).toEqual([
      ["B-2027", "G-001", false],
      ["B-2027", "G-010", false],
      ["S-2027", "G-002", true],
      ["S-2027", "G-011", true],
    ]);
    expect(cards[0]).toMatchObject({ value: 30000, step: "approval", approver: "ho", contributed: 3000, owed: 0, left: expect.any(Number) });
    expect(cards[1]).toMatchObject({ value: 10000, womenOwned: true, type: "inKind", approver: "cop", owed: 15000 });
    expect(plain(await readOnly(() => grantBoard(viewer(karim))))).toEqual(plain({ cards, steps }));
  });
  it("reads of each project only what the grant board uses, the same as the grants page reads it", async () => {
    const counts: string[] = [];
    for (const code of ["B-2027", "S-2027", DEMO_PROJECT]) {
      const page = await loadGrants(code, karim);
      const board = await queries(() => loadGrantBoardInputs(code));
      const whole = await queries(() => loadGrants(code, karim));
      expect(plain(await loadGrantBoardInputs(code))).toEqual(plain({ items: page.items, rules: page.rules, procs: page.procs }));
      expect(board.length).toBeLessThan(whole.length);
      counts.push(`${code}: ${whole.length} -> ${board.length}`);
    }
    console.log(`Grant board queries per project, loadGrants -> loadGrantBoardInputs:\n${counts.join("\n")}`);
    await expect(loadGrantBoardInputs("NO-SUCH-PROJECT")).rejects.toThrow();
  });
});

describe("the organization check for several projects at once", { timeout: 60_000 }, () => {
  it("answers for each project as the one-project check does, in one query", async () => {
    const [other] = await db.insert(s.organizations).values({ name: "Another organization" }).returning();
    await db.insert(s.projects).values([
      { organizationId: other.id, code: "X-2027", name: "Not ours", country: "AF", stage: "Execute", kind: "real" },
      { organizationId: orgId, code: "Y-2027", name: "Ours too", country: "AF", stage: "Execute", kind: "real" },
    ]);
    const codes = ["X-2027", "Y-2027", "NOWHERE-1", "B-2027", "Y-2027"];
    let got = new Set<string>();
    const sent = await queries(async () => {
      got = await inOwnOrganizationOf(viewer(karim), codes);
    });
    expect(sent).toHaveLength(1);
    for (const code of codes) expect([code, got.has(code)]).toEqual([code, await inOwnOrganization(viewer(karim), code)]);
    expect([...got].sort()).toEqual(["B-2027", "NOWHERE-1", "Y-2027"]);
    // Known now: asked again, nothing is read (a code that names no project is looked up again, as one by one).
    expect(await queries(() => inOwnOrganizationOf(viewer(karim), ["X-2027", "Y-2027", "B-2027"]))).toHaveLength(0);
    // With no organization (demo sign-in), every project passes, as one by one.
    expect([...(await inOwnOrganizationOf({ ...viewer(karim), organizationId: null }, codes))].sort()).toEqual([...new Set(codes)].sort());
  });
});
