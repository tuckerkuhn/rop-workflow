import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Tests for the rules (src/lib/__tests__) and for whole flows against a database (src/server/__tests__,
 * an in-memory Postgres with the real migrations). None can reach Supabase or an outside service:
 * DATABASE_URL and the AI key are blanked, so anything that tries fails loudly.
 */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    env: { DATABASE_URL: "", ANTHROPIC_API_KEY: "", TZ: "UTC" },
  },
});
