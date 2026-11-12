import { describe, expect, it } from "vitest";
import type { BudgetLine, WorkplanItem } from "@/lib/budget";
import { grantProcurementIds, grantProcs, lineLeft, linksByActivity, received, resultHref, workplanOfProcurement } from "@/lib/connections";
import { blockers, grantFields, type Grant, type GrantRules } from "@/lib/grants";
import { steps, type Procurement } from "@/lib/procurement";

const wp = (code: string, title: string): WorkplanItem => ({ code, activityCode: code.split(".").slice(0, 3).join("."), activity: null, title, indicator: null, unit: null, org: "ROP", targets: {}, active: [], start: null, end: null, remark: null });
const WORKPLAN = [wp("1.2.1.1", "Solar dryers for women-led processors"), wp("1.2.1.2", "Cold rooms for fruit traders"), wp("2.1.1", "Training of extension workers")];
const line = (code: string, activityCode: string | null, description: string, total: number, spent: number | null = null): BudgetLine => ({
  code,
  activityCode,
  activity: null,
  description,
  unit: null,
  quantity: null,
  unitCost: null,
  total,
  spent,
  schedule: {},
  kind: "program",
  procure: true,
});
const proc = (over: Partial<Procurement>): Procurement => ({ id: "PR-2027-001", title: "Dryer", qty: 1, unit: "lot", unitPrice: 30000, budgetLine: "", activity: "", step: "need", signatures: {}, checks: {}, issues: [], timeline: [], ...over }) as unknown as Procurement;
const grant = (over: Partial<Grant> = {}): Grant => ({
  id: "G-001",
  rev: 1,
  business: "Kandahar Dried Fruit Co.",
  province: "Kandahar",
  type: "inKind",
  purpose: "A solar dryer",
  value: 20000,
  investment: 40000,
  womenOwned: true,
  activity: "1.2.1.1",
  budgetLine: "B-12",
  step: "implementation",
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
const at = (stage: number) => steps.find((s) => s.stage === stage)!.id;

describe("which activity a procurement serves", () => {
  it("reads the procurement calendar item first", () => {
    expect(workplanOfProcurement(proc({ plan: { key: "PP-3" } as Procurement["plan"] }), [{ key: "PP-3", workplanCode: "1.2.1.2" }], WORKPLAN)).toBe("1.2.1.2");
  });
  it("then the code its activity starts with, if it names one sub-activity", () => {
    expect(workplanOfProcurement(proc({ activity: "2.1.1 Training" }), [], WORKPLAN)).toBe("2.1.1");
    // 1.2.1 has two sub-activities: it cannot tell which.
    expect(workplanOfProcurement(proc({ activity: "1.2.1 Equipment" }), [], WORKPLAN)).toBeNull();
  });
  it("then its budget line, matched like the procurement calendar", () => {
    const lines = [line("B-7", "1.2.1", "Cold rooms for fruit traders, 20 MT", 90000)];
    expect(workplanOfProcurement(proc({ activity: "1.2.1 Equipment", budgetLine: "B-7" }), [], WORKPLAN, lines)).toBe("1.2.1.2");
  });
});

describe("grants and their purchases", () => {
  it("counts goods received once past the Receive stage", () => {
    expect(received({ step: at(5) })).toBe(false);
    expect(received({ step: at(6) })).toBe(true);
    expect(received({ step: "done" })).toBe(true);
  });

  it("joins the procurements linked on the grant and those started from it", () => {
    const procs = [proc({ id: "PR-1", grant: "G-001" }), proc({ id: "PR-2" }), proc({ id: "PR-3", grant: "G-002" })];
    expect(grantProcurementIds(grant({ procurements: ["PR-2", "PR-1"] }), procs)).toEqual(["PR-2", "PR-1"]);
    expect(grantProcs(grant(), procs).map((p) => p.id)).toEqual(["PR-1"]);
  });

  it("closes out an in-kind grant only once its equipment has arrived", () => {
    const r: GrantRules = { costSharePct: 50, costShareWomenPct: 30, hoAboveUsd: 25000, capUsd: null };
    const g = grant({ contributions: [{ amount: 20000, proof: "invoices", by: "u", byName: "U", at: "2026-11-05" }], checks: Object.fromEntries(["siteVisits", "contributionProof", "budgetTracker", "equipmentInspected", "grn", "photos"].map((k) => [k, { by: "u", byName: "U", at: "2026-11-05" }])) });
    expect(blockers(g, r, [])).toEqual([{ key: "gr.block.noProc" }]);
    expect(blockers(g, r, [{ id: "PR-1", received: false }])).toEqual([{ key: "gr.block.notReceived", vars: { id: "PR-1" } }]);
    expect(blockers(g, r, [{ id: "PR-1", received: true }])).toEqual([]);
    // Without the procurements (older callers), nothing extra is asked.
    expect(blockers(g, r)).toEqual([]);
  });

  it("leaves on a budget line what is not spent or held by other open grants", () => {
    const l = line("B-12", "1.2.1", "Grants", 100000, 30000);
    const gs = [grant({ id: "G-001", value: 20000 }), grant({ id: "G-002", value: 15000, status: "rejected" }), grant({ id: "G-003", value: 10000, budgetLine: "B-9" })];
    expect(lineLeft(l, gs)).toBe(50000);
    expect(lineLeft(l, gs, "G-001")).toBe(70000);
  });

  it("keeps the activity and budget line optional on a grant", () => {
    const f = grantFields.parse({ business: "X Co", type: "matching", value: 10, investment: 20 });
    expect(f.activity).toBeNull();
    expect(f.budgetLine).toBeNull();
  });
});

describe("the activity hub", () => {
  it("gathers procurements, grants, updates and spending under each activity", () => {
    const { by, unlinked } = linksByActivity({
      workplan: WORKPLAN,
      procurements: [proc({ id: "PR-1", plan: { key: "PP-1" } as Procurement["plan"] }), proc({ id: "PR-2", activity: "Unrelated" })],
      calendar: [{ key: "PP-1", workplanCode: "1.2.1.1" }],
      grants: [grant(), grant({ id: "G-002", activity: null }), grant({ id: "G-003", activity: null, status: "rejected" })],
      updates: [{ id: "U-1", activity: "1.2.1.1", date: "2026-10-01", note: "Five dryers installed in Arghandab" }],
      lines: [line("B-1", "1.2.1", "Solar dryers for women-led processors", 50000, 12000)],
    });
    const a = by["1.2.1.1"];
    expect(a.procurements.map((p) => p.id)).toEqual(["PR-1"]);
    expect(a.grants.map((g) => g.id)).toEqual(["G-001"]);
    expect(a.updates[0].title).toBe("Five dryers installed in Arghandab");
    expect(a.budget).toEqual({ lines: ["B-1"], total: 50000, spent: 12000 });
    // Rejected grants are not work to link.
    expect(unlinked).toEqual({ procurements: ["PR-2"], grants: ["G-002"] });
  });

  it("opens Results with a result filled in, never sent", () => {
    const href = resultHref("SSOP-2027", { indicator: "IND-4", from: "G-001", value: 1, womenLed: 1, note: "G-001 closed out" });
    const q = new URL(href, "https://x").searchParams;
    expect(href.startsWith("/progress/results?")).toBe(true);
    expect([q.get("record"), q.get("indicator"), q.get("from"), q.get("value"), q.get("womenLed"), q.get("menLed")]).toEqual(["1", "IND-4", "G-001", "1", "1", null]);
  });
});
