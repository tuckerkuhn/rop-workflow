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
    expect(await actOnSelection(code, { action: "decide", farmer: f1.id, selected: true, met: [], reason: "", change: "" }, marcus)).toMatch(/rules first/);
    expect(await actOnSelection(code, { action: "criteria", outreach: "Announced at the village meeting.", criteria: ["Farms 0.2 to 2 ha"], reason: "" }, farida)).toMatch(/Only the project manager/);
    expect(await actOnSelection(code, { action: "criteria", outreach: "Announced at the village meeting.", criteria: ["Farms 0.2 to 2 ha", "Lives in a project village"], reason: "" }, marcus)).toBeNull();
    const s = (await loadSelection(code, marcus)).selection;
    expect(s.version).toBe(1);
    const ids = s.criteria.map((c) => c.id);

    expect(await actOnSelection(code, { action: "decide", farmer: f1.id, selected: true, met: ids, reason: "", change: "" }, marcus)).toBeNull();
    expect(await actOnSelection(code, { action: "decide", farmer: f2.id, selected: false, met: [], reason: "", change: "" }, marcus)).toMatch(/not selected/);
    expect(await actOnSelection(code, { action: "decide", farmer: f2.id, selected: false, met: [ids[1]], reason: "Farms six hectares, above the limit.", change: "" }, marcus)).toBeNull();
    expect(await actOnSelection(code, { action: "decide", farmer: "F-NOPE", selected: true, met: ids, reason: "", change: "" }, marcus)).toMatch(/No such farmer/);
    expect(await actOnSelection(code, { action: "decide", farmer: f1.id, selected: true, met: ids, reason: "", change: "" }, farida)).toMatch(/Only the project manager/);

    // Changing the rules after decisions needs a reason; a rule kept word for word keeps its ticks.
    expect(await actOnSelection(code, { action: "criteria", outreach: "Announced at the village meeting.", criteria: ["Farms 0.2 to 2 ha", "Agrees to the contribution"], reason: "" }, marcus)).toMatch(/already been decided/);
    expect(await actOnSelection(code, { action: "criteria", outreach: "Announced at the village meeting.", criteria: ["Farms 0.2 to 2 ha", "Agrees to the contribution"], reason: "The donor asked for the contribution rule." }, marcus)).toBeNull();
    const after = await loadSelection(code, marcus);
    expect(after.selection.version).toBe(2);
    expect(after.selection.criteria[0].id).toBe(ids[0]);
    expect(after.selection.decisions[f1.id]).toMatchObject({ selected: true, version: 1 });
    expect(after.counts).toMatchObject({ selected: 1, notSelected: 1, undecided: after.farmers.length - 2 });

    const rows = (await auditTrail(code, "2000-01-01", "2999-12-31")).filter((r) => r.entity === "selection");
    expect(rows.map((r) => r.action)).toEqual(["selection_rules_set", "selection_selected", "selection_not_selected", "selection_rules_set"]);
  });

  it("keeps a changed decision with why, keeps exceptions when the rules change, and shows the list only to those who need it", async () => {
    expect(maySeeSelection(farida)).toBe(true);
    expect(maySeeSelection(marcus)).toBe(true);
    expect(maySeeSelection(hamid)).toBe(false);

    const v = await loadSelection(code, marcus);
    const [f1, , f3] = v.farmers;
    const ids = v.selection.criteria.map((c) => c.id);
    // Deciding again needs a reason for the change, and the earlier decision is kept.
    expect(await actOnSelection(code, { action: "decide", farmer: f1.id, selected: false, met: [], reason: "Moved out of the project area.", change: "" }, marcus)).toMatch(/Say why the decision is changing/);
    expect(await actOnSelection(code, { action: "decide", farmer: f1.id, selected: false, met: [], reason: "Moved out of the project area.", change: "Found out at the follow-up visit." }, marcus)).toBeNull();
    const changed = (await loadSelection(code, marcus)).selection.decisions[f1.id];
    expect(changed).toMatchObject({ selected: false, earlier: [{ decision: { selected: true }, why: "Found out at the follow-up visit." }] });

    // An exception stays an exception after the rules change.
    expect(await actOnSelection(code, { action: "decide", farmer: f3.id, selected: true, met: [ids[0]], reason: "Widow heading the household; the committee agreed.", change: "" }, marcus)).toBeNull();
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
});
