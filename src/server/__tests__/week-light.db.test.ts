import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

/**
 * The week ahead reads, for each project other than the one open on Home, only the part of Home it
 * uses (server/home-store homeForWeek). `full.on` makes it read the whole of Home instead, as it
 * did before, so the two answers can be compared.
 */
const full = vi.hoisted(() => ({ on: false }));
vi.mock("@/server/home-store", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/server/home-store")>();
  return { ...m, homeForWeekJoining: (code: string, u: import("@/lib/demo").AppUser) => (full.on ? m.loadHome(code, u) : m.homeForWeekJoining(code, u)) };
});

import { eq, ne, and } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import { DEFAULT_STEP_SETTINGS, type Grant } from "@/lib/grants";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase, seedProcurementRows } from "@/server/demo-seed";
import { homeForWeek, loadHome, type HomeForWeek } from "@/server/home-store";
import { requestOnlyReads, withRequestMemo } from "@/server/request-memo";
import { loadWeek } from "@/server/week-store";

const people = ["tucker", "nadia", "alejandro", "omid", "omar"].map((id) => userById(id)!);
const codes = ["A-2027", "B-2027"];

const readOnly = <T,>(read: () => Promise<T>) =>
  withRequestMemo(async () => {
    requestOnlyReads();
    return read();
  });
async function counted<T>(run: () => Promise<T>): Promise<{ value: T; n: number }> {
  const client = (db as unknown as { $client: { query: (...a: unknown[]) => unknown } }).$client;
  const spy = vi.spyOn(client, "query");
  try {
    const value = await run();
    return { value, n: spy.mock.calls.length };
  } finally {
    spy.mockRestore();
  }
}

/** Everything of Home that server/week-store reads. */
function weekPart(h: HomeForWeek) {
  const row = (key: string) => {
    const a = h.actions.find((x) => x.key === key);
    return a ? { text: a.text, msg: a.msg, since: a.since } : null;
  };
  return {
    schedule: h.schedule,
    budget: h.budget,
    mel: { pending: h.mel.pending, queried: h.mel.queried, toCheck: h.mel.toCheck },
    approvals: h.actions.filter((a) => a.bucket === "approve").map((a) => ({ key: a.key, text: a.text, msg: a.msg, href: a.href, since: a.since, urgent: a.urgent })),
    melRows: { accept: row("accept"), forms: row("field-forms"), mismatch: row("kobo-mismatch") },
  };
}

const grant = (id: string, over: Partial<Grant> = {}): Grant => ({
  id,
  rev: 1,
  business: `Business ${id}`,
  province: "Kandahar",
  type: "matching",
  purpose: "Cold storage",
  value: 10000,
  investment: 25000,
  womenOwned: false,
  step: "approval",
  since: "2026-10-01",
  status: "open",
  checks: {},
  approval: null,
  contributions: [],
  procurements: [],
  closedWhy: null,
  history: [],
  ...over,
});

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  // A second running project, with the demo's targets, results, budget and purchases, and a grant to approve.
  const [a] = await db.select().from(s.projects).where(eq(s.projects.code, "A-2027"));
  const [b] = await db
    .insert(s.projects)
    .values({ organizationId: a.organizationId, code: "B-2027", name: "Second Project (SP)", country: "AF", startDate: "2026-10-01", endDate: "2028-12-31", stage: "Execute", kind: "real" })
    .returning();
  await seedProcurementRows(b.id, a.organizationId, 3);
  const lines = await db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, a.id));
  await db.insert(s.budgetLines).values(lines.map((l) => ({ ...l, id: undefined, projectId: b.id })));
  const inds = await db.select().from(s.indicators).where(eq(s.indicators.projectId, a.id));
  await db.insert(s.indicators).values(inds.map((i) => ({ ...i, id: undefined, projectId: b.id })));
  // Results and field forms (not KoboToolbox submissions, which are unique per project).
  const ev = await db.select().from(s.evidence).where(and(eq(s.evidence.projectId, a.id), ne(s.evidence.source, "kobo")));
  if (ev.length) await db.insert(s.evidence).values(ev.map((e) => ({ ...e, id: undefined, projectId: b.id })));
  const state = (await db.select().from(s.projectState).where(eq(s.projectState.projectId, a.id))).filter((r) => r.key !== "grants");
  if (state.length) await db.insert(s.projectState).values(state.map((r) => ({ projectId: b.id, key: r.key, data: r.data })));
  await db.insert(s.projectState).values({ projectId: b.id, key: "grants", data: { items: [grant("G-001"), grant("G-002", { value: 30000 })], steps: DEFAULT_STEP_SETTINGS } });
  // Records that have just arrived are dealt with on the first read (server/distribution): done
  // here, so every read below starts from the same records.
  for (const u of people) for (const code of codes) await loadHome(code, u);
}, 180_000);

describe("the week ahead's lighter read of Home", { timeout: 300_000 }, () => {
  it("gives every figure and row the week reads exactly as the whole of Home does", async () => {
    for (const u of people)
      for (const code of codes) {
        const whole = await loadHome(code, u);
        const light = await homeForWeek(code, u);
        expect({ who: u.id, code, ...weekPart(light) }).toEqual({ who: u.id, code, ...weekPart(whole) });
      }
    // Something to compare: approvals on both projects for the lead, and results waiting for MEL.
    const tucker = people[0];
    for (const code of codes) expect((await homeForWeek(code, tucker)).actions.some((a) => a.bucket === "approve")).toBe(true);
    expect((await homeForWeek("B-2027", tucker)).actions.some((a) => a.key === "grants-approve")).toBe(true);
    expect(weekPart(await homeForWeek("A-2027", people[4])).melRows.accept).not.toBeNull();
  });

  it("gives the same week, on two projects, with fewer queries", async () => {
    const report: string[] = [];
    for (const u of people) {
      full.on = true;
      const before = await counted(() => readOnly(() => loadWeek(u)));
      full.on = false;
      const after = await counted(() => readOnly(() => loadWeek(u)));
      expect(after.value.projects.map((p) => p.code)).toEqual(codes);
      expect(after.value).toEqual(before.value);
      expect(after.n).toBeLessThan(before.n);
      report.push(`${u.id}: ${before.n} -> ${after.n}`);
    }
    console.log(`Week ahead queries (read-only request, two projects), whole Home -> lighter read:\n${report.join("\n")}`);
  });
});
