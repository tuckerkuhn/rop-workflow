import { NextResponse } from "next/server";
import { cronAllowed, handle } from "@/server/guard";
import { reconcileAll } from "@/server/kobo-reconcile";

// Every connected project is synced in turn: allow the time it takes.
export const maxDuration = 300;

/**
 * The nightly KoboToolbox reconcile, called by the Vercel cron (vercel.json) with CRON_SECRET.
 * Catches edits and deletions made in KoboToolbox after the webhook fired. Without the secret set
 * on the server it refuses to run at all.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const refused = cronAllowed(req.headers.get("authorization"), process.env.CRON_SECRET);
    if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status });
    const runs = await reconcileAll();
    return NextResponse.json({ projects: runs.length, failed: runs.filter((r) => !r.ok).length, runs });
  }, "kobo-reconcile");
}
