import { describe, expect, it } from "vitest";
import { early } from "@/server/early";
import { oncePerRequest, requestOnlyReads, withRequestMemo } from "@/server/request-memo";

describe("a request's short memory", () => {
  const counter = () => {
    let n = 0;
    return { read: async () => ++n, count: () => n };
  };

  it("reads every time outside a route", async () => {
    const c = counter();
    await oncePerRequest("k", c.read);
    await oncePerRequest("k", c.read);
    expect(c.count()).toBe(2);
  });

  it("reads every time in a request that may change something", async () => {
    const c = counter();
    await withRequestMemo(async () => {
      await oncePerRequest("k", c.read);
      await oncePerRequest("k", c.read);
    });
    expect(c.count()).toBe(2);
  });

  it("reads once per key in a read-only request, and again in the next request", async () => {
    const c = counter();
    const other = counter();
    const request = () =>
      withRequestMemo(async () => {
        requestOnlyReads();
        const [a, b] = await Promise.all([oncePerRequest("k", c.read), oncePerRequest("k", c.read)]);
        await oncePerRequest("other", other.read);
        return [a, b, await oncePerRequest("k", c.read)];
      });
    expect(await request()).toEqual([1, 1, 1]);
    expect(await request()).toEqual([2, 2, 2]);
    expect(other.count()).toBe(2);
  });

  it("does not keep a read that failed", async () => {
    let tries = 0;
    const flaky = async () => {
      if (++tries === 1) throw new Error("not yet");
      return "ok";
    };
    await withRequestMemo(async () => {
      requestOnlyReads();
      await expect(oncePerRequest("k", flaky)).rejects.toThrow("not yet");
      expect(await oncePerRequest("k", flaky)).toBe("ok");
    });
  });
});

describe("a read started early", () => {
  it("gives its result where it is awaited", async () => {
    const later = early(Promise.resolve(7));
    expect(await later).toBe(7);
  });
  it("still fails at the await when the read fails", async () => {
    const later = early(Promise.reject(new Error("no database")));
    await expect(later).rejects.toThrow("no database");
  });
  it("starts a query that only runs when awaited", async () => {
    let ran = false;
    const lazy: PromiseLike<number> = { then: (ok) => Promise.resolve().then(() => ((ran = true), ok!(3))) as never };
    const later = early(lazy);
    await Promise.resolve();
    await Promise.resolve();
    expect(ran).toBe(true);
    expect(await later).toBe(3);
  });
});
