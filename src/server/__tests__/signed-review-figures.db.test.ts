import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { GET, POST } from "@/app/api/projects/[code]/review/route";
import { describeAudit } from "@/lib/audit";
import { userById } from "@/lib/demo";
import { figuresKey, shownReview, type FiguresFrom, type MonthlyReview } from "@/lib/monthly-review";
import type { ResultInput } from "@/lib/results";
import { seedDatabase } from "@/server/demo-seed";
import { loadReview, rawReview, type ReviewView } from "@/server/monthly-review-store";
import { proofFor } from "@/server/proof";
import { addResult, reviewResult } from "@/server/results-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * Signing a monthly review keeps that day's figures (Tucker, 25 November 2026). A signed review
 * shows what was signed and not today's numbers, to the person who signed and to anyone who
 * reads it later. Home and Progress still read today's standing. Synthetic figures only.
 */
const code = "TEST-SIGNED";
const marcus = userById("marcus")!;
const nadia = userById("nadia")!;
const omar = userById("omar")!;
const SIGNED = "2026-10";
const OPEN = "2026-11";
const BEFORE = "2026-12";
let projectId = "";

type Shown = ReviewView & { figuresFrom: FiguresFrom; error?: string };
const ctx = { params: Promise.resolve({ code }) };
const url = (month: string) => `http://test/api/projects/${code}/review?month=${month}`;
const read = async (u: { id: string }, month: string) => (await (await GET(new Request(url(month), { headers: { "x-demo-user": u.id } }), ctx)).json()) as Shown;
const post = async (u: { id: string }, month: string, body: unknown) => {
  const res = await POST(new Request(url(month), { method: "POST", headers: { "x-demo-user": u.id, "Content-Type": "application/json" }, body: JSON.stringify(body) }), ctx);
  return { status: res.status, body: (await res.json()) as Shown };
};
const trained = (v: { indicators: { code: string; year: number; yearTarget: number }[] }) => v.indicators.find((i) => i.code === "IND-1")!;
const input = (o: Pick<ResultInput, "value" | "date">): ResultInput => ({ indicator: "IND-1", province: "Kabul", note: "Training session, register kept (fictional).", files: [{ hash: "e".repeat(64), name: "register.pdf", type: "application/pdf", size: 2000 }], ...o });
const accept = async (o: Pick<ResultInput, "value" | "date">) => {
  const x = await addResult(code, input(o), "omar");
  await reviewResult(code, x.id, "accepted", "nadia", null);
};

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  const [org] = await db.select().from(s.organizations);
  const [project] = await db.insert(s.projects).values({ organizationId: org.id, code, name: "Test signed review project", country: "AF", stage: "Execute", kind: "real", startDate: "2026-01-01", endDate: "2027-12-31" }).returning();
  projectId = project.id;
  await db.insert(s.indicators).values([{ projectId, code: "IND-1", name: "Farmers trained", unit: "farmers", target: "300", forecast: { "2026": 100 }, level: "output", source: "results", frequency: "quarterly", position: 0 }]);
  await accept({ value: 40, date: "2026-10-20" });
}, 120_000);

describe("a review that is not signed", { timeout: 60_000 }, () => {
  it("shows today's figures and says they are today's", async () => {
    const v = await read(nadia, SIGNED);
    expect(v.figuresFrom).toBe("today");
    expect(trained(v)).toMatchObject({ year: 40, yearTarget: 100 });
  });
});

describe("signing a review", { timeout: 60_000 }, () => {
  it("is refused when the figures have changed since the signer's page was opened, and nothing is signed", async () => {
    const page = await read(marcus, SIGNED);
    await accept({ value: 5, date: "2026-10-28" });
    const r = await post(marcus, SIGNED, { action: "signoff", seen: figuresKey(page) });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("the figures changed after you opened this page");
    expect((await rawReview(projectId, SIGNED)).signedOff).toBeUndefined();
  });

  it("keeps the figures of that moment with the signature, in the review's own record", async () => {
    const page = await read(marcus, SIGNED);
    expect(trained(page).year).toBe(45);
    const r = await post(marcus, SIGNED, { action: "signoff", seen: figuresKey(page) });
    expect(r.status).toBe(200);
    // The signer is answered with the kept figures at once.
    expect(r.body.figuresFrom).toBe("signed");
    expect(trained(r.body).year).toBe(45);

    const kept = (await rawReview(projectId, SIGNED)).signedOff!;
    expect(kept.by).toBe("marcus");
    expect(kept.figures).toMatchObject({ quarter: "2026-Q4", year: "2026", open: { pending: 0, queried: 0 } });
    expect(trained(kept.figures!)).toMatchObject({ year: 45, yearTarget: 100, name: "Farmers trained", unit: "farmers" });
    expect(kept.figures!.budget.totals).toEqual(page.budget.totals);
    // No new table or column: the figures sit in the project_state row the review always had.
    const rows = await db.select().from(s.projectState).where(and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, `review:${SIGNED}`)));
    expect(rows).toHaveLength(1);
    expect((rows[0].data as MonthlyReview).signedOff?.figures?.indicators).toHaveLength(1);
  });

  it("writes in the audit trail that the figures were kept", async () => {
    const [a] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.projectId, projectId), eq(s.auditLog.action, "review_signed_off")));
    expect(a.detail).toMatchObject({ month: SIGNED, figuresKept: 1 });
    expect(describeAudit("monthly_review", "review_signed_off", a.detail as Record<string, unknown>)).toBe("Signed off the 2026-10 monthly review (0 change(s) applied, the figures of that day kept)");
  });
});

