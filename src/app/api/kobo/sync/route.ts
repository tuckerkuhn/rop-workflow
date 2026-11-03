import { NextResponse } from "next/server";
import { isMelOwner, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { syncFromKobo } from "@/server/kobo";

/** Manual "Sync from Kobo": pulls every readiness submission. Duplicates are skipped by _uuid. */
export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: isMelOwner, why: "Only the MEL owner can sync from Kobo." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await syncFromKobo());
  });
}
