import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq, like } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { POST } from "@/app/api/projects/[code]/qpr/route";
import { seedDatabase } from "@/server/demo-seed";
import { projectByCode } from "@/server/field-store";
import { preflight } from "@/server/preflight";
import { loadQpr, saveQpr } from "@/server/qpr-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * Decision Y, 25 Nov 2026: an empty Executive Summary blocks a quarterly report's release. Any
 * other empty section still only warns.
 */
const code = "A-2027";
const quarter = "2026-Q4";
const check = async () => (await preflight(code, { kind: "qpr", quarter })).items;
const release = async () => {
  const res = await POST(new Request(`http://test/api/projects/${code}/qpr?q=${quarter}`, { method: "POST", headers: { "x-demo-user": "marcus", "content-type": "application/json" }, body: JSON.stringify({ action: "release" }) }), { params: Promise.resolve({ code }) });
  return { status: res.status, body: (await res.json()) as { error?: string } };
};

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  const projectId = (await projectByCode(code)).id;
  // Start from a report with nothing written and nothing released.
  await db.delete(s.projectState).where(and(eq(s.projectState.projectId, projectId), like(s.projectState.key, "qpr%")));
}, 120_000);

describe("a quarterly report with no Executive Summary", { timeout: 60_000 }, () => {
  it("is blocked by the report check, which says where to write it", async () => {
    const items = await check();
    const stop = items.find((i) => i.key === "pf.c.noSummary");
    expect(stop).toMatchObject({ group: "blocks", owner: "writers", text: "The Executive Summary is not written. The report cannot be released without it" });
    expect(stop?.href).toBe(`/progress/report?q=${quarter}#sec-summary`);
    // The other empty sections are listed once, as worth fixing, and the summary is not among them.
    const rest = items.find((i) => i.key === "pf.c.empty");
    expect(rest?.group).toBe("fix");
    expect(rest?.text).not.toContain("Executive Summary");
  });

  it("cannot be released, and the refusal names the summary", async () => {
    const r = await release();
    expect(r.status).toBe(409);
    expect(r.body.error).toContain("The Executive Summary is not written");
    expect((await loadQpr(code, quarter)).released).toBeFalsy();
  });

  it("is no longer blocked by it once the summary is written, while other empty sections still only warn", async () => {
    const saved = await loadQpr(code, quarter);
    await saveQpr(code, quarter, { ...saved, sections: { ...saved.sections, summary: { text: "Eight farmers were trained in land preparation this quarter (fictional)." } } });
    const items = await check();
    expect(items.find((i) => i.key === "pf.c.noSummary")).toBeUndefined();
    expect(items.find((i) => i.key === "pf.c.empty")?.group).toBe("fix");
    // Whatever else may block it, the summary does not, and an empty section never does.
    const r = await release();
    expect(r.body.error ?? "").not.toContain("Executive Summary");
    expect(r.body.error ?? "").not.toContain("not written yet");
  });
});