describe("a signed review read after the numbers have moved", { timeout: 60_000 }, () => {
  let signedAt = "";
  beforeAll(async () => {
    signedAt = (await rawReview(projectId, SIGNED)).signedOff!.at;
    // Later: more farmers are trained and accepted, a result waits for MEL and the year's target is changed.
    await new Promise((r) => setTimeout(r, 20));
    await accept({ value: 15, date: "2026-11-24" });
    await addResult(code, input({ value: 7, date: "2026-11-25" }), "omar");
    await db.update(s.indicators).set({ forecast: { "2026": 80 } }).where(and(eq(s.indicators.projectId, projectId), eq(s.indicators.code, "IND-1")));
  });

  it("shows what was signed, to the signer and to a person who only reads it", async () => {
    for (const u of [marcus, nadia, omar]) {
      const v = await read(u, SIGNED);
      expect(v.figuresFrom).toBe("signed");
      expect(trained(v)).toMatchObject({ year: 45, yearTarget: 100 });
      expect(v.open).toEqual({ pending: 0, queried: 0 });
      expect(v.review.signedOff).toEqual({ by: "marcus", at: signedAt });
      expect(v.mayEdit).toBe(false);
      expect(v.mayDecide).toBe(false);
    }
  });

  it("an unsigned month beside it shows today's figures", async () => {
    const v = await read(nadia, OPEN);
    expect(v.figuresFrom).toBe("today");
    expect(trained(v)).toMatchObject({ year: 60, yearTarget: 80 });
    expect(v.open.pending).toBe(1);
  });

  it("Home and Progress still read today's standing for the signed month", async () => {
    const today = await loadReview(code, SIGNED, nadia);
    expect(trained(today)).toMatchObject({ year: 60, yearTarget: 80 });
    expect(today.open.pending).toBe(1);
    // The rule itself, with no request: the kept figures take the place of today's.
    const shown = shownReview(today);
    expect(shown.figuresFrom).toBe("signed");
    expect(trained(shown)).toMatchObject({ year: 45, yearTarget: 100 });
    expect(shown.review.signedOff).not.toHaveProperty("figures");
  });

  it("opens the records behind a signed figure as they were accepted by then", async () => {
    const then = (await proofFor(code, "IND-1", "2026-01-01", "2026-12-31", signedAt))!;
    expect(then.results.map((r) => r.value)).toEqual([40, 5]);
    expect(then.total).toBe(45);
    expect(then.asOf).toBe(signedAt);
    const now = (await proofFor(code, "IND-1", "2026-01-01", "2026-12-31"))!;
    expect(now.total).toBe(60);
    expect(now).not.toHaveProperty("asOf");
  });

  it("cannot be signed again or changed, so the kept figures stay", async () => {
    for (const body of [{ action: "signoff" }, { action: "summary", text: "A later thought." }]) {
      const r = await post(marcus, SIGNED, body);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("This review has been signed off and can no longer be changed.");
    }
    expect(trained((await rawReview(projectId, SIGNED)).signedOff!.figures!).year).toBe(45);
  });
});

describe("a review signed before figures were kept", { timeout: 60_000 }, () => {
  it("shows today's figures and is marked so the page can say they are not the signed ones", async () => {
    const old: MonthlyReview = { month: BEFORE, changes: [], signedOff: { by: "marcus", at: "2026-11-25T10:00:00.000Z" } };
    await db.insert(s.projectState).values({ projectId, key: `review:${BEFORE}`, data: old });
    const v = await read(nadia, BEFORE);
    expect(v.figuresFrom).toBe("unkept");
    expect(trained(v)).toMatchObject({ year: 60, yearTarget: 80 });
    expect(v.review.signedOff).toEqual({ by: "marcus", at: "2026-11-25T10:00:00.000Z" });
  });
});

describe("who may sign", { timeout: 60_000 }, () => {
  it("only a monthly reviewer or a plan approver, and never with a change still waiting", async () => {
    expect((await post(omar, OPEN, { action: "signoff" })).body.error).toBe("Only the monthly reviewers and plan approvers can sign off the review.");
    expect((await post(omar, OPEN, { action: "propose", change: { kind: "target", indicator: "IND-1", year: "2026", to: 70, reason: "Fewer villages can be reached before the snow." } })).status).toBe(200);
    expect((await post(marcus, OPEN, { action: "signoff" })).body.error).toBe("Decide or withdraw every proposed change first.");
    expect((await rawReview(projectId, OPEN)).signedOff).toBeUndefined();
  });
});
