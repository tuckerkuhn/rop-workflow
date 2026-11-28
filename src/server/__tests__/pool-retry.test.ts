import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/limits", () => ({ recordError: vi.fn(async () => undefined) }));

import { NextResponse } from "next/server";
import { handle } from "@/server/guard";
import { requestOnlyReads, requestWrote } from "@/server/request-memo";

/** Part 4: a read refused because the database pooler is full waits and tries again; a write never runs twice. */
const full = () => Object.assign(new Error("Failed query: select 1"), { cause: { message: "(EMAXCONNSESSION) max clients reached in session mode" } });

describe("when every database connection is in use", () => {
  it("a read-only request is tried again and succeeds", async () => {
    let tries = 0;
    const res = await handle(async () => {
      requestOnlyReads();
      if (++tries < 2) throw full();
      return NextResponse.json({ ok: true });
    });
    expect(tries).toBe(2);
    expect(res.status).toBe(200);
  });

  it("a request that wrote is not run again, and gives up after two retries", async () => {
    let writes = 0;
    const wrote = await handle(async () => {
      requestOnlyReads();
      requestWrote();
      writes++;
      throw full();
    });
    expect(writes).toBe(1);
    expect(wrote.status).toBe(500);
    let reads = 0;
    const gaveUp = await handle(async () => {
      requestOnlyReads();
      reads++;
      throw full();
    });
    expect(reads).toBe(3);
    expect(gaveUp.status).toBe(500);
  });
});
