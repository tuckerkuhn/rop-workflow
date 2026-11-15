import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as tables from "@/db/schema";

/**
 * A real Postgres for tests, in memory (PGlite), with every migration in drizzle/ applied. Nothing
 * here can reach Supabase: a test file swaps the app's database for this one with
 *
 *   vi.mock("@/db", () => import("@/server/__tests__/test-db"));
 *
 * and waits for `ready` before its first query. Each test file gets its own empty database.
 */
const client = new PGlite();

export const ready: Promise<void> = (async () => {
  // Supabase has these roles; the migrations grant to them.
  await client.exec("create role anon; create role authenticated; create role service_role;");
  const dir = path.resolve(import.meta.dirname, "../../../drizzle");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of fs.readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) {
      if (!statement.trim()) continue;
      try {
        await client.exec(statement);
      } catch (e) {
        throw new Error(`Migration ${file} failed in the test database: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
})();

export const schema = { ...tables };
export const db = drizzle(client, { schema });
