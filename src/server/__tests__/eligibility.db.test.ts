import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById } from "@/lib/demo";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { actOnSelection, loadSelection } from "@/server/selection-store";

/** MF-12: eligibility rules saved in Farmer selection, checked for each farmer, and a failed one cannot be ticked. */
const code = "A-2027";
const marcus = userById("marcus")!;

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("eligibility rules in Farmer selection", { timeout: 60_000 }, () => {
  it("are saved as rules, shown per farmer, and enforced when a decision is recorded", async () => {
    const first = await loadSelection(code, marcus);
    const big = [...first.farmers].sort((a, b) => b.hectares - a.hectares)[0];
    const max = Math.max(0.1, Math.floor(big.hectares * 10) / 10 - 0.1);
    expect(await actOnSelection(code, { action: "criteria", outreach: "Announced at the village meeting.", criteria: ["Lives in the area for three years"], checks: [{ kind: "land", max }, { kind: "contribution", rate: 20, womenRate: 10 }], reason: "" }, marcus)).toBeNull();
    const v = await loadSelection(code, marcus);
    expect(v.selection.criteria.map((c) => c.text)).toEqual(["Lives in the area for three years", `Farms no more than ${max} hectares`, "Agrees to contribute 20% of the package's value (10% for women)"]);
    const land = v.selection.criteria[1];
    const f = v.farmers.find((x) => x.id === big.id)!;
    expect(f.checks[land.id]).toEqual({ ok: false, detail: `The record says ${big.hectares} ha.` });

    const all = v.selection.criteria.map((c) => c.id);
    expect(await actOnSelection(code, { action: "decide", farmer: big.id, outcome: "selected", met: all, reason: "", change: "" }, marcus)).toMatch(/is not met: The record says .* Correct the farmer's record first/);
    expect(await actOnSelection(code, { action: "decide", farmer: big.id, outcome: "not_qualified", met: all.filter((id) => id !== land.id), reason: "The plot is larger than the limit.", change: "" }, marcus)).toBeNull();

    // Saving the same numbers again is not a change of rules.
    expect(await actOnSelection(code, { action: "criteria", outreach: "Announced at the village meeting.", criteria: ["Lives in the area for three years"], checks: [{ kind: "land", max }, { kind: "contribution", rate: 20, womenRate: 10 }], reason: "" }, marcus)).toBe("Nothing has changed.");
  });
});
