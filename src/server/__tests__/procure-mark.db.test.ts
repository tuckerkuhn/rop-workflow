import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { PATCH } from "@/app/api/projects/[code]/budget/route";
import { seedDatabase } from "@/server/demo-seed";
import { loadBudget } from "@/server/plan-store";
import { projectByCode } from "@/server/field-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * Marking which budget lines are bought ("Procure") from the procurement calendar: no money moves,
 * so the project manager or procurement manager does it directly on a signed-off plan, logged.
 */
const code = "A-2027";
const mark = async (as: string, procure: Record<string, boolean>) => {
  const res = await PATCH(new Request(`http://test/api/projects/${code}/budget`, { method: "PATCH", headers: { "x-demo-user": as, "content-type": "application/json" }, body: JSON.stringify({ procure }) }), { params: Promise.resolve({ code }) });
  return { status: res.status, body: (await res.json()) as { error?: string; changed?: number } };
};

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("marking budget lines to buy", { timeout: 60_000 }, () => {
  it("lets the procurement manager and project manager mark a line, logged, and nobody else", async () => {
    const line = (await loadBudget(code)).lines.find((l) => !l.procure)!;
    expect((await mark("farida", { [line.code]: true })).status).toBe(403);

    const r = await mark("hamid", { [line.code]: true });
    expect(r).toMatchObject({ status: 200, body: { changed: 1 } });
    expect((await loadBudget(code)).lines.find((l) => l.code === line.code)!.procure).toBe(true);
    const project = await projectByCode(code);
    const logged = await db.select().from(s.auditLog).where(and(eq(s.auditLog.projectId, project.id), eq(s.auditLog.action, "budget_procure_marked")));
    expect(logged.at(-1)?.detail).toMatchObject({ lines: [{ code: line.code, procure: true }] });

    expect((await mark("nadia", { [line.code]: false })).body.changed).toBe(1);
    expect((await mark("nadia", { "NO-SUCH": true })).status).toBe(400);
  });
});
