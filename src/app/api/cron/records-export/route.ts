import { NextResponse } from "next/server";
import { cronAllowed, handle } from "@/server/guard";
import { scheduledExport } from "@/server/records-export";

export const maxDuration = 300;

/**
 * ISS-25: the weekly export of the records, called by the Vercel cron (vercel.json) with
 * CRON_SECRET. Kept in file storage when it is switched on; otherwise the run says so on Health.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const refused = cronAllowed(req.headers.get("authorization"), process.env.CRON_SECRET);
    if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status });
    return NextResponse.json(await scheduledExport());
  }, "records-export");
}
