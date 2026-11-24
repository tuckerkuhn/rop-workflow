import { describe, expect, it } from "vitest";
import { poolMax, sessionMode } from "@/db";

/** The app reaches Supabase through the session pooler (src/db/index.ts): fictional addresses only. */
describe("the database address", () => {
  const tx = "postgresql://postgres.abc:fictional-secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres";
  it("moves Supabase's transaction port to the session port, keeping everything else", () => {
    expect(sessionMode(tx, undefined)).toBe("postgresql://postgres.abc:fictional-secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres");
  });
  it("leaves other addresses alone, and keeps the transaction port when asked", () => {
    expect(sessionMode(tx, "transaction")).toBe(tx);
    expect(sessionMode("postgresql://u:p@localhost:5432/db", undefined)).toBe("postgresql://u:p@localhost:5432/db");
    expect(sessionMode("postgresql://u:p@db.example.com:6543/db", undefined)).toBe("postgresql://u:p@db.example.com:6543/db");
    expect(sessionMode("not a url", undefined)).toBe("not a url");
  });
  it("keeps each instance's pool small: the session pooler's 15 are shared by every instance and laptop", () => {
    expect(poolMax({ VERCEL: "1" })).toBe(2);
    expect(poolMax({})).toBe(3);
    expect(poolMax({ DB_POOL_MAX: "5" })).toBe(5);
    expect(poolMax({ DB_POOL_MAX: "500" })).toBe(3);
  });
});
