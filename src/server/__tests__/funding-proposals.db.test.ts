import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));
// The HR ledger reads through a driver call the in-memory test database answers differently, so
// the authority table is given here as the sample book has it: who holds each role type.
vi.mock("@/server/hr-store", async (original) => {
  const real = await original<typeof import("@/server/hr-store")>();
  return { ...real, loadHr: async () => ({ state: { people: {}, rules: { holders: { ceo: ["grace"], management: ["karim"], technical: ["farid", "nadia"] } } } }) };
});

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import { NO_BUDGET, type ItemFields, type ProposalAction } from "@/lib/funding-proposals";
import { seedDatabase } from "@/server/demo-seed";
import { actOnProposal, inProposalCore, loadProposals, proposalAccessMap } from "@/server/funding-proposals-store";
import { loadHome } from "@/server/home-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * Proposals against a real database. The demo's core is the executive head and programme
 * management by role type, plus three people by name. Everyone else is out unless added to a
 * proposal, and then sees that one only.
 */
const [grace, peter, karim, nadia, farid, bilal, sima] = ["grace", "peter", "karim", "nadia", "farid", "bilal", "sima"].map((id) => userById(id)!);
let orgId = "";
const view = async (u: typeof grace) => (await loadProposals(orgId, u))!;
const sample = async (u = grace) => (await view(u)).items.find((p) => p.id === "PRO-SAMPLE")!;
const itemOf = async (title: string) => (await sample()).items.find((i) => i.title === title)!;
const act = (a: ProposalAction, u: typeof grace) => actOnProposal(orgId, a, u);
const fields = (over: Partial<ItemFields>): ItemFields => ({ ref: "", title: "New item", kind: "checkbox", owner: null, signer: null, due: null, todo: "", working: "", final: "", points: null, criteria: "", guidance: "", upload: null, ...over });
const head = { title: "Coffee renewal, round 2", donor: "Demo Fund (fictional)", portal: "", folder: "", currency: "USD", deadline: null, targets: [], rules: [], budget: NO_BUDGET };

beforeAll(async () => {
  await ready;
  await seedDatabase();
  orgId = (await db.select().from(s.organizations).limit(1))[0].id;
}, 120_000);

describe("who can open proposals", { timeout: 60_000 }, () => {
  it("lets in the organization's core: role holders and the people it names", async () => {
    expect(await inProposalCore(orgId, grace)).toBe(true); // executive head, by role type
    expect(await inProposalCore(orgId, karim)).toBe(true); // programme management, by role type
    expect(await inProposalCore(orgId, peter)).toBe(true); // by name
    expect(await inProposalCore(orgId, sima)).toBe(false);
    expect(await inProposalCore(orgId, nadia)).toBe(false);
    expect(Object.keys(await proposalAccessMap(orgId)).sort()).toEqual(["diego", "grace", "karim", "marcus", "peter"]);
    expect((await view(grace)).core!.members.find((m) => m.id === "karim")!.why).toBe("Programme management");
  });
  it("shows a contributor the proposal they are on, and tells them nothing else", async () => {
    const v = await view(nadia);
    expect(v.items.map((p) => p.id)).toEqual(["PRO-SAMPLE"]);
    expect(v.can).toMatchObject({ run: false, setCore: false });
    expect(v.core).toBeNull();
    expect(v.others).toEqual([]);
    expect(v.matched).toEqual([]);
  });
  it("shows everyone else nothing at all", async () => {
    expect(await loadProposals(orgId, bilal)).toBeNull();
    expect(await loadProposals(orgId, sima)).toBeNull();
    expect(await act({ action: "status", id: "PRO-SAMPLE", item: "x", status: "final", note: "" }, bilal)).toBe("No such proposal.");
    expect(await act({ action: "create", fields: head, opportunityId: null, from: "standard" }, nadia)).toMatch(/^Proposals are started by the people your organization has named/);
  });
  it("lets the executive head change the core, and nobody else", async () => {
    expect(await act({ action: "core", roles: ["ceo"], people: ["nadia"] }, karim)).toMatch(/^The executive head or an administrator/);
    expect(await act({ action: "core", roles: [], people: [] }, grace)).toMatch(/^Name at least one/);
    expect(await act({ action: "core", roles: ["ceo", "technical"], people: ["peter"] }, grace)).toBeNull();
    // Technical leads are in now, by role type; programme management is out.
    expect(await inProposalCore(orgId, farid)).toBe(true);
    expect(await inProposalCore(orgId, karim)).toBe(false);
    expect(await act({ action: "core", roles: ["ceo", "management"], people: ["peter", "marcus", "diego"] }, grace)).toBeNull();
    expect(await inProposalCore(orgId, karim)).toBe(true);
    expect(await inProposalCore(orgId, farid)).toBe(false);
  });
});

