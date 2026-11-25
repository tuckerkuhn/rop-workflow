import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { GET as defaultsRoute } from "@/app/api/setup/origin/route";
import { POST as createRoute } from "@/app/api/projects/route";
import { userById } from "@/lib/demo";
import { NO_BUDGET, type FundingProposal } from "@/lib/funding-proposals";
import type { Opportunity } from "@/lib/opportunities";
import { offersSetUp, type SetupDefaults } from "@/lib/project-origin";
import { seedDatabase } from "@/server/demo-seed";
import { loadOrigin, setupDefaults, winThemesContext } from "@/server/project-origin";
import { ready } from "@/server/__tests__/test-db";

/**
 * A won proposal becomes the project (server/project-origin): setup opens with the proposal's
 * details, saving links the project and the proposal both ways: only the people who set up
 * projects may do it. Nadia (project manager) may set up projects; Sima may not.
 */
const [nadia, sima] = ["nadia", "sima"].map((id) => userById(id)!);
let orgId = "";

const THEMES = ["Staff already in the province", "Farm income measured farmer by farmer"];
const opp: Opportunity = {
  id: "OPP-ORIGIN",
  title: "Coffee value chains, round 3",
  donor: "Demo Fund (fictional)",
  source: "Donor call",
  link: "",
  country: "Guatemala",
  deadline: "2026-09-30",
  value: 900_000,
  currency: "USD",
  need: "",
  donorPriorities: "",
  capacity: "",
  risks: "",
  documents: [{ hash: "a".repeat(64), name: "call.pdf", type: "application/pdf", size: 1200, label: "The call (CFP, RFP, RFA, NOFO or similar)", by: "karim", at: "2026-08-01" }],
  brief: null,
  status: "match",
  decision: { match: true, reason: "Fits the coffee work", by: "karim", byName: "Karim", at: "2026-08-05" },
  projectCode: null,
  history: [],
};
const proposal = (id: string, over: Partial<FundingProposal>): FundingProposal => ({
  id,
  opportunityId: null,
  title: `Proposal ${id}`,
  donor: "Demo Fund (fictional)",
  portal: "",
  folder: "",
  currency: "EUR",
  deadline: null,
  targets: [],
  themes: [],
  rules: [],
  budget: NO_BUDGET,
  team: [],
  outside: [],
  items: [],
  outcome: "submitted",
  confirmation: "",
  history: [],
  ...over,
});

async function readOrg<T>(key: string) {
  const [row] = await db
    .select()
    .from(s.organizationState)
    .where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, key)))
    .limit(1);
  return ((row?.data as { items?: T[] })?.items ?? []) as T[];
}
async function writeOrg(key: string, items: unknown[]) {
  await db
    .insert(s.organizationState)
    .values({ organizationId: orgId, key, data: { items } })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data: { items } } });
}

