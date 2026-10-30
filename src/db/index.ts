import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;
let instance: DB | null = null;

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
  instance = drizzle(postgres(url, { prepare: false }), { schema });
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
