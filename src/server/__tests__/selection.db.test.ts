import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById } from "@/lib/demo";
import { ready } from "@/server/__tests__/test-db";
import { auditTrail } from "@/server/audit";
import { seedDatabase } from "@/server/demo-seed";
import { actOnSelection, loadSelection } from "@/server/selection-store";

/** Farmer selection on the seeded demo project: rules by the people who may change the project, decisions kept with their reason. */
const code = "A-2027";
const marcus = userById("marcus")!; // plan approver
const farida = userById("farida")!; // extension agent

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
    expect(await actOnSelection(code, { action: "decide", farmer: f1.id, selected: true, met: [], reason: "" }, marcus)).toMatch(/rules first/);
    expect(await actOnSelection(code, { action: "criteria", outreach: "Announced at the village meeting.", criteria: ["Farms 0.2 to 2 ha"], reason: "" }, farida)).toMatch(/Only the project manager/);
    expect(await actOnSelection(code, { action: "criteria", outreach: "Announced at the village meeting.", criteria: ["Farms 0.2 to 2 ha", "Lives in a project village"], reason: "" }, marcus)).toBeNull();
    const s = (await loadSelection(code, marcus)).selection;
    expect(s.version).toBe(1);
    const ids = s.criteria.map((c) => c.id);

    expect(await actOnSelection(code, { action: "decide", farmer: f1.id, selected: true, met: ids, reason: "" }, marcus)).toBeNull();
    expect(await actOnSelection(code, { action: "decide", farmer: f2.id, selected: false, met: [], reason: "" }, marcus)).toMatch(/not selected/);
    expect(await actOnSelection(code, { action: "decide", farmer: f2.id, selected: false, met: [ids[1]], reason: "Farms six hectares, above the limit." }, marcus)).toBeNull();
    expect(await actOnSelection(code, { action: "decide", farmer: "F-NOPE", selected: true, met: ids, reason: "" }, marcus)).toMatch(/No such farmer/);
    expect(await actOnSelection(code, { action: "decide", farmer: f1.id, selected: true, met: ids, reason: "" }, farida)).toMatch(/Only the project manager/);

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
});