const asked = (who: string, query: string) => defaultsRoute(new Request(`http://test/api/setup/origin?${query}`, { headers: { "x-demo-user": who } }));
const design = (name: string) => ({ name, country: "GT", crop: "Coffee", startDate: "2026-12-01", endDate: "2029-11-30", goal: "", indicators: [], donors: ["Demo Fund (fictional)"] });
const create = (who: string, body: unknown) => createRoute(new Request("http://test/api/projects", { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": who }, body: JSON.stringify(body) }));

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  orgId = (await db.select().from(s.organizations).limit(1))[0].id;
  await writeOrg("opportunities", [...(await readOrg<Opportunity>("opportunities")), opp]);
  await writeOrg("funding-proposals", [
    ...(await readOrg<FundingProposal>("funding-proposals")),
    proposal("PRO-WON", { opportunityId: opp.id, title: "Coffee value chains in Huehuetenango", themes: THEMES, budget: { ...NO_BUDGET, ceiling: 850_000 }, outcome: "won", decidedAt: "2026-11-20" }),
    proposal("PRO-OUT", { outcome: "submitted" }),
  ]);
}, 120_000);

describe("a won proposal becomes the project", { timeout: 60_000 }, () => {
  it("opens setup with the proposal's details filled in, from the proposal or its opportunity", async () => {
    const d = (await setupDefaults(orgId, { proposalId: "PRO-WON" }, nadia)) as SetupDefaults;
    expect(d).toMatchObject({ proposalId: "PRO-WON", opportunityId: opp.id, name: "Coffee value chains in Huehuetenango", donor: "Demo Fund (fictional)", currency: "EUR", ceiling: 850_000, startDate: "2026-11-20", country: "GT", winThemes: THEMES, documents: 1 });
    // The opportunity's own link leads to the same entry: its won proposal.
    const res = await asked("nadia", `opportunity=${opp.id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as SetupDefaults).proposalId).toBe("PRO-WON");
  });

  it("offers nothing for a proposal that is not won", async () => {
    expect(offersSetUp({ outcome: "submitted" }, true)).toBe(false);
    expect(offersSetUp({ outcome: "won" }, true)).toBe(true);
    expect(offersSetUp({ outcome: "won", projectCode: "X-1" }, true)).toBe(false);
    expect(await setupDefaults(orgId, { proposalId: "PRO-OUT" }, nadia)).toMatch(/is not recorded as won yet/);
    const res = await create("nadia", { ...design("Not won yet"), origin: { proposalId: "PRO-OUT", opportunityId: null, currency: "USD", ceiling: null } });
    expect(res.status).toBe(409);
  });

  it("refuses someone who may not set up projects", async () => {
    expect(offersSetUp({ outcome: "won" }, false)).toBe(false);
    expect(await setupDefaults(orgId, { proposalId: "PRO-WON" }, sima)).toMatch(/^Only the people who set up projects/);
    expect((await asked("sima", "proposal=PRO-WON")).status).toBe(403);
    expect((await create("sima", { ...design("Not mine"), origin: { proposalId: "PRO-WON", opportunityId: null, currency: "EUR", ceiling: 850_000 } })).status).toBe(403);
    expect((await readOrg<FundingProposal>("funding-proposals")).find((p) => p.id === "PRO-WON")!.projectCode).toBeUndefined();
  });

  it("saving writes the origin and links the project and the proposal both ways", async () => {
    const res = await create("nadia", { ...design("Coffee value chains in Huehuetenango"), origin: { proposalId: "PRO-WON", opportunityId: opp.id, currency: "EUR", ceiling: 800_000 } });
    expect(res.status).toBe(201);
    const { code, warning } = (await res.json()) as { code: string; warning?: string };
    expect(warning).toBeUndefined();

    // The project's side.
    expect(await loadOrigin(code)).toMatchObject({ proposalId: "PRO-WON", opportunityId: opp.id, title: "Coffee value chains in Huehuetenango", donor: "Demo Fund (fictional)", winThemes: THEMES, decidedAt: "2026-11-20", currency: "EUR", ceiling: 800_000, by: "nadia" });
    expect((await loadOrigin(code))!.documents).toEqual([{ hash: "a".repeat(64), name: "call.pdf", type: "application/pdf", size: 1200, label: "The call (CFP, RFP, RFA, NOFO or similar)" }]);
    expect(await winThemesContext(code)).toEqual({ win_themes_context: THEMES });

    // The proposal's side; its opportunity moves into design.
    const p = (await readOrg<FundingProposal>("funding-proposals")).find((x) => x.id === "PRO-WON")!;
    expect(p.projectCode).toBe(code);
    expect(p.history.at(-1)).toMatchObject({ by: "nadia", what: `Set up as ${code}` });
    expect((await readOrg<Opportunity>("opportunities")).find((x) => x.id === opp.id)).toMatchObject({ status: "designing", projectCode: code });

    // Written to the audit log.
    const [project] = await db.select().from(s.projects).where(eq(s.projects.code, code));
    const log = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "project_linked_to_proposal"));
    expect(log.some((r) => r.projectId === project.id && (r.detail as { proposal?: string }).proposal === "PRO-WON")).toBe(true);

    // Once set up, it is not set up again.
    expect(await setupDefaults(orgId, { proposalId: "PRO-WON" }, nadia)).toMatch(/already set up as/);
  });
});
