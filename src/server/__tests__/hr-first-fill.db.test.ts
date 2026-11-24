import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { forgetKeptHr, loadHr, resetSample } from "@/server/hr-store";
import { db, ready, schema as s } from "@/server/__tests__/test-db";
import { eq } from "drizzle-orm";

beforeAll(async () => {
  await ready;
}, 120_000);

/**
 * The sample HR book fills itself on first use. Home, the session, the week ahead and the HR card
 * all read it at once when a page opens: on an empty book each saw it empty and filled it again,
 * so the sample people were hired several times over.
 */
describe("the sample HR book's first fill", { timeout: 60_000 }, () => {
  it("is written once when several reads find it empty at the same moment", async () => {
    forgetKeptHr();
    const books = await Promise.all([loadHr(), loadHr(), loadHr()]);
    const starts = await db.select({ n: s.hrLedger.n }).from(s.hrLedger).where(eq(s.hrLedger.kind, "start"));
    expect(starts.length).toBe(1);
    // Every reader sees the same, whole book.
    for (const b of books) expect(b.entries.length).toBe(books[0].entries.length);
    expect(books[0].integrity.ok).toBe(true);
  });

  it("is written once when a read finds the book empty during a reset", async () => {
    forgetKeptHr();
    const [, during] = await Promise.all([resetSample(), loadHr()]);
    const starts = await db.select({ n: s.hrLedger.n }).from(s.hrLedger).where(eq(s.hrLedger.kind, "start"));
    expect(starts.length).toBe(1);
    expect(during.integrity.ok).toBe(true);
  });
});
