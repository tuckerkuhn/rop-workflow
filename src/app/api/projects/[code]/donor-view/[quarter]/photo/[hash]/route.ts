import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { periodOfSlug } from "@/lib/period-report";
import { releasedPhoto } from "@/server/donor-view-store";
import { handle } from "@/server/guard";
import { loadFile } from "@/server/hr-files";

/** A captioned photo in a released report (a quarter, or "annual-2026" or "final"), for a signed-in donor or staff: only photos in that report or behind its figures. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string; quarter: string; hash: string }> }) {
  const { code, quarter, hash } = await params;
  return handle(async () => {
    const v = await requireViewer(req);
    if (v instanceof NextResponse) return v;
    const none = () => NextResponse.json({ error: "Not available." }, { status: 404 });
    if (!(/^\d{4}-Q[1-4]$/.test(quarter) || periodOfSlug(quarter)) || !/^[0-9a-f]{64}$/.test(hash) || !(await releasedPhoto(code, quarter, hash))) return none();
    const f = await loadFile(hash);
    if (!f) return none();
    return new NextResponse(new Uint8Array(f.data), { headers: { "Content-Type": f.type, "Cache-Control": "private, max-age=3600" } });
  });
}
