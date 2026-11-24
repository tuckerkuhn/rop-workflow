import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { fillSampleBook, forgetKeptHr, loadHr, resetSample } from "@/server/hr-store";
import { db, ready, schema as s } from "@/server/__tests__/test-db";
import { eq, sql } from "drizzle-orm";

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

  /**
   * Two servers do not share the in-process wait above: each fills through fillSampleBook, which
   * takes the book's lock and looks again inside one transaction. Called here side by side, as two
   * servers would, it still writes the sample once. (The in-memory Postgres has one connection, so
   * the second transaction runs once the first has ended rather than waiting on the lock; on Supabase
   * the lock is what makes it wait. Either way it finds the book full and writes nothing.)
   */
  it("is written once when two servers fill an empty book at the same moment", async () => {
    await db.delete(s.hrLedger).where(eq(s.hrLedger.book, "demo"));
    await Promise.all([fillSampleBook("demo"), fillSampleBook("demo"), fillSampleBook("demo", true)]);
    const starts = await db.select({ n: s.hrLedger.n }).from(s.hrLedger).where(eq(s.hrLedger.kind, "start"));
    expect(starts.length).toBe(1);
    forgetKeptHr();
    expect((await loadHr()).integrity.ok).toBe(true);
    // A full book is left as it is.
    const before = (await loadHr()).entries.length;
    await fillSampleBook("demo");
    forgetKeptHr();
    expect((await loadHr()).entries.length).toBe(before);
  });

  it("takes the book's lock inside the fill (the in-memory Postgres has advisory locks)", async () => {
    const got = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('hr_ledger:demo'))`);
      const r = (await tx.execute(sql`select count(*)::int as n from pg_locks where locktype = 'advisory'`)) as unknown as { rows: { n: number }[] };
      return r.rows[0].n;
    });
    expect(got).toBeGreaterThan(0);
  });
});
