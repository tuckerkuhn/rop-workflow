import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Tests for the pure logic that decides what a donor sees. They never touch the database or an
 * outside service: DATABASE_URL and the AI key are blanked, so anything that tries fails loudly.
 */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    env: { DATABASE_URL: "", ANTHROPIC_API_KEY: "", TZ: "UTC" },
  },
});
