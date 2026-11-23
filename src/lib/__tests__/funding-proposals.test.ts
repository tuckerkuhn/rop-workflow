import { describe, expect, it } from "vitest";
import {
  budgetProblems,
  byPerson,
  coreReason,
  DEFAULT_CORE,
  hoursLeft,
  inCore,
  instantOf,
  itemsFrom,
  itemsFromPlan,
  mine,
  NO_BUDGET,
  overallBand,
  ratingRefusal,
  readiness,
  sayMoment,
  standardItems,
  statusRefusal,
  uploadPlan,
  type Band,
  type FundingProposal,
  type Item,
} from "@/lib/funding-proposals";
import { sampleProposal } from "@/lib/funding-proposals-sample";

const item = (over: Partial<Item>): Item => ({ id: "I1", ref: "", title: "Item", kind: "checkbox", owner: "a", signer: null, due: null, status: "todo", todo: "", working: "", final: "", points: null, criteria: "", guidance: "", rating: null, upload: null, unchecked: false, ...over });
const rated = (band: Band, points: number | null, suggested = false): Partial<Item> => ({ kind: "scored", points, status: "final", rating: { band, why: "because it is", next: "", by: "r", byName: "R", at: "2026-01-01", suggested } });
const prop = (items: Item[], over: Partial<FundingProposal> = {}): FundingProposal => ({ id: "PRO-1", opportunityId: null, title: "P", donor: "D", portal: "", folder: "", currency: "USD", deadline: null, targets: [], themes: ["One"], rules: [], budget: NO_BUDGET, team: [], outside: [], items, outcome: "drafting", confirmation: "", history: [], ...over });

describe("who can start proposals: each organization's own core", () => {
  const holders = { ceo: ["tucker"], management: ["karim"], technical: ["farid"] };
  it("is the executive head and programme management until the organization chooses", () => {
    expect(inCore("tucker", DEFAULT_CORE, holders)).toBe(true);
    expect(inCore("karim", DEFAULT_CORE, holders)).toBe(true);
    expect(inCore("farid", DEFAULT_CORE, holders)).toBe(false);
    expect(inCore("nadia", DEFAULT_CORE, holders)).toBe(false);
  });
  it("can be set by role type, by name, or both", () => {
    const core = { roles: ["technical" as const], people: ["nadia"] };
    expect(inCore("farid", core, holders)).toBe(true);
    expect(inCore("nadia", core, holders)).toBe(true);
    expect(inCore("tucker", core, holders)).toBe(false);
  });
  it("follows the authority table: a role given or taken away changes who is in", () => {
    expect(inCore("sami", DEFAULT_CORE, { ...holders, management: ["karim", "sami"] })).toBe(true);
    expect(inCore("karim", DEFAULT_CORE, { ...holders, management: [] })).toBe(false);
  });
  it("says why each person is in", () => {
    expect(coreReason("karim", { roles: ["ceo", "management"], people: ["karim"] }, holders)).toBe("Programme management, Named");
    expect(coreReason("nadia", { roles: [], people: ["nadia"] }, holders)).toBe("Named");
    expect(coreReason("bilal", DEFAULT_CORE, holders)).toBe("");
  });
});

describe("can it be submitted", () => {
  it("says no while a checkbox item, a decision or a scored section is open, most serious first", () => {
    const r = readiness(prop([item({ id: "a", kind: "decision", title: "Apply alone?" }), item({ id: "b", title: "Declarations" }), item({ id: "c", kind: "scored", title: "Approach" })]));
    expect(r.blockers).toEqual(["1 decision is still open: Apply alone?.", "1 checkbox item is not final: Declarations.", "1 scored section is not final."]);
    expect(r.next).toBe("Decide: Apply alone?.");
    expect(r.checks).toMatchObject({ done: 0, of: 1 });
  });
  it("says yes when everything that applies is final", () => {
    const r = readiness(prop([item({ status: "final" }), item({ id: "b", status: "na" }), item({ id: "c", ...rated("competitive", 10) })]));
    expect(r.blockers).toEqual([]);
    expect(r.next).toBe("Everything is final. Upload in the order below and submit.");
  });
  it("is stopped by a budget outside the call's limits", () => {
    const r = readiness(prop([item({ status: "final" })], { budget: { ...NO_BUDGET, ceiling: 100, total: 130 } }));
    expect(r.blockers).toEqual(["The budget is USD 30 above the ceiling of USD 100."]);
    expect(r.next).toBe("Bring the budget inside the call's limits.");
  });
  it("asks first for AI-drafted items to be checked, then for owners", () => {
    expect(readiness(prop([item({ unchecked: true, owner: null })])).next).toBe("Check the 1 item drafted from the call by AI.");
    expect(readiness(prop([item({ owner: null })])).next).toBe("Give 1 item an owner.");
  });
  it("asks for win themes before scored sections are written", () => {
    expect(readiness(prop([item({ kind: "scored" })], { themes: [] })).next).toMatch(/^Choose the win themes/);
  });
  it("is never stopped by a low rating: the band says how it stands, not whether it can go", () => {
    const r = readiness(prop([item({ ...rated("not_competitive", 10) })]));
    expect(r.blockers).toEqual([]);
    expect(r.scored.band).toBe("not_competitive");
  });
});

