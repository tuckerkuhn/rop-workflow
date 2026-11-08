import { NextResponse } from "next/server";

/** Turns database and network failures into a readable JSON error. */
export async function handle(fn: () => Promise<Response>, where = "api"): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = !msg.startsWith("DATABASE_URL") && /ENOTFOUND|ECONNREFUSED|password authentication|getaddrinfo|relation .* does not exist/i.test(msg)
      ? " Check DATABASE_URL in .env.local and that the migration has run."
      : "";
    console.error(e);
    // Kept for the administrators' health page (Settings → Health).
    await (await import("@/server/limits")).recordError(where, e);
    return NextResponse.json({ error: `${msg}${hint}` }, { status: 500 });
  }
}
