import { describe, expect, it } from "vitest";
import { deadlineSoon, opportunityColumns, procurementCards, procurementColumns } from "@/lib/boards";
import {
  DEFAULT_STEP_SETTINGS,
  approverFor,
  blockers,
  grantAction,
  grantColumns,
  granteeSharePct,
  isStuck,
  itemsFor,
  nextStepOf,
  stepsIn,
  type Grant,
  type GrantRules,
} from "@/lib/grants";
import { steps as procSteps, type Procurement } from "@/lib/procurement";

const RULES: GrantRules = { costSharePct: 50, costShareWomenPct: 30, hoAboveUsd: 25000, capUsd: 50000 };
const grant = (over: Partial<Grant> = {}): Grant => ({
  id: "G-001",
  rev: 1,
  business: "Kandahar Dried Fruit Co.",
  province: "Kandahar",
  type: "matching",
  purpose: "A solar dryer",
  value: 20000,
  investment: 40000,
  womenOwned: false,
  step: "eoi",
  since: "2026-11-01",
  status: "open",
  checks: {},
  approval: null,
  contributions: [],
  procurements: [],
  closedWhy: null,
  history: [],
  ...over,
});
const tick = { by: "u", byName: "U", at: "2026-11-02" };
const ticked = (g: Grant) => Object.fromEntries(itemsFor(g, g.step).map((c) => [c.id, tick]));

describe("grant steps", () => {
  it("cannot move on until the step's checklist is complete", () => {
    const g = grant();
    expect(blockers(g, RULES).map((b) => b.key)).toEqual(["gr.check.eoiForm", "gr.check.eoiReview"]);
    expect(blockers({ ...g, checks: ticked(g) }, RULES)).toEqual([]);
  });

  it("asks for in-kind papers only on in-kind grants, and never blocks on optional ones", () => {
    const inKind = grant({ type: "inKind", step: "application" });
    const ids = blockers(inKind, RULES).map((b) => b.key);
    expect(ids).toContain("gr.check.worksheet");
    expect(ids).not.toContain("gr.check.priceCheck");
    expect(ids).not.toContain("gr.check.environment");
    const fixed = grant({ type: "fixedAmount", step: "application" });
    expect(blockers(fixed, RULES).map((b) => b.key)).toContain("gr.check.priceCheck");
  });

  it("checks the grantee's share at application, with the women-owned rate", () => {
    const low = grant({ step: "application", value: 30000, investment: 40000 });
    low.checks = ticked(low);
    expect(granteeSharePct(low)).toBe(25);
    expect(blockers(low, RULES)).toEqual([{ key: "gr.block.share", vars: { have: 25, need: 50 } }]);
    const women = { ...low, value: 28000, womenOwned: true };
    expect(blockers(women, RULES)).toEqual([]);
  });

  it("goes to the Chief of Party up to the threshold, the Home Office above", () => {
    expect(approverFor({ value: 25000 }, RULES)).toBe("cop");
    expect(approverFor({ value: 25001 }, RULES)).toBe("ho");
    expect(blockers(grant({ step: "approval", value: 30000, investment: 60000 }), RULES)).toEqual([{ key: "gr.block.ho" }]);
  });

  it("closes out only once the grantee's contribution is proven", () => {
    const g = grant({ step: "implementation" });
    g.checks = ticked(g);
    expect(blockers(g, RULES)).toEqual([{ key: "gr.block.contribution", vars: { have: 0, need: 20000 } }]);
    expect(blockers({ ...g, contributions: [{ amount: 20000, proof: "invoices", by: "u", byName: "U", at: "2026-11-03" }] }, RULES)).toEqual([]);
  });

  it("follows the project's own steps, but never skips the decisions or the money", () => {
    const s = { ...DEFAULT_STEP_SETTINGS, skip: ["survey", "approval"] as const } as unknown as typeof DEFAULT_STEP_SETTINGS;
    expect(stepsIn(s)).toEqual(["eoi", "application", "evaluation", "approval", "agreement", "implementation", "closeout"]);
    expect(nextStepOf("eoi", s)).toBe("application");
    expect(nextStepOf("closeout", s)).toBeNull();
    // A grant sitting in a step the project later skipped shows in the next column.
    const cols = grantColumns([grant({ step: "survey" })], s);
    expect(cols.find((c) => c.id === "application")!.items).toHaveLength(1);
  });

  it("folds rejected and withdrawn grants into one column", () => {
    const cols = grantColumns([grant(), grant({ id: "G-002", status: "rejected" }), grant({ id: "G-003", status: "done", step: "closeout" })], DEFAULT_STEP_SETTINGS);
    expect(cols.map((c) => [c.id, c.items.length])).toEqual([["eoi", 1], ["survey", 0], ["application", 0], ["evaluation", 0], ["approval", 0], ["agreement", 0], ["implementation", 0], ["closeout", 1], ["closed", 1]]);
  });

  it("refuses an investment smaller than the project's share", () => {
    const bad = grantAction.safeParse({ action: "add", fields: { business: "X Co", type: "matching", value: 10, investment: 5 } });
    expect(bad.success).toBe(false);
  });
});

describe("boards", () => {
  it("marks a card stuck after 14 days in one step", () => {
    expect(isStuck("2026-11-01", "2026-11-15")).toBe(false);
    expect(isStuck("2026-11-01", "2026-11-16")).toBe(true);
    expect(isStuck(null, "2026-11-16")).toBe(false);
  });

  it("puts each procurement under its step's stage, oldest wait first, and finished ones apart", () => {
    const step = procSteps.find((s) => s.stage === 3)!;
    const base = { qty: 1, unitPrice: 30000, title: "Cold room", signatures: {}, checks: {}, issues: [] } as unknown as Procurement;
    const cards = procurementCards(
      [
        { ...base, id: "PR-2", step: step.id, timeline: [{ date: "2026-11-10", who: "procurement", what: "x" }] },
        { ...base, id: "PR-1", step: step.id, timeline: [{ date: "2026-10-01", who: "procurement", what: "x" }, { date: "2026-10-20", who: "holder", what: "y" }] },
        { ...base, id: "PR-3", step: "done", timeline: [] },
      ],
      { code: "A-2027", name: "A", sandbox: false },
    );
    const cols = procurementColumns(cards);
    expect(cols[3].items.map((c) => c.id)).toEqual(["PR-1", "PR-2"]);
    expect(cols[3].items[0].since).toBe("2026-10-20");
    expect(cols.at(-1)!.items.map((c) => c.id)).toEqual(["PR-3"]);
    expect(cards[0].level).toBe("Large");
  });

  it("splits the donor pipeline by brief and orders by deadline", () => {
    const o = (status: "tracking" | "match" | "no_match" | "designing", brief: boolean, deadline: string | null) => ({ status, brief: brief ? ({} as never) : null, deadline });
    const cols = opportunityColumns([o("tracking", false, "2026-12-30"), o("tracking", false, "2026-12-01"), o("tracking", true, null), o("no_match", false, null)]);
    expect(cols.map((c) => c.items.length)).toEqual([2, 1, 0, 0, 1]);
    expect(cols[0].items[0].deadline).toBe("2026-12-01");
    expect(deadlineSoon("2026-11-20", "2026-11-11")).toBe(true);
    expect(deadlineSoon("2026-12-20", "2026-11-11")).toBe(false);
    expect(deadlineSoon("2026-11-01", "2026-11-11")).toBe(false);
  });
});
