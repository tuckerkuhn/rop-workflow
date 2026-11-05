import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { seesAll } from "@/lib/hr";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadHr, seal } from "@/server/hr-store";

/** Daily seal, called by the Vercel cron (vercel.json) with CRON_SECRET. */
export async function GET(req: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) return NextResponse.json({ error: "Set CRON_SECRET to turn on the daily seal." }, { status: 503 });
    const got = Buffer.from(req.headers.get("authorization") ?? "");
    const want = Buffer.from(`Bearer ${secret}`);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
    return NextResponse.json(await seal("system"));
  });
}

/** Seal now, by anyone holding an HR role. */
export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true });
    if (v instanceof NextResponse) return v;
    const { state } = await loadHr();
    if (!seesAll(v.user.id, state)) return NextResponse.json({ error: "Only people holding an HR role can seal the record." }, { status: 403 });
    return NextResponse.json(await seal(v.user.id));
  });
}
