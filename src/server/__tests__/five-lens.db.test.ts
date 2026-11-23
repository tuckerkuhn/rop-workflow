import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));
// The HR ledger reads through a driver call the in-memory test database answers differently, so
// the authority table is given here: who holds each role type.
vi.mock("@/server/hr-store", async (original) => {
  const real = await original<typeof import("@/server/hr-store")>();
  return { ...real, loadHr: async () => ({ state: { people: {}, rules: { holders: { ceo: ["tucker"], management: ["karim"] } } } }) };
});

import { and, eq, isNull } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import { seedDatabase } from "@/server/demo-seed";
import { loadFramework, type TreeNode } from "@/server/framework-store";
import { proposalMenuMap } from "@/server/funding-proposals-store";
import { loadHome } from "@/server/home-store";
import { loadReview } from "@/server/monthly-review-store";
import { countTargetWords } from "@/lib/target-status";
import { koboApprovalFor, saveKoboApproval } from "@/server/kobo-approval";
import { actOnOpportunity, loadOpportunities } from "@/server/opportunities-store";
import { loadPortfolio } from "@/server/portfolio-store";
import { nextReport } from "@/server/next-report";
import { loadProgressSummary } from "@/server/progress-summary-store";
import { requestOnlyReads, withRequestMemo } from "@/server/request-memo";
import { ready } from "@/server/__tests__/test-db";

/**
 * Checks from the five-lens review (docs/deep-dive/07-five-lens-review.md): what a donor is shown,
 * what a manager's portfolio lists in demo mode, and that the match call is in the audit log.
 */
const code = "A-2027";
const [tucker, nadia, elena, farida, omar] = ["tucker", "nadia", "elena", "farida", "omar"].map((id) => userById(id)!);
let orgId = "";

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  orgId = (await db.select().from(s.organizations).limit(1))[0].id;
}, 120_000);

const nodes = (list: TreeNode[]): TreeNode[] => list.flatMap((n) => [n, ...nodes(n.children)]);

describe("what a donor is shown", { timeout: 60_000 }, () => {
  it("has the workplan's activities without the names of the staff who own them", async () => {
    const staff = nodes((await loadFramework(code, nadia)).outcomes).flatMap((n) => n.activities);
    const donor = nodes((await loadFramework(code, elena)).outcomes).flatMap((n) => n.activities);
    expect(staff.some((a) => a.owner)).toBe(true);
    expect(donor.length).toBe(staff.length);
    expect(donor.every((a) => a.owner === null)).toBe(true);
  });
  it("judges each target exactly as staff see it", async () => {
    const leaves = async (u: typeof nadia) => {
      const v = await loadFramework(code, u);
      return [...nodes(v.outcomes).flatMap((n) => n.indicators), ...v.unplaced].map((l) => [l.code, l.status, l.year, l.yearTarget]);
    };
    expect(await leaves(elena)).toEqual(await leaves(nadia));
    expect((await leaves(elena)).length).toBeGreaterThan(0);
  });
});

describe("All projects", { timeout: 60_000 }, () => {
  it("lists the demo project in demo mode, so the page is never empty in front of an audience", async () => {
    const rows = (await loadPortfolio(tucker)).rows;
    expect(rows.map((r) => r.code)).toContain(code);
    expect(rows.find((r) => r.code === code)).toMatchObject({ ready: true, stage: "Execute" });
  });
  it("counts done and on track in the shared words, so a target with no accepted result is No data, not On track", async () => {
    const row = (await loadPortfolio(tucker)).rows.find((r) => r.code === code)!;
    if (!row.ready) throw new Error("demo project not ready");
    const review = await loadReview(code, new Date().toISOString().slice(0, 7), tucker);
    const words = countTargetWords(review.indicators, Number(review.quarter.slice(-1)));
    expect({ met: row.met, onTrack: row.onTrack, noData: row.noData }).toEqual({ met: words.done, onTrack: words.on_track, noData: words.no_data });
    // Never more on track than the raw status says: the shared words only move targets out of it.
    expect(row.onTrack).toBeLessThanOrEqual(review.indicators.filter((i) => i.status === "on_track").length);
    expect(row.onTrack + row.noData).toBeGreaterThanOrEqual(review.indicators.filter((i) => i.status === "on_track").length);
  });
  it("leaves the demo project out of a live organization's portfolio", async () => {
    process.env.DEMO_SIGN_IN = "0";
    try {
      expect((await loadPortfolio(tucker)).rows.map((r) => r.code)).not.toContain(code);
    } finally {
      process.env.DEMO_SIGN_IN = "1";
    }
  });
});

