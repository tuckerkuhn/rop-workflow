import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadProgress } from "@/server/progress-store";

/** Indicators with their values, and donors. Counts only, so donors may read it too (their own donor entry only). */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req);
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadProgress(code, v.user));
  });
}
