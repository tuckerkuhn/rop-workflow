import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;
// Kept on globalThis so a code reload in development reuses the pool instead of opening another.
const g = globalThis as unknown as { __ropDb?: DB };
let instance: DB | null = g.__ropDb ?? null;

/**
 * Connects on first use, so a missing or placeholder DATABASE_URL becomes a readable error
 * from the route that needed the database instead of a crash when the module loads.
 */
function connect(): DB {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (!url || url.includes("<")) throw new Error("DATABASE_URL in .env.local is not set to a real Supabase connection string.");
  // `prepare: false` is required for Supabase's transaction pooler (port 6543),
  // which is what serverless functions on Vercel should connect through.
  //
  // The database allows 200 connections across everything that uses it (the live site, previews,
  // laptops, scripts). Each server instance keeps a small pool and lets idle connections go, so
  // many instances at once cannot use them all up.
  instance = drizzle(postgres(url, { prepare: false, max: process.env.VERCEL ? 3 : 5, idle_timeout: 20, connect_timeout: 15 }), { schema });
  g.__ropDb = instance;
  return instance;
}

export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const real = connect();
    const value = Reflect.get(real, prop);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
export { schema };