describe("how it would stand", () => {
  it("has no band until a reviewer has confirmed a rating", () => {
    expect(overallBand([item({ kind: "scored" })])).toBeNull();
    expect(overallBand([item({ ...rated("differentiator", 10, true) })])).toBeNull();
  });
  it("weighs each section by its points in the grid", () => {
    // 30 points fringe and 10 points differentiator: (30*1 + 10*3) / 40 = 1.5, fringe.
    expect(overallBand([item({ ...rated("fringe", 30) }), item({ id: "b", ...rated("differentiator", 10) })])).toBe("fringe");
    // The other way round: (30*3 + 10*1) / 40 = 2.5, differentiator.
    expect(overallBand([item({ ...rated("differentiator", 30) }), item({ id: "b", ...rated("fringe", 10) })])).toBe("differentiator");
  });
  it("treats sections as equal when the grid gives no points", () => {
    expect(overallBand([item({ ...rated("competitive", null) }), item({ id: "b", ...rated("competitive", null) }), item({ id: "c", ...rated("fringe", null) })])).toBe("fringe");
    expect(overallBand([item({ ...rated("competitive", null) }), item({ id: "b", ...rated("differentiator", null) })])).toBe("differentiator");
  });
  it("lists the weakest confirmed sections, most points first, and counts AI suggestions apart", () => {
    const r = readiness(prop([item({ id: "a", title: "A", ...rated("fringe", 5) }), item({ id: "b", title: "B", ...rated("not_competitive", 30) }), item({ id: "c", title: "C", ...rated("differentiator", 20) }), item({ id: "d", ...rated("fringe", 50, true) })]));
    expect(r.scored.weakest.map((i) => i.title)).toEqual(["B", "A"]);
    expect(r.scored).toMatchObject({ rated: 3, of: 4, suggested: 1 });
  });
});

describe("the call's budget limits", () => {
  it("says by how much each limit is broken", () => {
    expect(budgetProblems({ ceiling: 2_000_000, total: 2_004_300, direct: 1_870_000, support: 371_000, indirect: 134_300, supportCap: 15, indirectCap: 7 }, "USD")).toEqual([
      "The budget is USD 4,300 above the ceiling of USD 2,000,000.",
      "Support costs are 18.5% of the total; the limit is 15.0%.",
      "Indirect costs are 7.2% of direct costs; the limit is 7.0%.",
    ]);
  });
  it("says nothing inside the limits, or where the call sets none", () => {
    expect(budgetProblems({ ceiling: 100, total: 100, direct: 80, support: 15, indirect: 5, supportCap: 15, indirectCap: 7 }, "USD")).toEqual([]);
    expect(budgetProblems(NO_BUDGET, "USD")).toEqual([]);
  });
});

