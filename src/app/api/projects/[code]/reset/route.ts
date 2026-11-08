import { NextResponse } from "next/server";
import { demoMode, requireViewer } from "@/server/auth";
import { resetDemo } from "@/server/demo-seed";
import { handle } from "@/server/guard";
import { DEMO_PROJECT } from "@/server/procurement-guard";

/** Restores the demo Field activities and sample records. Real Kobo submissions are kept. Demo mode only. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!demoMode()) return NextResponse.json({ error: "Resetting sample data is only available in demo mode." }, { status: 403 });
  // Only the demo project holds sample data. Every other project is real, even on a laptop in demo
  // mode: the laptop shares the live database, and a reset deletes the project's records.
  if (code !== DEMO_PROJECT) return NextResponse.json({ error: `${code} is a real project: its records cannot be reset.` }, { status: 403 });
  return handle(async () => {
    const v = await requireViewer(req, { write: true });
    if (v instanceof NextResponse) return v;
    await resetDemo(code);
    return NextResponse.json({ ok: true });
  });
}
