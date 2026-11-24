import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { POST as ASK } from "@/app/api/projects/[code]/procurement-plan/ask/route";
import { POST as ACT } from "@/app/api/projects/[code]/procurement-plan/[key]/route";
import { addDays, leadFor, type PlanItem } from "@/lib/procurement-plan";
import { users } from "@/lib/demo";
import { realToday } from "@/lib/clock";
import { seedDatabase } from "@/server/demo-seed";
import { projectByCode } from "@/server/field-store";
import { loadBudget } from "@/server/plan-store";
import { loadPlan, rebuildPlan } from "@/server/procurement-plan-store";
import { ready } from "@/server/__tests__/test-db";

/** Asking for a purchase that is not on the procurement calendar, through the routes the screen calls. */
const code = "A-2027";
const post = async (url: string, as: string, body: unknown, handler: (req: Request, ctx: never) => Promise<Response>, params: Record<string, string>) => {
  const res = await handler(new Request(`http://test${url}`, { method: "POST", headers: { "x-demo-user": as, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve(params) } as never);
  return { status: res.status, body: (await res.json()) as { error?: string; item?: PlanItem } };
};
const ask = (as: string, body: unknown) => post(`/api/projects/${code}/procurement-plan/ask`, as, body, ASK as never, { code });
const act = (as: string, key: string, body: unknown) => post(`/api/projects/${code}/procurement-plan/${key}`, as, body, ACT as never, { code, key });

let budgetCode = "";
const input = () => ({ title: "Replacement water pump", budgetCode, value: 50, neededBy: addDays(realToday(), 120), reason: "The old pump broke and seedlings need water." });

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  budgetCode = (await loadBudget(code)).lines.find((l) => l.total - (l.spent ?? 0) > 100 && !!leadFor(l, users))!.code;
}, 120_000);

describe("asking for something not on the procurement calendar", { timeout: 60_000 }, () => {
  it("is refused to staff without procurement access or with view only", async () => {
    expect((await ask("farida", input())).status).toBe(403);
    expect((await ask("peter", input())).status).toBe(403);
  });

  it("needs a reason", async () => {
    const r = await ask("nadia", { ...input(), reason: "" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/why it was not planned/);
    expect((await loadPlan(code)).some((i) => i.unplanned)).toBe(false);
  });

  it("adds a draft marked as not planned, logged, that needs both approvals before a request starts", async () => {
    const r = await ask("nadia", input());
    expect(r.status).toBe(200);
    const item = r.body.item!;
    expect(item).toMatchObject({ key: "UP-001", status: "draft", budgetCode, unplanned: { by: "nadia", urgent: false } });
    expect((await loadPlan(code)).find((i) => i.key === "UP-001")).toMatchObject({ status: "draft" });

    const project = await projectByCode(code);
    const logged = await db.select().from(s.auditLog).where(and(eq(s.auditLog.projectId, project.id), eq(s.auditLog.action, "plan_asked_unplanned")));
    expect(logged.at(-1)?.detail).toMatchObject({ key: "UP-001", person: "nadia", reason: input().reason });

    // A second ask gets the next number.
    expect((await ask("zahra", { ...input(), urgent: true })).body.item).toMatchObject({ key: "UP-002", unplanned: { urgent: true } });

    const lead = item.techLead!;
    expect(lead).toBeTruthy();
    expect((await act(lead, "UP-001", { action: "start", procurementKey: "PR-2027-901" })).body.error).toBe("It needs both approvals before the request starts.");
    const manager = await act("hamid", "UP-001", { action: "approve", as: "manager" });
    expect(manager.body.error).toBeUndefined();
    expect((await act(lead, "UP-001", { action: "start", procurementKey: "PR-2027-901" })).status).toBe(403);
    expect((await act(lead, "UP-001", { action: "approve", as: "lead" })).body.item?.status).toBe("approved");
    expect((await act(lead, "UP-001", { action: "start", procurementKey: "PR-2027-901" })).body.item).toMatchObject({ status: "started", procurementKey: "PR-2027-901" });

    // Rebuilding the calendar from the budget leaves asked-for items alone.
    await rebuildPlan(code);
    const after = await loadPlan(code);
    expect(after.find((i) => i.key === "UP-001")).toMatchObject({ status: "started", unplanned: { by: "nadia" } });
    expect(after.find((i) => i.key === "UP-002")).toMatchObject({ status: "draft" });
  });
});