describe("who may change what", () => {
  it("lets the owner move their item, and nobody outside", () => {
    const i = item({ owner: "a" });
    expect(statusRefusal(i, "drafting", "a", false)).toBeNull();
    expect(statusRefusal(i, "drafting", "z", false)).toMatch(/^Only the item's owner/);
    expect(statusRefusal(i, "drafting", "z", true)).toBeNull();
  });
  it("makes a signed item final only by its signer", () => {
    const i = item({ owner: "a", signer: "s", status: "sign" });
    expect(statusRefusal(i, "final", "a", false)).toMatch(/final when its signer has signed/);
    expect(statusRefusal(i, "final", "lead", true)).toMatch(/final when its signer has signed/);
    expect(statusRefusal(i, "final", "s", false)).toBeNull();
    expect(statusRefusal(item({ signer: null }), "sign", "a", false)).toMatch(/Nobody is named to sign/);
  });
  it("lets the people running it record the signature of a signer outside the organization, who has no sign-in", () => {
    const i = item({ owner: "a", signer: "OUT-1", status: "sign" });
    expect(statusRefusal(i, "final", "lead", true, ["OUT-1"])).toBeNull();
    expect(statusRefusal(i, "final", "a", false, ["OUT-1"])).toMatch(/final when its signer has signed/);
  });
  it("lets nobody rate a section they wrote", () => {
    const i = item({ kind: "scored", owner: "a" });
    expect(ratingRefusal(i, "a", true)).toBe("You wrote this section, so someone else rates it.");
    expect(ratingRefusal(i, "b", true)).toBeNull();
    expect(ratingRefusal(i, "b", false)).toMatch(/rated by the people running/);
    expect(ratingRefusal(item({}), "b", true)).toBe("Only scored items are rated.");
  });
});

describe("one table per person", () => {
  const p = prop([item({ id: "1", title: "Late", owner: "a", due: "2026-02-02" }), item({ id: "2", title: "Soon", owner: "a", due: "2026-02-01" }), item({ id: "3", title: "Signed", owner: "b", signer: "a", status: "sign" }), item({ id: "4", owner: "b", status: "final" }), item({ id: "5", title: "Loose", owner: null })]);
  it("lists each person's open items soonest first, with what waits for their signature, and leaves out what is final", () => {
    const g = byPerson(p);
    expect(g.map((x) => x.person)).toEqual(["a", "b", null]);
    expect(g[0].items.map((i) => i.title)).toEqual(["Soon", "Late"]);
    expect(g[0].toSign.map((i) => i.title)).toEqual(["Signed"]);
    expect(g[1].items.map((i) => i.title)).toEqual(["Signed"]);
  });
  it("gives Home what a person owns and must sign, and nothing once it is with a reviewer or submitted", () => {
    expect(mine([p], "a")[0]).toMatchObject({ items: [{ title: "Late" }, { title: "Soon" }], toSign: [{ title: "Signed" }] });
    expect(mine([p], "b")).toEqual([]);
    expect(mine([{ ...p, outcome: "submitted" }], "a")).toEqual([]);
  });
});

describe("the donor's clock", () => {
  const kabul = { at: "2026-11-17T23:59", zone: "Asia/Kabul" };
  it("finds the instant of a local time in the donor's zone", () => {
    expect(instantOf(kabul).toISOString()).toBe("2026-11-17T19:29:00.000Z");
    expect(instantOf({ at: "2026-07-01T17:00", zone: "Europe/Brussels" }).toISOString()).toBe("2026-07-01T15:00:00.000Z");
  });
  it("says it on the donor's clock and the reader's", () => {
    expect(sayMoment(kabul, "America/Los_Angeles")).toBe("Tue 17 Nov, 23:59 Kabul = 11:29 your time");
    expect(sayMoment(kabul, "Asia/Kabul")).toBe("Tue 17 Nov, 23:59 Kabul");
    // A day earlier or later for the reader is said, never left to be worked out.
    expect(sayMoment({ at: "2026-11-17T02:00", zone: "Asia/Kabul" }, "America/Guatemala")).toBe("Tue 17 Nov, 02:00 Kabul = Mon 16 Nov, 15:30 your time");
  });
  it("counts the hours left", () => {
    expect(hoursLeft(kabul, new Date("2026-11-17T12:33:00Z"))).toBe(6);
    expect(hoursLeft(kabul, new Date("2026-11-17T20:00:00Z"))).toBeLessThan(0);
  });
});

describe("starting points", () => {
  it("gives a standard list with all three kinds, nobody assigned and files numbered for upload", () => {
    const items = standardItems();
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(new Set(items.map((i) => i.kind))).toEqual(new Set(["decision", "scored", "checkbox"]));
    expect(items.every((i) => i.owner === null && i.status === "todo")).toBe(true);
    expect(items.filter((i) => i.kind === "scored").every((i) => i.criteria && i.guidance)).toBe(true);
    const order = uploadPlan(prop(items)).map((i) => i.upload);
    expect(order).toEqual(order.map((_, k) => k + 1));
    expect(items.filter((i) => i.kind === "decision").every((i) => i.upload === null)).toBe(true);
  });
  it("starts from an earlier proposal with what was asked, not who did it or how it scored", () => {
    const earlier = sampleProposal("2026-11-17");
    const items = itemsFrom(earlier);
    expect(items).toHaveLength(earlier.items.length);
    expect(items.every((i) => !i.owner && !i.signer && !i.due && !i.rating && i.status === "todo" && i.unchecked)).toBe(true);
    expect(items.find((i) => i.title === "Approach and activities")).toMatchObject({ points: 30, kind: "scored" });
  });
  it("marks every item AI drafts from a call for a person to check, and keeps grid notes on scored items only", () => {
    const items = itemsFromPlan({ items: [{ ref: "Annex I", title: "Declarations", kind: "checkbox", todo: "Sign.", points: 5, criteria: "x", guidance: "y" }, { ref: "S2", title: "Approach", kind: "scored", todo: "Write.", points: 30, criteria: "Feasible.", guidance: "Evidence." }], limits: [] }, ["I001"]);
    expect(items.every((i) => i.unchecked && i.id !== "I001")).toBe(true);
    expect(items[0]).toMatchObject({ points: null, criteria: "", guidance: "", upload: 1 });
    expect(items[1]).toMatchObject({ points: 30, criteria: "Feasible.", upload: 2 });
  });
});

describe("the demo's sample proposal", () => {
  const p = sampleProposal("2026-11-17");
  it("has something to show in every part of the screen", () => {
    const r = readiness(p);
    expect(r.decisions).toHaveLength(1);
    expect(r.budget).toHaveLength(3);
    expect(r.scored).toMatchObject({ rated: 2, of: 7, suggested: 1, band: "differentiator" });
    expect(r.blockers.length).toBeGreaterThan(2);
    expect(byPerson(p).map((g) => g.person)).toEqual(expect.arrayContaining(["nadia", "OUT-SAMPLE"]));
    expect(uploadPlan(p).length).toBeGreaterThan(10);
  });
  it("names nobody real and no real donor", () => {
    const text = JSON.stringify(p);
    expect(text).not.toMatch(/\b(tucker|daniel|ahmad shah|gary)\b|unops|psrp|world bank/i);
    expect(p.title).toMatch(/fictional/);
    expect(p.donor).toMatch(/fictional/);
  });
});