describe("opportunities in the audit log", { timeout: 60_000 }, () => {
  const log = () => db.select().from(s.auditLog).where(and(isNull(s.auditLog.projectId), eq(s.auditLog.entity, "opportunity")));
  it("records an opportunity, the match call and a reopening, each with who did it", async () => {
    const before = (await log()).length;
    const fields = { title: "Dried fruit corridor", donor: "Demo Fund (fictional)", source: "Donor call" as const, link: "", country: "AF", deadline: null, value: null, currency: "USD", need: "", donorPriorities: "", capacity: "", risks: "", grossIncome: "" };
    expect(await actOnOpportunity(orgId, { action: "add", fields }, nadia)).toBeNull();
    const made = (await loadOpportunities(orgId, tucker)).items.find((o) => o.title === "Dried fruit corridor")!;
    expect(await actOnOpportunity(orgId, { action: "decide", id: made.id, match: false, reason: "No field team in that province yet." }, tucker)).toBeNull();
    expect(await actOnOpportunity(orgId, { action: "reopen", id: made.id, reason: "A partner now covers the province." }, tucker)).toBeNull();
    const rows = (await log()).slice(before).map((r) => [r.action, (r.detail as Record<string, unknown>).by, (r.detail as Record<string, unknown>).opportunity]);
    expect(rows).toEqual([
      ["opportunity_recorded", "nadia", made.id],
      ["opportunity_not_matched", "tucker", made.id],
      ["opportunity_reopened", "tucker", made.id],
    ]);
    const decided = (await log()).find((r) => r.action === "opportunity_not_matched")!;
    expect((decided.detail as Record<string, unknown>).reason).toBe("No field team in that province yet.");
  });
  it("writes nothing when the change is refused", async () => {
    const before = (await log()).length;
    const made = (await loadOpportunities(orgId, tucker)).items.find((o) => o.title === "Dried fruit corridor")!;
    // Not programme management or the executive head: the match call is refused.
    expect(await actOnOpportunity(orgId, { action: "decide", id: made.id, match: true, reason: "We should go for this one." }, nadia)).toMatch(/match call/);
    expect((await log()).length).toBe(before);
  });
});

describe("KoboCollect accounts nobody has matched to a person", { timeout: 60_000 }, () => {
  const row = async (u: typeof nadia) => (await loadHome(code, u)).actions.find((a) => a.key === "kobo-accounts");
  it("are on the Home of the people who can match them, until they are matched", async () => {
    expect(await row(nadia)).toBeUndefined();
    const project = (await db.select().from(s.projects).where(eq(s.projects.code, code)))[0];
    await db.insert(s.evidence).values({ organizationId: project.organizationId, projectId: project.id, source: "kobo", form: "visit", farmerCode: "F-0001", reviewStatus: "pending", completedBy: "stranger.kobo", completedAt: new Date(), koboAssetUid: "aVisit", koboSubmissionUuid: "11111111-2222-4333-8444-555555555555", koboSubmissionId: 91, payload: { farmer: "F-0001" } });
    const mine = await row(nadia);
    expect(mine).toMatchObject({ bucket: "fix", href: "/setup?step=kobo-connect" });
    expect(mine!.text).toMatch(/^Match 1 KoboCollect account to the person who uses it/);
    // An extension agent cannot match accounts, so it is not her row.
    expect(await row(farida)).toBeUndefined();
    await saveKoboApproval(code, { ...(await koboApprovalFor(code)), accounts: { "stranger.kobo": "farida" } });
    expect(await row(nadia)).toBeUndefined();
  });
});

