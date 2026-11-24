import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { append, forgetKeptHr, loadHr, resetSample } from "@/server/hr-store";
import { db, ready } from "@/server/__tests__/test-db";

beforeAll(async () => {
  await ready;
}, 120_000);

/** The folded HR book is kept between requests, and read again as soon as the book changes. */
describe("the kept HR book", { timeout: 60_000 }, () => {
  it("reuses the fold while the book is unchanged, and sees an append, a reset and nothing a caller changed", async () => {
    forgetKeptHr();
    const full = vi.spyOn(db, "execute");
    const first = await loadHr();
    expect(first.entries.length).toBeGreaterThan(0);
    expect(first.integrity.ok).toBe(true);
    const readsAfterFirst = full.mock.calls.length;

    // Unchanged book: no full read, the same answer.
    const again = await loadHr();
    expect(full.mock.calls.length).toBe(readsAfterFirst);
    expect(again.entries.length).toBe(first.entries.length);

    // A caller that changes what it was given changes nothing for the next one.
    again.entries.length = 0;
    (again.state as { people: unknown }).people = {};
    const third = await loadHr();
    expect(third.entries.length).toBe(first.entries.length);
    expect(Object.keys(third.state.people).length).toBe(Object.keys(first.state.people).length);

    // An append is seen at once.
    const n = await append("test", "note", null, { text: "kept?" });
    const afterAppend = await loadHr();
    expect(full.mock.calls.length).toBeGreaterThan(readsAfterFirst);
    expect(afterAppend.entries.at(-1)?.n).toBe(n);
    expect(afterAppend.entries.length).toBe(first.entries.length + 1);
    expect(afterAppend.integrity.ok).toBe(true);

    // A reset of the sample book is seen at once (the last entry's fingerprint changes).
    await resetSample();
    const afterReset = await loadHr();
    expect(afterReset.entries.length).toBe(first.entries.length);
    expect(afterReset.entries.at(-1)?.hash).not.toBe(afterAppend.entries.at(-1)?.hash);
    full.mockRestore();
  });
});
