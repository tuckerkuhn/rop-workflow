import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Use the direct (session) connection for migrations, not the pooler.
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!,
  },
});
