import { afterEach, describe, expect, it } from "vitest";
import { users } from "@/lib/demo";
import { demoBudget, demoWorkplan } from "@/lib/demo-design";
import { lineFigure, lineFigureText } from "@/lib/line-money";
import { checkState, committedByLine, seedProcurements, setLineMoney, setProcurementSet, stepById, type Procurement } from "@/lib/procurement";
import { documentFor } from "@/lib/procurement-docs";
import { addDays, lineRoom, unplannedItem, type AskInput, type PlanItem } from "@/lib/procurement-plan";

/**
 * Review round 1, ISS-07: the ask form said $12,000 was left on line 2.3 while PR-2027-009
 * ($7,800, contract signed) was unpaid on it, the requisition said $3,000, and the approver saw
 * nothing. One figure, worked out one way, on every screen.
 */
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const TODAY = "2026-11-15";
const base = seedProcurements()[0];
const proc = (over: Partial<Procurement>): Procurement => ({ ...base, plan: undefined, payments: [], checks: {}, ...over }) as Procurement;
const check = (step: string, id: string) => stepById[step].checks.find((c) => c.id === id)!;

afterEach(() => {
  setLineMoney(null);
  setProcurementSet([]);
});

describe("the one figure for what is left on a budget line", () => {
  it("is the budget, less spent, less committed, less asked for, and reads the same everywhere", () => {
    const f = lineFigure("2.3", 12000, 0, 7800, 0);
    expect(f.available).toBe(4200);
    expect(lineFigureText(f, usd, "PR-2027-009")).toBe("$4,200 available on 2.3: budget $12,000, less $7,800 committed to PR-2027-009");
    expect(lineFigureText(lineFigure("2.2", 38000, 2300, 1560, 4800), usd)).toBe("$29,340 available on 2.2: budget $38,000, less $2,300 spent, less $1,560 committed to purchases under way, less $4,800 asked for outside the calendar");
    // Short: the words say by how much, and never show a negative amount as available.
    expect(lineFigureText(lineFigure("2.1", 1000, 0, 1500, 0), usd)).toBe("$0 available on 2.1: budget $1,000, less $1,500 committed to purchases under way ($500 over)");
  });

  it("the requisition and the approver are held to it, and see it in the same words", () => {
    const sprayers = proc({ id: "PR-2027-009", title: "Knapsack sprayers", budgetLine: "2.3", qty: 60, unitPrice: 130, step: "payReady", contractUsd: 7800 });
    const first = proc({ id: "PR-2026-002", title: "Sprayer spare parts", budgetLine: "2.3", qty: 1, unitPrice: 3000, step: "requisition" });
    const second = proc({ id: "PR-2026-003", title: "More spare parts", budgetLine: "2.3", qty: 1, unitPrice: 3000, step: "requisition" });
    setProcurementSet([sprayers, first, second]);
    setLineMoney([{ code: "2.3", budgetUsd: 12000, spentUsd: 0, asks: [] }]);
    expect(committedByLine([sprayers, first, second])).toEqual({ "2.3": 13800 });
    // Each $3,000 request sees the other's claim and the sprayers': 12,000 - 7,800 - 3,000 = 1,200.
    const r = checkState(first, check("requisition", "budgetValue"), usd);
    expect(r).toMatchObject({ ok: false, auto: true });
    expect(r.detail).toBe("Needs $3,000 · $1,200 available on 2.3: budget $12,000, less $10,800 committed to PR-2027-009, PR-2026-003");
    // The approver's own check says the same thing and blocks the same way.
    const a = checkState({ ...first, step: "approveReq" }, check("approveReq", "budgetStill"), usd);
    expect(a).toMatchObject({ ok: false, auto: true, detail: r.detail });
    // So does the printed requisition.
    const row = documentFor(first, "Purchase requisition", usd, usd).rows.find(([k]) => k === "Budget line")?.[1];
    expect(row).toContain("$1,200 available on 2.3: budget $12,000, less $10,800 committed to PR-2027-009, PR-2026-003");
    // With only one of them, it fits.
    setProcurementSet([sprayers, first]);
    expect(checkState(first, check("requisition", "budgetValue"), usd)).toMatchObject({ ok: true, detail: "Needs $3,000 · $4,200 available on 2.3: budget $12,000, less $7,800 committed to PR-2027-009" });
    expect(checkState({ ...first, step: "approveReq" }, check("approveReq", "budgetStill"), usd)).toMatchObject({ ok: true });
  });

  it("other asks made outside the calendar are taken off, but never a request's own", () => {
    const mine = proc({ id: "PR-2026-001", budgetLine: "2.2", qty: 40, unitPrice: 120, step: "requisition", plan: { key: "UP-001", project: "Demo", budgetCode: "2.2", budgetName: "Fertilizer", leftUsd: 4800, left: 4800, currency: "USD", approvedBy: [], requestedBy: "Laila" } });
    setProcurementSet([mine]);
    setLineMoney([{ code: "2.2", budgetUsd: 38000, spentUsd: 2300, asks: [{ key: "UP-001", usd: 4800 }, { key: "UP-010", usd: 30000 }] }]);
    expect(checkState(mine, check("requisition", "budgetValue"), usd).detail).toBe("Needs $4,800 · $5,700 available on 2.2: budget $38,000, less $2,300 spent, less $30,000 asked for outside the calendar");
  });

  it("with no budget loaded the checks stay as they were, and the approver's adds nothing to tick", () => {
    const p = proc({ id: "PR-X", budgetLine: "2.3", qty: 1, unitPrice: 100, step: "approveReq" });
    setProcurementSet([p]);
    expect(checkState(p, check("approveReq", "budgetStill"), usd)).toMatchObject({ ok: true, auto: true, detail: "Checked when the requisition was submitted" });
  });
});

