import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById } from "@/lib/demo";
import { ready } from "@/server/__tests__/test-db";
import { auditTrail } from "@/server/audit";
import { seedDatabase } from "@/server/demo-seed";
import { actOnSelection, loadSelection, maySeeSelection } from "@/server/selection-store";

/** Farmer selection on the seeded demo project: rules by the people who may change the project, decisions kept with their reason. */
const code = "A-2027";
const marcus = userById("marcus")!; // plan approver
const farida = userById("farida")!; // extension agent
const hamid = userById("hamid")!; // procurement, no field access

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("farmer selection", { timeout: 60_000 }, () => {
  it("is written by a plan approver, decided with reasons, and survives a change to the rules", async () => {
    const first = await loadSelection(code, marcus);
    expect(first.farmers.length).toBeGreaterThan(1);
    const [f1, f2] = first.farmers;
    // No decision before the rules exist; no rules from someone who may not change the project.
    expect(await actOnSelection(code, { action: "decide", farmer: f1.id, outcome: "selected", met: [], reason: "", change: "" }, marcus)).toMatch(/rules first/);
    expect(await actOnSelection(code, { action: "criteria", outreach: "Announced at the village meeting.", criteria: ["Farms 0.2 to 2 ha"], reason: "" }, farida)).toMatch(/Only the project manager/);
    expect(await actOnSelection(code, { action: "criteria", outreach: "Announced at the village meeting.", criteria: ["Farms 0.2 to 2 ha", "Lives in a project village"], reason: "" }, marcus)).toBeNull();
    const s = (await loadSelection(code, marcus)).selection;
    expect(s.version).toBe(1);
    const ids = s.criteria.map((c) => c.id);

    expect(await actOnSelection(code, { action: "decide", farmer: f1.id, outcome: "selected", met: ids, reason: "", change: "" }, marcus)).toBeNull();
    expect(await actOnSelection(code, { action: "decide", farmer: f2.id, outcome: "not_qualified", met: [], reason: "", change: "" }, marcus)).toMatch(/did not qualify/);
    expect(await actOnSelection(code, { action: "decide", farmer: f2.id, outcome: "not_qualified", met: [ids[1]], reason: "Farms six hectares, above the limit.", change: "" }, marcus)).toBeNull();
    expect(await actOnSelection(code, { action: "decide", farmer: "F-NOPE", outcome: "selected", met: ids, reason: "", change: "" }, marcus)).toMatch(/No such farmer/);
    expect(await actOnSelection(code, { action: "decide", farmer: f1.id, outcome: "selected", met: ids, reason: "", change: "" }, farida)).toMatch(/Only the project manager/);

    // Changing the rules after decisions needs a reason; a rule kept word for word keeps its ticks.
    expect(await actOnSelection(code, { action: "criteria", outreach: "Announced at the village meeting.", criteria: ["Farms 0.2 to 2 ha", "Agrees to the contribution"], reason: "" }, marcus)).toMatch(/already been decided/);
    expect(await actOnSelection(code, { action: "criteria", outreach: "Announced at the village meeting.", criteria: ["Farms 0.2 to 2 ha", "Agrees to the contribution"], reason: "The donor asked for the contribution rule." }, marcus)).toBeNull();
    const after = await loadSelection(code, marcus);
    expect(after.selection.version).toBe(2);
    expect(after.selection.criteria[0].id).toBe(ids[0]);
    expect(after.selection.decisions[f1.id]).toMatchObject({ outcome: "selected", version: 1 });
    expect(after.counts).toMatchObject({ selected: 1, notQualified: 1, waitlisted: 0, undecided: after.farmers.length - 2 });

    const rows = (await auditTrail(code, "2000-01-01", "2999-12-31")).filter((r) => r.entity === "selection");
    expect(rows.map((r) => r.action)).toEqual(["selection_rules_set", "selection_selected", "selection_not_qualified", "selection_rules_set"]);
  });

  it("keeps a changed decision with why, keeps exceptions when the rules change, and shows the list only to those who need it", async () => {
    expect(maySeeSelection(farida)).toBe(true);
    expect(maySeeSelection(marcus)).toBe(true);
    expect(maySeeSelection(hamid)).toBe(false);

    const v = await loadSelection(code, marcus);
    const [f1, , f3] = v.farmers;
    const ids = v.selection.criteria.map((c) => c.id);
    // Deciding again needs a reason for the change, and the earlier decision is kept.
    expect(await actOnSelection(code, { action: "decide", farmer: f1.id, outcome: "not_qualified", met: [], reason: "Moved out of the project area.", change: "" }, marcus)).toMatch(/Say why the decision is changing/);
    expect(await actOnSelection(code, { action: "decide", farmer: f1.id, outcome: "not_qualified", met: [], reason: "Moved out of the project area.", change: "Found out at the follow-up visit." }, marcus)).toBeNull();
    const changed = (await loadSelection(code, marcus)).selection.decisions[f1.id];
    expect(changed).toMatchObject({ selected: false, outcome: "not_qualified", earlier: [{ decision: { selected: true }, why: "Found out at the follow-up visit." }] });

    // An exception stays an exception after the rules change.
    expect(await actOnSelection(code, { action: "decide", farmer: f3.id, outcome: "selected", met: [ids[0]], reason: "Widow heading the household; the committee agreed.", change: "" }, marcus)).toBeNull();
    expect((await loadSelection(code, marcus)).counts.exceptions).toBe(1);
    const rules = v.selection.criteria.map((c) => c.text);
    // Reordering is not a change of rules: no reason asked, version unchanged.
    expect(await actOnSelection(code, { action: "criteria", outreach: v.selection.outreach, criteria: [...rules].reverse(), reason: "" }, marcus)).toBeNull();
    expect((await loadSelection(code, marcus)).selection.version).toBe(v.selection.version);
    expect(await actOnSelection(code, { action: "criteria", outreach: v.selection.outreach, criteria: [...rules, "Has water for the orchard"], reason: "Water turned out to decide survival." }, marcus)).toBeNull();
    const after = await loadSelection(code, marcus);
    expect(after.selection.version).toBe(v.selection.version + 1);
    expect(after.counts.exceptions).toBe(1);
    expect(after.selection.decisions[f3.id]).toMatchObject({ of: 2, exception: true });
  });

  it("waitlists a farmer who qualifies, then selects them from the waitlist with a reason, keeping the history", async () => {
    const v = await loadSelection(code, marcus);
    const f = v.farmers.find((x) => !v.selection.decisions[x.id])!;
    const ids = v.selection.criteria.map((c) => c.id);
    expect(await actOnSelection(code, { action: "decide", farmer: f.id, outcome: "waitlisted", met: ids, reason: "", change: "" }, marcus)).toMatch(/why this farmer is waitlisted/);
    expect(await actOnSelection(code, { action: "decide", farmer: f.id, outcome: "waitlisted", met: ids, reason: "All 40 places for this season are taken.", change: "" }, marcus)).toBeNull();
    const mid = await loadSelection(code, marcus);
    expect(mid.counts.waitlisted).toBe(1);
    expect(mid.selection.decisions[f.id]).toMatchObject({ outcome: "waitlisted", selected: false });
    expect(await actOnSelection(code, { action: "decide", farmer: f.id, outcome: "selected", met: ids, reason: "", change: "A selected farmer moved away; place offered." }, marcus)).toBeNull();
    const after = (await loadSelection(code, marcus)).selection.decisions[f.id];
    expect(after).toMatchObject({ outcome: "selected", selected: true, earlier: [{ decision: { outcome: "waitlisted" }, why: "A selected farmer moved away; place offered." }] });
    const rows = (await auditTrail(code, "2000-01-01", "2999-12-31")).filter((r) => r.entity === "selection" && r.detail.farmer === f.id);
    expect(rows.map((r) => r.action)).toEqual(["selection_waitlisted", "selection_changed"]);
  });
});
