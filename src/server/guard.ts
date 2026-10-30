import { NextResponse } from "next/server";
import { userById, type AppUser } from "@/lib/demo";

/**
 * Sign-in is still the demo picker, so write routes would be open on a deployed site.
 * They run locally and in development, and in production only when ALLOW_DEMO_WRITES=1.
 */
export function writesBlocked() {
  if (process.env.NODE_ENV !== "production" || process.env.ALLOW_DEMO_WRITES === "1") return null;
  return NextResponse.json({ error: "Writes are disabled on this deployment until real sign-in exists (set ALLOW_DEMO_WRITES=1 to override)." }, { status: 403 });
}

/** The demo user the browser says it is. Not proof of identity until real sign-in exists. */
export function demoUser(req: Request): AppUser | undefined {
  const id = req.headers.get("x-demo-user");
  return id ? userById(id) : undefined;
}

/** Turns database and network failures into a readable JSON error. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = !msg.startsWith("DATABASE_URL") && /ENOTFOUND|ECONNREFUSED|password authentication|getaddrinfo|relation .* does not exist/i.test(msg)
      ? " Check DATABASE_URL in .env.local and that the migration has run."
      : "";
    console.error(e);
    return NextResponse.json({ error: `${msg}${hint}` }, { status: 500 });
  }
}