describe("asking for a purchase outside the calendar", () => {
  const budget = demoBudget(TODAY);
  const workplan = demoWorkplan(TODAY);
  const nadia = users.find((u) => u.id === "nadia")!;
  const line = budget.lines.find((l) => l.code === "2.1")!;
  const ask = (value: number): AskInput => ({ title: "Replacement water pump", budgetCode: "2.1", value, neededBy: addDays(TODAY, 90), reason: "The old pump broke and seedlings need water." });
  const make = (value: number, committed: number) => unplannedItem(ask(value), { line, currency: budget.currency, workplan, people: users, user: nadia, today: TODAY, key: "UP-001", committed });

  it("counts what purchases under way are committed to: the review's $25,000 ask is refused", () => {
    const left = line.total - (line.spent ?? 0);
    expect(lineRoom(line, [], undefined, 0).afterAsks).toBe(left);
    expect((make(left, 0) as PlanItem).status).toBe("draft");
    // The same ask once a purchase on the line is committed and unpaid.
    const refused = make(left, 7800);
    expect(typeof refused).toBe("string");
    expect(refused).toContain(`available on 2.1: budget`);
    expect(refused).toContain("committed to purchases under way");
    expect((make(left - 7800, 7800) as PlanItem).status).toBe("draft");
  });
});

describe("code review of ISS-07: the same figure on every screen", () => {
  it("a calendar-started request counts a direct purchase on its line, as the ask form does", () => {
    const direct = proc({ id: "PR-2026-020", title: "Direct pump order", budgetLine: "2.3", qty: 1, unitPrice: 3000, step: "requisition" });
    const fromCalendar = proc({ id: "PR-2026-021", budgetLine: "2.3", qty: 1, unitPrice: 2000, step: "requisition", plan: { key: "UP-002", project: "Demo", budgetCode: "2.3", budgetName: "Crop protection", leftUsd: 12000, left: 12000, currency: "USD", approvedBy: [], requestedBy: "Laila" } });
    setProcurementSet([direct, fromCalendar]);
    setLineMoney([{ code: "2.3", budgetUsd: 12000, spentUsd: 0, asks: [] }]);
    expect(committedByLine([direct, fromCalendar])).toEqual({ "2.3": 5000 });
    expect(checkState(fromCalendar, check("requisition", "budgetValue"), usd).detail).toBe("Needs $2,000 · $9,000 available on 2.3: budget $12,000, less $3,000 committed to PR-2026-020");
  });

  it("a request sent back holds no money on its line until it is sent again", () => {
    const line = demoBudget(TODAY).lines.find((l) => l.code === "2.1")!;
    const nadia = users.find((u) => u.id === "nadia")!;
    const ask = unplannedItem({ title: "Pump", budgetCode: "2.1", value: 1000, neededBy: addDays(TODAY, 90), reason: "The old pump broke and seedlings need water." }, { line, currency: "USD", workplan: demoWorkplan(TODAY), people: users, user: nadia, today: TODAY, key: "UP-005", committed: 0 }) as PlanItem;
    const free = lineRoom(line, []).afterAsks;
    expect(lineRoom(line, [ask]).afterAsks).toBe(free - 1000);
    expect(lineRoom(line, [{ ...ask, status: "returned" }]).afterAsks).toBe(free);
  });
});