describe("a linked KoboCollect form that counts toward no target", { timeout: 60_000 }, () => {
  const row = async (u: typeof nadia) => (await loadHome(code, u)).actions.find((a) => a.key === "kobo-forms-loose");
  it("is on the Home of the people who can link it, until a question is linked to a target", async () => {
    const project = (await db.select().from(s.projects).where(eq(s.projects.code, code)))[0];
    expect(await row(omar)).toBeUndefined();
    await db.insert(s.koboForms).values({ projectId: project.id, assetUid: "aLooseVisit", name: "Farm visit (test)", purpose: "visit" });
    const mine = await row(omar);
    expect(mine).toMatchObject({ bucket: "fix", href: "/setup?step=kobo-map" });
    expect(mine!.text).toMatch(/^1 linked KoboCollect form counts toward no target \(Farm visit \(test\)\)/);
    expect(await row(nadia)).toBeDefined();
    expect(await row(farida)).toBeUndefined();
    // Linked to a target that no form feeds yet: nothing left to warn about.
    const taken = new Set((await db.select({ id: s.koboMappings.indicatorId }).from(s.koboMappings)).map((m) => m.id));
    const free = (await db.select().from(s.indicators).where(eq(s.indicators.projectId, project.id))).find((i) => !taken.has(i.id))!;
    await db.insert(s.koboMappings).values({ indicatorId: free.id, assetUid: "aLooseVisit", question: "visit/farmer_id", method: "count_unique" });
    expect(await row(omar)).toBeUndefined();
  });
});

describe("a read-only request's short memory", { timeout: 120_000 }, () => {
  // Inside a route a GET shares what it has already read (the review, the report's figures, the
  // budget view, the results). Sharing must never change an answer: each screen's data is the
  // same with the memory as without it.
  const remembered = <T,>(read: () => Promise<T>) =>
    withRequestMemo(async () => {
      requestOnlyReads();
      return read();
    });
  const same = async <T,>(read: () => Promise<T>) => expect(JSON.parse(JSON.stringify(await remembered(read)))).toEqual(JSON.parse(JSON.stringify(await read())));

  it("gives Home the same answer", async () => {
    await same(() => loadHome(code, nadia));
    await same(() => loadHome(code, omar));
  });
  it("gives the Progress summary, the framework and the report check the same answer", async () => {
    await same(() => loadProgressSummary(code, nadia));
    await same(() => loadFramework(code, nadia));
    await same(() => nextReport(code));
  });
  it("gives All projects the same answer, where Home and the summary share one review", async () => {
    await same(() => loadPortfolio(tucker));
  });
  it("gives the same answer when several screens' data is read in one request, in either order", async () => {
    const alone = { home: await loadHome(code, nadia), summary: await loadProgressSummary(code, nadia), framework: await loadFramework(code, nadia) };
    const together = await remembered(async () => {
      const framework = await loadFramework(code, nadia);
      const summary = await loadProgressSummary(code, nadia);
      const home = await loadHome(code, nadia);
      return { home, summary, framework };
    });
    expect(JSON.parse(JSON.stringify(together))).toEqual(JSON.parse(JSON.stringify(alone)));
  });
});

describe("the way in to Proposals for someone added to one", { timeout: 60_000 }, () => {
  it("lists Proposals in the menu for the core and for a proposal's team", async () => {
    const menu = await proposalMenuMap(orgId);
    expect(menu.tucker).toBe("core");
    // Nadia is on the sample proposal's team and is not in the core.
    expect(menu.nadia).toBe("team");
    expect(menu.bilal).toBeUndefined();
  });
  it("tells a signed-in person about their own place on a team, and nobody else's", async () => {
    expect((await proposalMenuMap(orgId, "nadia")).nadia).toBe("team");
    const forBilal = await proposalMenuMap(orgId, "bilal");
    expect(forBilal.nadia).toBeUndefined();
    expect(forBilal.tucker).toBe("core");
  });
});
