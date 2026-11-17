import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { NEW_PROJECT, userById } from "@/lib/demo";
import { KOBO_APPROVAL_KEY } from "@/lib/kobo-approval";
import { FIELD_SETUP_KEY } from "@/lib/package";
import { resetNewProject, seedDatabase } from "@/server/demo-seed";
import { projectByCode, projectsWithField, setupFor } from "@/server/field-store";
import { koboApprovalFor } from "@/server/kobo-approval";
import { listProjects } from "@/server/project-store";
import { copySetup, templateSources } from "@/server/project-template";
import { ready } from "@/server/__tests__/test-db";

/** The demo's two projects: one running, one just won and set up from the first in one step. */
const nadia = userById("nadia")!;
const fresh = NEW_PROJECT.id;
const state = async (code: string, key: string) => {
  const p = await projectByCode(code);
  return (await db.select().from(s.projectState).where(and(eq(s.projectState.projectId, p.id), eq(s.projectState.key, key))))[0]?.data as Record<string, unknown> | undefined;
};
const targets = async (code: string) => db.select().from(s.indicators).where(eq(s.indicators.projectId, (await projectByCode(code)).id));

beforeAll(async () => {
  await ready;
  await seedDatabase();
}, 120_000);

describe("the two demo projects", { timeout: 60_000 }, () => {
  it("seeds the finished project as running, with the Director of MEL named for KoboCollect data", async () => {
    const all = await listProjects({ all: true });
    expect(all.find((p) => p.code === "A-2027")).toMatchObject({ stage: "Execute", kind: "real" });
    expect(await koboApprovalFor("A-2027")).toEqual({ who: "named", person: "rahima", standIn: "omar" });
  });
  it("seeds the just-won project with nothing set up, as a sandbox left out of totals", async () => {
    const all = await listProjects({ all: true });
    expect(all.find((p) => p.code === fresh)).toMatchObject({ stage: "Design", kind: "sandbox", country: "GT" });
    expect((await listProjects()).some((p) => p.code === fresh)).toBe(false);
    expect(await setupFor(fresh)).toBeNull();
    expect(await targets(fresh)).toHaveLength(0);
    expect((await projectsWithField()).has(fresh)).toBe(false);
  });
});

describe("starting the new project from the running one", { timeout: 60_000 }, () => {
  it("offers the running project as the place to start from", async () => {
    expect((await templateSources(nadia, fresh)).map((p) => p.code)).toEqual(["A-2027"]);
    expect(await templateSources(nadia, "A-2027")).toEqual([]);
  });
  it("copies the package as a draft, the approver and the targets in one step", async () => {
    const r = await copySetup("A-2027", fresh, nadia);
    expect(r).toMatchObject({ from: "A-2027", package: true, approval: true });
    expect(r.targets).toBe((await targets("A-2027")).length);
    expect(r.notes).toHaveLength(3);
    // A draft does not switch Field activities on: the manager checks it against the new budget first.
    expect(await setupFor(fresh)).toBeNull();
    const draft = await state(fresh, FIELD_SETUP_KEY);
    expect(draft).toMatchObject({ draft: true, from: "A-2027", target: "IND-2" });
    expect((draft!.items as { key: string }[]).map((i) => i.key)).toEqual(["seed", "npk"]);
    expect(draft!.windowEnd).toBeUndefined();
    expect(await state(fresh, KOBO_APPROVAL_KEY)).toEqual({ who: "named", person: "rahima", standIn: "omar" });
    // Every copied target takes recorded results until this project links its own forms.
    expect((await targets(fresh)).every((t) => t.source === "results")).toBe(true);
    const [log] = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "setup_copied"));
    expect(log.detail).toMatchObject({ from: "A-2027", package: true, approval: true });
  });
  it("changes nothing the second time, and never touches the project copied from", async () => {
    const before = await targets("A-2027");
    const again = await copySetup("A-2027", fresh, nadia);
    expect(again).toMatchObject({ approval: false, targets: 0 });
    expect(again.notes.join(" ")).toMatch(/already has targets/);
    expect(await targets("A-2027")).toEqual(before);
    expect((await targets(fresh)).length).toBe(before.length);
  });
  it("refuses a project with no package, and a project copied from itself", async () => {
    const refusal = async (f: () => Promise<unknown>) => f().then(() => "", (e: Error) => e.message);
    expect(await refusal(() => copySetup(fresh, fresh, nadia))).toMatch(/different project/);
    await resetNewProject((await projectByCode(fresh)).organizationId!);
    expect(await refusal(() => copySetup(fresh, "A-2027", nadia))).toMatch(/no input package to start from/);
  });
  it("goes back to nothing set up when the demo is reset", async () => {
    expect(await state(fresh, FIELD_SETUP_KEY)).toBeUndefined();
    expect(await targets(fresh)).toHaveLength(0);
  });
});
