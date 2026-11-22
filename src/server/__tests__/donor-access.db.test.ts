import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { NextResponse } from "next/server";
import { ready } from "@/server/__tests__/test-db";
import { fundedBy, requireViewer } from "@/server/auth";
import { seedDatabase } from "@/server/demo-seed";
import { listProjects } from "@/server/project-store";

/** A donor opens only the projects their organization funds (server/auth requireViewer). */
const ask = (code: string) => requireViewer(new Request(`http://test/api/projects/${code}/progress`, { headers: { "x-demo-user": "elena" } }));

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("a donor's projects", { timeout: 60_000 }, () => {
  it("opens the project the foundation funds, and no other", async () => {
    const funded = await fundedBy("Demo Foundation (fictional)");
    expect(funded.has("A-2027")).toBe(true);
    expect(await ask("A-2027")).not.toBeInstanceOf(NextResponse);
    const other = (await listProjects({ all: true })).find((p) => !funded.has(p.code));
    expect(other).toBeTruthy();
    const res = await ask(other!.code);
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(404);
  });
});
