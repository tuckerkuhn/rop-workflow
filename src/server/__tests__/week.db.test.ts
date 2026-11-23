import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById } from "@/lib/demo";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { actOnWeek, loadWeek } from "@/server/week-store";
import { loadHome } from "@/server/home-store";
import { nextReport } from "@/server/next-report";

/** A manager's week ahead on the seeded demo: read from the records, and a plan that is the person's own. */
const tucker = userById("tucker")!;
const daniel = userById("daniel")!;

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("the week ahead", { timeout: 90_000 }, () => {
  it("reads four sentences, three numbers and at most three suggestions from the records", async () => {
    const v = await loadWeek(tucker);
    expect(v.projects.length).toBeGreaterThan(0);
    expect(v.summary.map((s) => s.kind)).toEqual(["due", "risk", "waiting", "changed"]);
    expect(v.numbers).toHaveLength(3);
    expect(v.suggestions.length).toBeLessThanOrEqual(3);
    expect(v.plan).toMatchObject({ items: [], confirmedAt: null });
  });

  it("keeps each person's confirmed priorities their own, ticks them and reopens them", async () => {
    expect(await actOnWeek(tucker, { action: "confirm", items: [{ id: "block:A-2027", text: "Clear what blocks the report", href: "/progress/report#checks", own: false }, { id: "new:1", text: "Call the board chair", href: "https://evil.example", own: true }] })).toBeNull();
    const mine = (await loadWeek(tucker)).plan;
    expect(mine.confirmedAt).not.toBeNull();
    expect(mine.items.map((i) => [i.text, i.href, i.own, i.done])).toEqual([["Clear what blocks the report", "/progress/report#checks", false, false], ["Call the board chair", "", true, false]]);
    expect((await loadWeek(daniel)).plan.items).toEqual([]);

    expect(await actOnWeek(tucker, { action: "done", id: mine.items[1].id, done: true })).toBeNull();
    expect(await actOnWeek(tucker, { action: "done", id: "nope", done: true })).toMatch(/no longer/);
    expect((await loadWeek(tucker)).plan.items.map((i) => i.done)).toEqual([false, true]);

    // Reopening keeps the list and what was ticked; confirming again keeps the ticks of the lines kept.
    expect(await actOnWeek(tucker, { action: "reopen" })).toBeNull();
    const open = (await loadWeek(tucker)).plan;
    expect(open.confirmedAt).toBeNull();
    expect(await actOnWeek(tucker, { action: "confirm", items: [{ id: open.items[1].id, text: open.items[1].text, href: "", own: true }] })).toBeNull();
    expect((await loadWeek(tucker)).plan.items.map((i) => [i.text, i.done])).toEqual([["Call the board chair", true]]);
  });

  it("answers the same when it joins Home's own read of the project, running at the same moment", async () => {
    const alone = await loadWeek(tucker);
    const [, , joined] = await Promise.all([loadHome("A-2027", tucker), nextReport("A-2027"), loadWeek(tucker)]);
    expect(joined).toEqual(alone);
  });

  it("refuses the same priority twice", async () => {
    const twice = { id: "approvals", text: "Decide the approvals", href: "/progress/review", own: false };
    expect(await actOnWeek(daniel, { action: "confirm", items: [twice, twice] })).toMatch(/twice/);
    expect((await loadWeek(daniel)).plan.items).toEqual([]);
  });
});
