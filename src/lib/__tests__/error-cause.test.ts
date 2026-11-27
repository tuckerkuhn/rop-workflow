import { describe, expect, it } from "vitest";
import { causeOf, plainCause } from "@/lib/error-cause";

/** Review round 1, ISS-09: the health page says why a read failed, not only which one. */
describe("the reason under a failed query", () => {
  const wrapped = (cause: unknown) => Object.assign(new Error("Failed query: select * from projects\nparams: A-2027,1"), { cause });

  it("is read from the error's cause, with its code", () => {
    const e = wrapped(Object.assign(new Error("write CONNECT_TIMEOUT aws-0.pooler.supabase.com:5432"), { code: "CONNECT_TIMEOUT" }));
    expect(causeOf(e)).toBe("CONNECT_TIMEOUT: write CONNECT_TIMEOUT aws-0.pooler.supabase.com:5432");
    expect(plainCause(causeOf(e))).toBe("The database did not answer in time.");
  });

  it("follows a chain of causes and stops", () => {
    const inner = Object.assign(new Error("max clients reached"), { code: "XX000" });
    expect(causeOf(wrapped(Object.assign(new Error("connection refused by pooler"), { cause: inner })))).toBe("connection refused by pooler < XX000: max clients reached");
    const loop: { message: string; cause?: unknown } = { message: "again" };
    loop.cause = loop;
    expect(causeOf({ cause: loop })).toBe("again");
  });

  it("is null when there is no cause, and is kept short", () => {
    expect(causeOf(new Error("plain"))).toBeNull();
    expect(causeOf("text")).toBeNull();
    expect(causeOf(wrapped(new Error("x".repeat(900))))!.length).toBe(400);
  });

  it("names the connection faults in plain words and nothing else", () => {
    expect(plainCause("XX000: max clients reached - in Session mode max clients are limited to pool_size")).toContain("every connection it allows");
    expect(plainCause("53300: remaining connection slots are reserved")).toContain("every connection it allows");
    expect(plainCause("ECONNRESET: read ECONNRESET")).toContain("dropped");
    expect(plainCause("ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:5432")).toContain("could not reach");
    expect(plainCause("23505: duplicate key value violates unique constraint")).toBeNull();
    expect(plainCause(null)).toBeNull();
  });
});
