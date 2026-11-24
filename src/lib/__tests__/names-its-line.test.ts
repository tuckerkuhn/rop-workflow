import { describe, expect, it } from "vitest";
import { billLineProblem } from "@/lib/bills";
import { users } from "@/lib/demo";
import { demoBudget, demoWorkplan } from "@/lib/demo-design";
import { applyAction, itemFor, type PlanItem, procurementManager } from "@/lib/procurement-plan";

const TODAY = "2026-11-15";
// The procurement manager: the one who approves for procurement.
const zahra = procurementManager(users)!;
const plan = demoWorkplan(TODAY);
const rows = plan.map((w) => w.code);
const line = demoBudget(TODAY).lines.find((l) => l.code === "2.1")!;
const item = (over: Partial<PlanItem> = {}): PlanItem => ({ ...itemFor(line, "USD", plan, "2026-10-01", users, "PP-001")!, ...over });

describe("a purchase names the workplan row it serves", () => {
  it("starts from the app's match, marked as not yet chosen by a person", () => {
    expect(item().workplanCode).toBe("1.2.1.1");
    expect(item().workplanBy).toBeUndefined();
  });

  it("records who chose the row, and sends the item back for approval", () => {
    const out = applyAction(item({ approvals: {} }), { action: "edit", workplanCode: "1.2.1.2" }, zahra, users, TODAY, rows) as PlanItem;
    expect(out).toMatchObject({ workplanCode: "1.2.1.2", workplanBy: zahra.id, status: "draft", edited: true });
  });

  it("refuses a row that is not in the workplan", () => {
    expect(applyAction(item(), { action: "edit", workplanCode: "9.9.9.9" }, zahra, users, TODAY, rows)).toMatch(/not in this project's workplan/);
  });

  it("cannot be approved by procurement until it names a row, when the project has a workplan", () => {
    expect(applyAction(item({ workplanCode: null }), { action: "approve", as: "manager" }, zahra, users, TODAY, rows)).toBe("Choose the workplan row this purchase serves before approving it.");
    // A row that has since left the workplan counts as none.
    expect(applyAction(item({ workplanCode: "1.2.1.1" }), { action: "approve", as: "manager" }, zahra, users, TODAY, ["1.1.1.1"])).toMatch(/^Choose the workplan row/);
    expect(typeof applyAction(item(), { action: "approve", as: "manager" }, zahra, users, TODAY, rows)).toBe("object");
  });

  it("does not hold up a project that has no workplan yet", () => {
    expect(typeof applyAction(item({ workplanCode: null }), { action: "approve", as: "manager" }, zahra, users, TODAY, [])).toBe("object");
    expect(typeof applyAction(item({ workplanCode: null }), { action: "approve", as: "manager" }, zahra, users, TODAY)).toBe("object");
  });

  it("leaves the row alone when an edit does not mention it", () => {
    const out = applyAction(item({ workplanBy: "nadia" }), { action: "edit", leadDays: 30 }, zahra, users, TODAY, rows) as PlanItem;
    expect(out).toMatchObject({ workplanCode: "1.2.1.1", workplanBy: "nadia", leadDays: 30 });
  });
});

describe("a bill names the budget line it is charged to", () => {
  const lines = { "A-2027": [{ code: "2.1" }, { code: "5.1" }] };
  const NONE = "non-contract";

  it("needs a line from the project's budget when it is charged to a project", () => {
    expect(billLineProblem("A-2027", null, lines, NONE)).toBe("Choose the budget line this bill is charged to.");
    expect(billLineProblem("A-2027", "9.9", lines, NONE)).toMatch(/^Line 9\.9 is not in that project's budget/);
    expect(billLineProblem("A-2027", "5.1", lines, NONE)).toBeNull();
  });

  it("takes no line for general and admin, and none for a project with no budget loaded", () => {
    expect(billLineProblem(NONE, null, lines, NONE)).toBeNull();
    expect(billLineProblem(NONE, "2.1", lines, NONE)).toMatch(/has no project budget line/);
    expect(billLineProblem("B-2028", null, lines, NONE)).toBeNull();
    expect(billLineProblem("B-2028", "2.1", lines, NONE)).toMatch(/no budget loaded yet/);
  });
});

describe("procurement calendar timing", () => {
  it("never starts a purchase before the project does", () => {
    const big = { ...line, procure: true, total: 40_000, spent: 0, schedule: {} };
    const it_ = itemFor(big, "USD", [], "2026-01-01", users, "PP-009")!;
    expect(it_.neededBy).toBe("2026-01-01");
    expect(it_.startBy).toBe("2026-01-01");
  });
});
