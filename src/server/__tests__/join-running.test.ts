import { describe, expect, it, vi } from "vitest";

// next-report reaches the database through its imports; these tests use only the join itself.
vi.mock("@/db", () => ({ db: {}, schema: {} }));

import { joinRunning, shareRunning } from "@/server/next-report";

describe("joining a read already under way", () => {
  it("takes a copy of the running read's answer instead of reading again", async () => {
    let reads = 0;
    const first = shareRunning("join:copy", async () => ({ n: ++reads, list: [1, 2] }));
    const joined = await joinRunning("join:copy", async () => ({ n: ++reads, list: [] as number[] }));
    const own = await first;
    expect(reads).toBe(1);
    expect(joined).toEqual(own);
    expect(joined).not.toBe(own);
  });

  it("reads for itself when the running answer cannot be copied, never giving nothing", async () => {
    const first = shareRunning("join:uncloneable", async () => ({ n: 1, f: () => 1 }));
    const joined = await joinRunning("join:uncloneable", async () => ({ n: 2, f: () => 2 }));
    expect(joined.n).toBe(2);
    expect((await first).n).toBe(1);
  });

  it("reads for itself when the running read fails", async () => {
    const first = shareRunning<{ n: number }>("join:failed", async () => {
      throw new Error("down");
    });
    first.catch(() => undefined);
    expect(await joinRunning("join:failed", async () => ({ n: 3 }))).toEqual({ n: 3 });
  });

  it("reads for itself when nothing is running", async () => {
    expect(await joinRunning("join:none", async () => 7)).toBe(7);
  });
});
