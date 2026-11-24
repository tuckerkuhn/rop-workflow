import { NextResponse } from "next/server";
import { cronAllowed, handle } from "@/server/guard";
import { runLedgerCheck } from "@/server/ledger-check";

// Every organization's books are read in turn: allow the time it takes.
export const maxDuration = 300;

/**
 * The nightly check of the books, called by the Vercel cron (vercel.json) with CRON_SECRET: for each
 * organization the trial balance balances and completed bank reconciliations still match. Each
 * result is kept for the leadership Week ahead (server/ledger-check latestLedgerCheck). Without the
 * secret set on the server it refuses to run at all.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const refused = cronAllowed(req.headers.get("authorization"), process.env.CRON_SECRET);
    if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status });
    return NextResponse.json(await runLedgerCheck());
  }, "ledger-check");
}
