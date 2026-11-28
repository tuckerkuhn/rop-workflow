import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { FIELD_SETUP_KEY } from "@/lib/package";
import type { Qpr } from "@/lib/qpr";
import { seedDatabase } from "@/server/demo-seed";
import { fieldItemRows, listDistributions, stockFor } from "@/server/distribution";
import { loadField, projectByCode, projectsWithField, setupFor } from "@/server/field-store";
import { loadHome } from "@/server/home-store";
import { koboApprovalFor, saveKoboApproval } from "@/server/kobo-approval";
import { loadProjectState, loadProjectStates, saveProjectState } from "@/server/project-state";
import { rawQpr, rawQprReleased } from "@/server/qpr-store";
import { requestOnlyReads, withRequestMemo } from "@/server/request-memo";
import { ready } from "@/server/__tests__/test-db";

/**
 * Home's reads in one read-only request: each project_state document, the purchases, the
 * distributions and the field records are read once and shared, and nothing written during the
 * request is answered from before the write.
 */
const code = "A-2027";
const nadia = userById("nadia")!;
let projectId = "";

const readOnly = <T,>(read: () => Promise<T>) =>
  withRequestMemo(async () => {
    requestOnlyReads();
    return read();
  });
const plain = <T,>(v: T) => JSON.parse(JSON.stringify(v)) as T;

/** The SQL sent while `run` runs. */
async function queries(run: () => Promise<unknown>): Promise<string[]> {
  const client = (db as unknown as { $client: { query: (...a: unknown[]) => unknown } }).$client;
  const spy = vi.spyOn(client, "query");
  try {
    await run();
    return spy.mock.calls.map(([q]) => String(typeof q === "object" && q && "text" in q ? (q as { text: string }).text : q));
  } finally {
    spy.mockRestore();
  }
}

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  projectId = (await projectByCode(code)).id;
}, 120_000);

describe("project_state in a read-only request", { timeout: 60_000 }, () => {
  it("reads one document once, and the package with its crop plan in one query", async () => {
    const sent = await queries(() =>
      readOnly(async () => {
        await koboApprovalFor(code);
        await koboApprovalFor(code);
        await setupFor(code);
        await setupFor(code);
      }),
    );
    expect(sent.filter((q) => /from "project_state"/.test(q))).toHaveLength(2);
  });

  it("reads afresh after a write in the same request", async () => {
    const before = await koboApprovalFor(code);
    const after = await readOnly(async () => {
      await koboApprovalFor(code);
      await saveKoboApproval(code, { ...before, accounts: { ...before.accounts, "memo.kobo": "farida" } });
      return koboApprovalFor(code);
    });
    expect(after.accounts?.["memo.kobo"]).toBe("farida");
    await saveKoboApproval(code, before);
  });

  it("gives several documents read together the same as each read alone, and keeps none read inside a transaction", async () => {
    await saveProjectState(projectId, "memo-a", { n: 1 });
    const alone = { a: await loadProjectState(projectId, "memo-a", { n: 0, m: 2 }), b: await loadProjectState(projectId, "memo-b", null) };
    const together = await readOnly(() => loadProjectStates(projectId, { "memo-a": { n: 0, m: 2 }, "memo-b": null }));
    expect(together).toEqual({ "memo-a": alone.a, "memo-b": alone.b });
    const inTx = await db.transaction((tx) => loadProjectStates(projectId, { "memo-a": { n: 0 } }, tx));
    expect(inTx).toEqual({ "memo-a": { n: 1 } });
  });
});

describe("Home and the distribution list in a read-only request", { timeout: 120_000 }, () => {
  it("lists a distribution that has just arrived with its checks, though its record was read before they were written", async () => {
    const project = await projectByCode(code);
    const someone = (await loadField(code, nadia)).items.find((i) => i.kind === "farmer") as Farmer;
    const [row] = await db
      .insert(s.evidence)
      .values({ organizationId: project.organizationId, projectId, source: "kobo", form: "distribution", farmerCode: someone.id, reviewStatus: "pending", completedBy: "memo.kobo", completedAt: new Date(), koboAssetUid: "aMemoDist", koboSubmissionUuid: "kobo-memo-1", koboSubmissionId: 9901, payload: { seed_given: "yes", seed_qty: "1", signed: "yes" } })
      .returning({ id: s.evidence.id });
    const { listed, stock } = await readOnly(async () => {
      // Keeps the distributions and their checks as they were before the new one got its checks.
      await stockFor(code).catch(() => null);
      return { listed: await listDistributions(code), stock: await stockFor(code).catch(() => null) };
    });
    expect(listed.some((d) => d.id === row.id)).toBe(true);
    expect(plain(listed)).toEqual(plain(await listDistributions(code)));
    expect(plain(stock)).toEqual(plain(await stockFor(code).catch(() => null)));
  });

  it("gives Home the same answer", async () => {
    const alone = await loadHome(code, nadia);
    expect(plain(await readOnly(() => loadHome(code, nadia)))).toEqual(plain(alone));
  });

  it("shares the list's reads with the store's stock and the field records (Home's tail)", async () => {
    await listDistributions(code);
    const sent = await queries(() =>
      readOnly(async () => {
        await listDistributions(code);
        await stockFor(code).catch(() => null);
        await fieldItemRows(projectId);
      }),
    );
    expect(sent.filter((q) => /from "field_items"/.test(q))).toHaveLength(1);
    expect(sent.filter((q) => /from "procurements"/.test(q))).toHaveLength(1);
    expect(sent.filter((q) => /from "evidence"/.test(q))).toHaveLength(2);
  });

});

describe("what is read without the whole document", { timeout: 60_000 }, () => {
  it("names a project with an input package that is not a draft", async () => {
    const other = (await db.select().from(s.projects)).find((p) => p.code && p.code !== code && p.id !== projectId)!;
    const has = async () => (await projectsWithField()).has(other.code!);
    const item = { key: "seed", item: "Seed", unit: "kg", qty: 1, per: "farmer", budgetLine: "1.1" };
    await saveProjectState(other.id, FIELD_SETUP_KEY, { items: [item], draft: true });
    expect(await has()).toBe(false);
    await saveProjectState(other.id, FIELD_SETUP_KEY, { items: [] });
    expect(await has()).toBe(false);
    await saveProjectState(other.id, FIELD_SETUP_KEY, { items: [item], draft: false });
    expect(await has()).toBe(true);
    await db.delete(s.projectState).where(eq(s.projectState.projectId, other.id));
    expect(await has()).toBe(false);
    expect((await projectsWithField()).has(code)).toBe(true);
  });

  it("says which quarters' reports were released as reading each whole report does", async () => {
    const released: Qpr["released"] = { by: "tucker", at: "2026-10-05T10:00:00.000Z" };
    await saveProjectState(projectId, "qpr:2025-Q3", { sections: {}, released });
    await saveProjectState(projectId, "qpr:2025-Q4", { sections: {} });
    const quarters = ["2025-Q3", "2025-Q4", "1999-Q1"];
    const got = await rawQprReleased(projectId, quarters);
    for (const q of quarters) expect(got.get(q) ?? null).toEqual((await rawQpr(projectId, q))?.released ?? null);
    expect(got.get("2025-Q3")).toEqual(released);
    expect((await rawQprReleased(projectId, [])).size).toBe(0);
  });
});
