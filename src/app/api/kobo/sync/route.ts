import { NextResponse } from "next/server";
import { handle, writesBlocked } from "@/server/guard";
import { syncFromKobo } from "@/server/kobo";

/** Manual "Sync from Kobo": pulls every readiness submission. Duplicates are skipped by _uuid. */
export async function POST() {
  const blocked = writesBlocked();
  if (blocked) return blocked;
  return handle(async () => NextResponse.json(await syncFromKobo()));
}
