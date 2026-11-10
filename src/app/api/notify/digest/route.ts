import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handle } from "@/server/guard";
import { runDigest } from "@/server/notify-store";

// Every person's projects are read in turn: allow the time it takes.
export const maxDuration = 300;

/** The daily email, called by the Vercel cron (vercel.json) with CRON_SECRET. ?dry=1 sends nothing. */
export async function GET(req: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) return NextResponse.json({ error: "Set CRON_SECRET to turn on the daily email." }, { status: 503 });
    const got = Buffer.from(req.headers.get("authorization") ?? "");
    const want = Buffer.from(`Bearer ${secret}`);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
    const url = new URL(req.url);
    const dry = url.searchParams.get("dry") === "1";
    if (!dry && !process.env.RESEND_API_KEY) return NextResponse.json({ error: "Set RESEND_API_KEY to send the daily email." }, { status: 503 });
    // On a plan that allows only two scheduled jobs, the KoboToolbox reconcile runs here instead of on its own
    // schedule: set KOBO_RECONCILE_IN_DIGEST=1 and remove its entry from vercel.json. It runs first, so the email is current.
    if (!dry && process.env.KOBO_RECONCILE_IN_DIGEST === "1") await (await import("@/server/kobo-reconcile")).reconcileAll().catch(() => undefined);
    return NextResponse.json(await runDigest(process.env.APP_ORIGIN || url.origin, dry));
  });
}
