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
  // many instances at once cannot use them all up. A laptop or a script gets 10: a screen makes a
  // dozen requests at once, and far from the database each query is a slow round trip.
  // On Vercel, 6: one instance serves several requests at once (Fluid compute) and each request now
  // reads side by side, so 3 queued queries behind each other. Through the transaction pooler
  // (port 6543, as DATABASE_URL is set up) a connection is held only for the length of a query,
  // and 6 per instance still leaves room for some 30 busy instances before the 200 are used.
  //
  // SESSION MODE, on purpose (24 Nov 2026). Supabase's transaction pooler (port 6543) was seen to lose
  // the reply to a query when several requests read at once: the page then waited for ever. With
  // prepare: false the driver sends each query with parameters in two steps, and the pooler can hand
  // the second step to another database connection. The session pooler (same host, port 5432) keeps
  // one database connection per client connection, so it cannot. The price: each open connection
  // holds one of the project's pooled database connections, and the session pooler allows only its
  // pool size (15 on this project) for everything at once: the live site, previews, laptops and
  // scripts. Over it, a new connection is refused at once ("max clients reached"). So a Vercel
  // instance keeps at most 2 and a laptop or script 5 (a page's four requests side by side queued
  // to 9 seconds on 3), and both let an idle one go after 5 seconds:
  // a screen's dozen reads queue behind each other for a moment instead of failing.
  // DB_POOL_MODE=transaction keeps the address as it is; DB_POOL_MAX sets the size.
  const target = sessionMode(url);
  instance = drizzle(postgres(target, { prepare: false, max: poolMax(), idle_timeout: 5, connect_timeout: 15 }), { schema });
  g.__ropDb = instance;
  return instance;
}

/** Connections one server instance may hold: few, because the session pooler's limit is shared by all of them. */
export function poolMax(env: Record<string, string | undefined> = process.env): number {
  const set = Number(env.DB_POOL_MAX);
  if (Number.isInteger(set) && set >= 1 && set <= 20) return set;
  return env.VERCEL ? 2 : 5;
}

/** The Supabase pooler address on its session port (5432) instead of its transaction port (6543). */
export function sessionMode(url: string, mode = process.env.DB_POOL_MODE): string {
  if (mode === "transaction") return url;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith(".pooler.supabase.com") && u.port === "6543") {
      u.port = "5432";
      return u.toString();
    }
  } catch {
    // Not a URL the parser reads: leave it exactly as given.
  }
  return url;
}

export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const real = connect();
    const value = Reflect.get(real, prop);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
export { schema };
