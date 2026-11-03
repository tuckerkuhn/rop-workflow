import { NextResponse } from "next/server";
import { demoMode, requireViewer } from "@/server/auth";
import { resetDemo } from "@/server/demo-seed";
import { handle } from "@/server/guard";

/** Restores the demo Field activities and sample records. Real Kobo submissions are kept. Demo mode only. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!demoMode()) return NextResponse.json({ error: "Resetting sample data is only available in demo mode." }, { status: 403 });
  return handle(async () => {
    const v = await requireViewer(req, { write: true });
    if (v instanceof NextResponse) return v;
    await resetDemo(code);
    return NextResponse.json({ ok: true });
  });
}
