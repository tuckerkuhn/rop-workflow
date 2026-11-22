import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { storyInputSchema } from "@/lib/stories";
import { userById } from "@/lib/demo";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { projectByCode } from "@/server/field-store";
import { updateProjectState } from "@/server/project-state";
import { storiesView, storyAction } from "@/server/stories-store";

/** Changes saved with the record locked (server/project-state updateProjectState). */
const code = "A-2027";
let projectId = "";

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  projectId = (await projectByCode(code)).id;
}, 120_000);

describe("saving with the record locked", { timeout: 60_000 }, () => {
  it("leaves nothing behind when the change is refused", async () => {
    const where = and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, "lock-test"));
    expect(await updateProjectState(projectId, "lock-test", { n: 0 }, async () => ({ data: null, result: "refused" }))).toBe("refused");
    expect(await db.select().from(s.projectState).where(where)).toHaveLength(0);
    await updateProjectState(projectId, "lock-test", { n: 0 }, async (c) => ({ data: { n: c.n + 1 }, result: null }));
    await Promise.all([1, 2, 3].map(() => updateProjectState(projectId, "lock-test", { n: 0 }, async (c) => ({ data: { n: c.n + 1 }, result: null }))));
    expect(((await db.select().from(s.projectState).where(where))[0].data as { n: number }).n).toBe(4);
  });

  it("keeps both stories when two people add one at the same moment", async () => {
    const mel = userById("omar")!;
    const before = (await storiesView(code, mel)).stories.length;
    const story = (notes: string) => storyInputSchema.parse({ title: "Field story", district: "Kama", province: "Nangarhar", notes, text: "", photos: [], links: [], consent: null });
    const out = await Promise.all([storyAction(code, mel, { action: "save", story: story("Planted the new saplings in October.") }), storyAction(code, mel, { action: "save", story: story("Sold the first harvest at the market.") })]);
    expect(out.every((o) => o.id && !o.error)).toBe(true);
    expect((await storiesView(code, mel)).stories.length).toBe(before + 2);
  });
});
