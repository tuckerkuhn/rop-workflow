import { describe, expect, it } from "vitest";
import { users } from "@/lib/demo";
import { demoBudget, demoWorkplan } from "@/lib/demo-design";
import { addDays, applyAction, askSchema, buildPlan, canAsk, unplannedItem, type AskInput, type PlanItem } from "@/lib/procurement-plan";

/** Asking for a purchase that is not on the procurement calendar: an added path, never a shortcut past the approvals. */
const TODAY = "2026-11-15";
const by = (id: string) => users.find((u) => u.id === id)!;
const zahra = by("zahra"); // procurement manager's team
const nadia = by("nadia"); // project manager, procurement edit
const budget = demoBudget(TODAY);
const workplan = demoWorkplan(TODAY);
const rows = workplan.map((w) => w.code);
const line = budget.lines.find((l) => l.code === "2.1")!;
const ask = (over: Partial<AskInput> = {}): AskInput => ({ title: "Replacement water pump", budgetCode: "2.1", value: 100, neededBy: addDays(TODAY, 90), reason: "The old pump broke and seedlings need water.", ...over });
const make = (over: Partial<AskInput> = {}, user = nadia) => unplannedItem(ask(over), { line: budget.lines.find((l) => l.code === (over.budgetCode ?? "2.1")), currency: budget.currency, workplan, people: users, user, today: TODAY, key: "UP-001" });

describe("asking for something not on the calendar", () => {
  it("makes a draft calendar item marked as not planned, with no approvals", () => {
    const item = make() as PlanItem;
    expect(item).toMatchObject({ key: "UP-001", budgetCode: "2.1", status: "draft", approvals: {}, value: 100, procurementKey: null });
    expect(item.unplanned).toMatchObject({ by: "nadia", reason: "The old pump broke and seedlings need water.", urgent: false });
    expect(item.techLead).toBeTruthy();
  });

  it("is urgent when ticked, or when needed sooner than a purchase that size usually takes", () => {
    expect((make({ urgent: true }) as PlanItem).unplanned?.urgent).toBe(true);
    const soon = make({ neededBy: addDays(TODAY, 2) }) as PlanItem;
    expect(soon.unplanned?.urgent).toBe(true);
    expect(soon.startBy).toBe(TODAY);
  });

  it("needs a reason, a cost and a budget line", () => {
    expect(askSchema.safeParse(ask({ reason: "" })).success).toBe(false);
    expect(askSchema.safeParse(ask({ reason: "  short  " })).success).toBe(false);
    expect(askSchema.safeParse(ask({ value: 0 })).success).toBe(false);
    expect(askSchema.safeParse(ask()).success).toBe(true);
    expect(make({ budgetCode: "9.9" })).toMatch(/not in this project's budget/);
    expect(make({ value: line.total * 10 })).toMatch(/more than the .* left on budget line 2\.1/);
    expect(make({ neededBy: addDays(TODAY, -1) })).toMatch(/has passed/);
  });

  it("is open to staff who can change procurement, not to view-only or no-access staff", () => {
    expect(canAsk(nadia)).toBe(true);
    expect(canAsk(zahra)).toBe(true);
    expect(canAsk(by("peter"))).toBe(false); // view only
    expect(canAsk(by("farida"))).toBe(false); // no procurement access
    expect(make({}, by("peter"))).toMatch(/view Procurement but not ask/);
  });

  it("needs both approvals before a request can start, like any planned item", () => {
    const item = make() as PlanItem;
    const lead = by(item.techLead!);
    expect(applyAction(item, { action: "start", procurementKey: "PR-2027-900" }, lead, users, TODAY, rows)).toBe("It needs both approvals before the request starts.");
    // The person who asked cannot approve for procurement unless they are procurement.
    expect(applyAction(item, { action: "approve", as: "manager" }, nadia, users, TODAY, rows)).toMatch(/Only the procurement manager/);
    const one = applyAction(item, { action: "approve", as: "manager" }, zahra, users, TODAY, rows) as PlanItem;
    expect(one.status).toBe("draft");
    expect(applyAction(one, { action: "start", procurementKey: "PR-2027-900" }, lead, users, TODAY, rows)).toMatch(/both approvals/);
    const two = applyAction(one, { action: "approve", as: "lead" }, lead, users, TODAY, rows) as PlanItem;
    expect(two.status).toBe("approved");
    expect(applyAction(two, { action: "start", procurementKey: "PR-2027-900" }, lead, users, TODAY, rows)).toMatchObject({ status: "started", procurementKey: "PR-2027-900", unplanned: { by: "nadia" } });
  });

  it("stays on the calendar when the calendar is rebuilt from the budget, beside the line's planned item", () => {
    const asked = make() as PlanItem;
    const first = buildPlan({ lines: budget.lines, currency: budget.currency, workplan, projectStart: "2026-10-01", people: users, existing: [asked] });
    expect(first.items.filter((i) => i.key === "UP-001")).toHaveLength(1);
    expect(first.removed).not.toContain("UP-001");
    // A planned item for the same line is still built, and the asked-for one is left as it was.
    const again = buildPlan({ lines: budget.lines, currency: budget.currency, workplan, projectStart: "2026-10-01", people: users, existing: first.items });
    expect(again.items.find((i) => i.key === "UP-001")).toEqual(asked);
    if (line.procure) expect(again.items.some((i) => !i.unplanned && i.budgetCode === "2.1")).toBe(true);
  });
});
