import { describe, expect, it } from "vitest";
import { users } from "@/lib/demo";
import { demoBudget, demoWorkplan } from "@/lib/demo-design";
import { BOTH_SEATS, OWN_REQUEST, splitAsk, addDays, applyAction, askSchema, awaiting, buildPlan, canAsk, leadFor, leadOtherThan, unplannedItem, type AskInput, type PlanItem } from "@/lib/procurement-plan";

/** Asking for a purchase that is not on the procurement calendar: an added path, never a shortcut past the approvals. */
const TODAY = "2026-11-15";
const by = (id: string) => users.find((u) => u.id === id)!;
const zahra = by("zahra"); // procurement officer on the manager's team
const hamid = by("hamid"); // the procurement manager
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
    expect(make({ value: line.total * 10 })).toMatch(/more than the .* available on 2\.1: budget /);
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
    // The person who asked cannot approve it at all (review round 1, ISS-03).
    expect(applyAction(item, { action: "approve", as: "manager" }, nadia, users, TODAY, rows)).toBe(OWN_REQUEST);
    // A procurement officer is not the procurement manager: only the manager approves for procurement.
    expect(applyAction(item, { action: "approve", as: "manager" }, zahra, users, TODAY, rows)).toMatch(/Only the procurement manager \(Hamid Wardak\)/);
    const one = applyAction(item, { action: "approve", as: "manager" }, hamid, users, TODAY, rows) as PlanItem;
    expect(one.status).toBe("draft");
    expect(applyAction(one, { action: "start", procurementKey: "PR-2027-900" }, lead, users, TODAY, rows)).toMatch(/both approvals/);
    const two = applyAction(one, { action: "approve", as: "lead" }, lead, users, TODAY, rows) as PlanItem;
    expect(two.status).toBe("approved");
    expect(applyAction(two, { action: "start", procurementKey: "PR-2027-900" }, lead, users, TODAY, rows)).toMatchObject({ status: "started", procurementKey: "PR-2027-900", unplanned: { by: "nadia" } });
  });

  // Review round 1, ISS-03: Laila leads 5 of the 6 planned lines and approved her own requests as technical lead.
  it("the person who asked never approves it, in either seat, and their own line goes to someone else", () => {
    const laila = by("laila");
    const own = budget.lines.find((l) => leadFor(l, users) === "laila")!;
    const item = unplannedItem(ask({ budgetCode: own.code, value: 1 }), { line: own, currency: budget.currency, workplan, people: users, user: laila, today: TODAY, key: "UP-002" }) as PlanItem;
    // Her line's approval goes to another lead of the line, or to her line manager: never to her.
    expect(item.techLead).toBe(leadOtherThan(own, users, laila));
    expect(item.techLead).not.toBe("laila");
    expect(item.techLead).toBeTruthy();
    expect(applyAction(item, { action: "approve", as: "lead" }, laila, users, TODAY, rows)).toBe(OWN_REQUEST);
    expect(applyAction(item, { action: "approve", as: "manager" }, laila, users, TODAY, rows)).toBe(OWN_REQUEST);
    // An administrator who asked cannot sign for others on their own request either.
    const admin = { ...laila, admin: true };
    expect(applyAction(item, { action: "approve", as: "lead" }, admin, users, TODAY, rows)).toBe(OWN_REQUEST);
    // She cannot be put back as the approver, and it is not on her list of things to approve.
    expect(applyAction(item, { action: "edit", techLead: "laila" }, hamid, users, TODAY, rows)).toMatch(/cannot be the one who approves it/);
    expect(awaiting([{ ...item, techLead: "laila" }], laila).asLead).toHaveLength(0);
    // The procurement manager asking for something is held to the same rule.
    const his = unplannedItem(ask({ value: 1 }), { line, currency: budget.currency, workplan, people: users, user: hamid, today: TODAY, key: "UP-003" }) as PlanItem;
    expect(applyAction(his, { action: "approve", as: "manager" }, hamid, users, TODAY, rows)).toBe(OWN_REQUEST);
    expect(awaiting([his], hamid).asManager).toHaveLength(0);
    // Once two other people approve, she starts her own request.
    const other = by(item.techLead!);
    const approved = applyAction(applyAction(item, { action: "approve", as: "manager" }, hamid, users, TODAY, rows) as PlanItem, { action: "approve", as: "lead" }, other, users, TODAY, rows) as PlanItem;
    expect(approved.status).toBe("approved");
    expect(approved.approvals.lead?.by).not.toBe("laila");
    expect(applyAction(approved, { action: "start", procurementKey: "PR-2027-901" }, laila, users, TODAY, rows)).toMatchObject({ status: "started" });
  });

  // Review round 1, ISS-17: two $3,000 asks on one line were caught only at the approver's step.
  it("a possible split is said when it is asked for, and kept for the calendar's approvers", () => {
    const first = unplannedItem(ask({ title: "Sprayer spare parts A", value: 3000 }), { line, currency: budget.currency, workplan, people: users, user: nadia, today: TODAY, key: "UP-008" }) as PlanItem;
    expect(first.unplanned?.split).toBeUndefined();
    const second = unplannedItem(ask({ title: "Sprayer spare parts B", value: 3000 }), { line, currency: budget.currency, workplan, people: users, user: nadia, today: TODAY, key: "UP-009", items: [first] }) as PlanItem;
    expect(second.unplanned?.split).toMatch(/^Possible split purchase\. With UP-008 \(3,000 USD\) asked for on budget line 2\.1 within 30 days, this makes \$6,000 together: a Medium purchase, not Small\./);
    // Small asks that stay in the same level together are not flagged; nor is one made long after.
    expect(splitAsk({ budgetCode: "2.1", value: 100, currency: "USD", at: TODAY }, [{ ...first, value: 200, usd: 200 }])).toBeNull();
    expect(splitAsk({ budgetCode: "2.1", value: 3000, currency: "USD", at: addDays(TODAY, 45) }, [first])).toBeNull();
    // One on another line, or one that was sent back, does not count.
    expect(splitAsk({ budgetCode: "2.2", value: 3000, currency: "USD", at: TODAY }, [first])).toBeNull();
    expect(splitAsk({ budgetCode: "2.1", value: 3000, currency: "USD", at: TODAY }, [{ ...first, status: "returned" }])).toBeNull();
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

describe("an ask cannot promise a budget line's money twice", () => {
  const room = Math.round((line.total - (line.spent ?? 0)) * 100) / 100;
  const other = (over: Partial<PlanItem>): PlanItem => ({ ...(make() as PlanItem), key: "UP-000", ...over });
  const withItems = (items: PlanItem[], over: Partial<AskInput> = {}) =>
    unplannedItem(ask(over), { line, currency: budget.currency, workplan, people: users, user: nadia, today: TODAY, key: "UP-001", items });

  it("refuses an ask past what is left after other open asks on the line, and says how much is left", () => {
    const asked = other({ value: room - 50 });
    expect(withItems([asked], { value: 60 })).toMatch(/more than the 50 USD available on 2\.1: budget .* less .* asked for outside the calendar/);
    expect(withItems([asked], { value: 50 })).toMatchObject({ key: "UP-001" });
  });

  it("does not count a started item again: its money is in spent once paid", () => {
    expect(withItems([other({ value: room, status: "started" })], { value: 60 })).toMatchObject({ key: "UP-001" });
  });

  it("allows going past the line's planned items (estimates) but marks it for the approvers", () => {
    const planned = other({ key: "PP-001", unplanned: undefined, value: room - 30 });
    const item = withItems([planned], { value: 40 }) as PlanItem;
    expect(item.unplanned?.overPlan).toMatch(/has 30 .* left after the purchases already planned on it/);
    expect((withItems([planned], { value: 30 }) as PlanItem).unplanned?.overPlan).toBeUndefined();
  });
});

describe("the needed-by date is a real day", () => {
  it("refuses dates that do not exist", () => {
    expect(askSchema.safeParse(ask({ neededBy: "2027-02-31" })).success).toBe(false);
    expect(askSchema.safeParse(ask({ neededBy: "2027-13-01" })).success).toBe(false);
    expect(askSchema.safeParse(ask({ neededBy: "2027-02-28" })).success).toBe(true);
  });
});

describe("two seats, two people (code review of D-13)", () => {
  it("whoever signed one seat cannot sign the other, an administrator included", () => {
    const item = make() as PlanItem;
    const tucker = by("tucker"); // an administrator, not the asker
    const one = applyAction(item, { action: "approve", as: "manager" }, tucker, users, TODAY, rows) as PlanItem;
    expect(one.approvals?.manager?.by).toBe("tucker");
    expect(applyAction(one, { action: "approve", as: "lead" }, tucker, users, TODAY, rows)).toBe(BOTH_SEATS);
    // The other way round too: the technical lead who signed cannot also sign for procurement.
    const lead = by(item.techLead!);
    const asLead = applyAction(item, { action: "approve", as: "lead" }, { ...lead, admin: true }, users, TODAY, rows) as PlanItem;
    expect(applyAction(asLead, { action: "approve", as: "manager" }, { ...lead, admin: true }, users, TODAY, rows)).toBe(BOTH_SEATS);
    // Two different people approve it.
    expect((applyAction(one, { action: "approve", as: "lead" }, lead, users, TODAY, rows) as PlanItem).status).toBe("approved");
  });
});

describe("who may change a calendar item's technical lead (review round 2, R2-02)", () => {
  const people = users;
  const u = (id: string) => people.find((p) => p.id === id)!;
  const budget = demoBudget("2026-11-28");
  const plan = buildPlan({ lines: budget.lines, currency: budget.currency, workplan: demoWorkplan("2026-11-28"), projectStart: "2026-10-01", people, existing: [] });
  const item = { ...plan.items.find((i) => i.techLead && i.techLead !== "zahra")!, status: "draft" as const, approvals: {} };
  it("a procurement officer cannot make herself technical lead and approve both seats from procurement", () => {
    expect(applyAction(item, { action: "edit", techLead: "zahra" }, u("zahra"), people, "2026-11-28")).toBe("Only the procurement manager changes the technical lead.");
    expect(applyAction(item, { action: "edit", techLead: "zahra" }, u("hamid"), people, "2026-11-28")).toMatch(/programme side, not procurement/);
    expect(applyAction(item, { action: "edit", techLead: "hamid" }, u("hamid"), people, "2026-11-28")).toMatch(/programme side, not procurement|cannot name yourself/);
    expect(applyAction({ ...item, techLead: "zahra" }, { action: "approve", as: "lead" }, u("zahra"), people, "2026-11-28")).toMatch(/programme side, not procurement/);
  });
  it("the procurement manager can still name another programme lead", () => {
    const other = people.find((p) => p.kind === "employee" && !p.procurement.includes("procurement") && p.id !== item.techLead && p.id !== "hamid")!;
    const r = applyAction(item, { action: "edit", techLead: other.id }, u("hamid"), people, "2026-11-28");
    expect(typeof r === "string" ? r : r.techLead).toBe(other.id);
  });
});