describe("running a proposal", { timeout: 60_000 }, () => {
  it("lets a contributor move their own item and nothing else", async () => {
    const workplan = await itemOf("Workplan");
    expect(await act({ action: "status", id: "PRO-SAMPLE", item: workplan.id, status: "review", note: "Activities numbered as in the narrative" }, nadia)).toBeNull();
    expect((await itemOf("Workplan")).status).toBe("review");
    const budget = await itemOf("Budget");
    expect(await act({ action: "status", id: "PRO-SAMPLE", item: budget.id, status: "final", note: "" }, nadia)).toMatch(/^Only the item's owner/);
    expect(await act({ action: "addItem", id: "PRO-SAMPLE", fields: fields({}) }, nadia)).toMatch(/^Only the people running the proposal/);
    expect(await act({ action: "themes", id: "PRO-SAMPLE", themes: ["Ours"] }, nadia)).toMatch(/^Only the people running the proposal/);
  });
  it("makes a signed item final only when its signer says so", async () => {
    const risk = await itemOf("Risk analysis");
    expect(await act({ action: "status", id: "PRO-SAMPLE", item: risk.id, status: "final", note: "" }, nadia)).toMatch(/final when its signer has signed/);
    expect(await act({ action: "status", id: "PRO-SAMPLE", item: risk.id, status: "final", note: "" }, karim)).toMatch(/final when its signer has signed/);
    expect(await act({ action: "status", id: "PRO-SAMPLE", item: risk.id, status: "final", note: "" }, grace)).toBeNull();
    expect((await itemOf("Risk analysis")).status).toBe("final");
  });
  it("lets nobody rate a section they wrote, and counts a rating only once a reviewer confirms it", async () => {
    const before = (await sample()).readiness.scored;
    expect(before).toMatchObject({ rated: 2, suggested: 1 });
    const results = await itemOf("Results and how they are measured");
    const rate = { action: "rate" as const, id: "PRO-SAMPLE", item: results.id, band: "competitive" as const, why: "Targets have baselines and the calculation behind each.", next: "" };
    expect(await act(rate, karim)).toBe("You wrote this section, so someone else rates it.");
    expect(await act(rate, nadia)).toMatch(/rated by the people running/);
    expect(await act(rate, grace)).toBeNull();
    // The AI suggestion on the approach section is confirmed by a reviewer who did not write it.
    const approach = await itemOf("Approach and activities");
    expect(approach.rating?.suggested).toBe(true);
    expect(await act({ action: "rate", id: "PRO-SAMPLE", item: approach.id, band: "fringe", why: "Agreed: activities listed without the evidence they work.", next: "Add the measured yield change." }, karim)).toBeNull();
    expect((await sample()).readiness.scored).toMatchObject({ rated: 4, suggested: 0 });
  });
  it("asks for a rating again when what the grid asks for is changed", async () => {
    const context = await itemOf("Context and the problem");
    expect(context.rating?.band).toBe("competitive");
    const { id: _id, status: _s, rating: _r, unchecked: _u, ...f } = context;
    void [_id, _s, _r, _u];
    await act({ action: "editItem", id: "PRO-SAMPLE", item: context.id, fields: { ...f, criteria: "Understanding of the context, and of women's part in the value chain." } }, grace);
    expect((await itemOf("Context and the problem")).rating).toBeNull();
  });
  it("gives an item only to someone on the proposal, and lets anyone running it add any colleague", async () => {
    const cvs = await itemOf("CVs of key staff");
    const { id: _id, status: _s, rating: _r, unchecked: _u, ...f } = cvs;
    void [_id, _s, _r, _u];
    expect(await act({ action: "editItem", id: "PRO-SAMPLE", item: cvs.id, fields: { ...f, owner: "sima" } }, peter)).toBe("Sima Rezai is not on this proposal yet. Add them as a contributor first.");
    expect(await act({ action: "team", id: "PRO-SAMPLE", person: "sima", add: true }, nadia)).toMatch(/^Only the people running the proposal/);
    expect(await act({ action: "team", id: "PRO-SAMPLE", person: "sima", add: true }, peter)).toBeNull();
    expect(await act({ action: "editItem", id: "PRO-SAMPLE", item: cvs.id, fields: { ...f, owner: "sima" } }, peter)).toBeNull();
    expect((await view(sima)).items.map((p) => p.id)).toEqual(["PRO-SAMPLE"]);
    // She cannot be taken off while she still owns an open item.
    expect(await act({ action: "team", id: "PRO-SAMPLE", person: "sima", add: false }, grace)).toMatch(/still own or sign an open item/);
    expect(await act({ action: "team", id: "PRO-SAMPLE", person: "karim", add: true }, grace)).toBe("They can already open every proposal.");
  });
  it("adds someone from outside the organization, who holds items without a sign-in", async () => {
    expect((await sample()).outside.map((o) => o.name)).toEqual(["Lucía Barrios"]);
    expect(await act({ action: "outsider", id: "PRO-SAMPLE", name: "Tomás Rey", org: "Partner cooperative (fictional)", email: "" }, karim)).toBeNull();
    expect(await act({ action: "outsider", id: "PRO-SAMPLE", name: "tomás rey", org: "Partner cooperative (fictional)", email: "" }, karim)).toBe("They are already on this proposal.");
    const p = await sample();
    const tomas = p.outside.find((o) => o.name === "Tomás Rey")!;
    expect((await view(grace)).names[tomas.id]).toBe("Tomás Rey (Partner cooperative (fictional))");
    // He is given the sustainability section, and signs the workplan; the core records both for him.
    const sust = p.items.find((i) => i.title === "Sustainability and exit")!;
    const { id: _a, status: _b, rating: _c, unchecked: _d, ...f } = sust;
    void [_a, _b, _c, _d];
    expect(await act({ action: "editItem", id: "PRO-SAMPLE", item: sust.id, fields: { ...f, owner: tomas.id } }, karim)).toBeNull();
    expect(await act({ action: "status", id: "PRO-SAMPLE", item: sust.id, status: "drafting", note: "He sent a first draft" }, karim)).toBeNull();
    const plan = p.items.find((i) => i.title === "Workplan")!;
    const { id: _e, status: _f, rating: _g, unchecked: _h, ...w } = plan;
    void [_e, _f, _g, _h];
    await act({ action: "editItem", id: "PRO-SAMPLE", item: plan.id, fields: { ...w, signer: tomas.id } }, karim);
    expect(await act({ action: "status", id: "PRO-SAMPLE", item: plan.id, status: "final", note: "" }, nadia)).toMatch(/final when its signer has signed/);
    expect(await act({ action: "status", id: "PRO-SAMPLE", item: plan.id, status: "final", note: "Signed copy received by email" }, karim)).toBeNull();
    // He cannot be taken off while he holds an open item.
    expect(await act({ action: "team", id: "PRO-SAMPLE", person: tomas.id, add: false }, grace)).toMatch(/still own or sign an open item/);
    expect((await sample()).history.some((h) => /Tomás Rey .* added from outside the organization/.test(h.what))).toBe(true);
  });
  it("will not be recorded as submitted while anything stops it, and says what", async () => {
    expect(await act({ action: "outcome", id: "PRO-SAMPLE", outcome: "submitted", confirmation: "13.99", note: "" }, grace)).toMatch(/^Not ready to submit\. 1 decision is still open/);
    expect(await act({ action: "outcome", id: "PRO-SAMPLE", outcome: "withdrawn", confirmation: "", note: "" }, nadia)).toMatch(/record its outcome/);
  });
  it("records what happened, with who and when", async () => {
    const p = await sample();
    expect(p.history.some((h) => h.by === "peter" && h.what === "Changed: CVs of key staff, now with Sima Rezai")).toBe(true);
    const logged = (await db.select().from(s.auditLog).where(eq(s.auditLog.entity, "proposal"))).map((r) => r.action);
    expect(logged).toEqual(expect.arrayContaining(["proposal_section_rated", "proposal_contributor_added", "proposal_core_set"]));
  });
});

describe("starting the next proposal", { timeout: 60_000 }, () => {
  it("starts from the last one: the same items and win themes, nobody assigned, each marked to check", async () => {
    expect(await act({ action: "create", fields: head, opportunityId: null, from: "PRO-SAMPLE" }, karim)).toBeNull();
    const next = (await view(karim)).items.find((p) => p.title === head.title)!;
    const earlier = await sample();
    expect(next.items).toHaveLength(earlier.items.length);
    expect(next.items.every((i) => !i.owner && i.status === "todo" && !i.rating && i.unchecked)).toBe(true);
    expect(next.themes).toEqual(earlier.themes);
    expect(next.team).toEqual([]);
    expect(next.outside).toEqual([]);
    expect(next.readiness.next).toBe(`Check the ${next.items.length} items drafted from the call by AI.`);
    // A contributor on the earlier one does not see the new one.
    expect((await view(nadia)).items.map((p) => p.id)).toEqual(["PRO-SAMPLE"]);
  });
  it("starts from the standard list or from nothing", async () => {
    await act({ action: "create", fields: { ...head, title: "From the standard list" }, opportunityId: null, from: "standard" }, grace);
    await act({ action: "create", fields: { ...head, title: "From nothing" }, opportunityId: null, from: "blank" }, grace);
    const v = await view(grace);
    expect(v.items.find((p) => p.title === "From the standard list")!.items.length).toBeGreaterThan(15);
    expect(v.items.find((p) => p.title === "From nothing")!.readiness.next).toBe("Build the list from the call.");
    expect(await act({ action: "create", fields: head, opportunityId: null, from: "PRO-NOPE" }, grace)).toBe("No such proposal to start from.");
  });
});

describe("Home", { timeout: 60_000 }, () => {
  const rows = async (u: typeof grace) => (await loadHome("A-2027", u)).actions.filter((a) => a.key.startsWith("proposal")).map((a) => a.text);
  it("tells the signer what waits for their signature, and each owner what is theirs", async () => {
    const hers = await rows(grace);
    expect(hers[0]).toMatch(/^Sign Declarations for the proposal Orchard Value Chains Recovery \(fictional call\), \d+ days to the donor's deadline$/);
    expect(hers[1]).toMatch(/^Proposal Orchard Value Chains Recovery \(fictional call\): \d items are yours/);
    expect((await rows(nadia)).length).toBe(0); // her two items are with a reviewer or final
    expect((await rows(karim))[0]).toMatch(/^Proposal Orchard Value Chains Recovery \(fictional call\): \d items are yours/);
  });
  it("shows nothing about proposals to someone who cannot open them", async () => {
    expect(await rows(bilal)).toEqual([]);
  });
});
