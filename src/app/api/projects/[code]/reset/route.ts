import { NextResponse } from "next/server";
import { resetDemo } from "@/server/demo-seed";
import { handle, writesBlocked } from "@/server/guard";

/** Restores the demo Field activities and sample records. Real Kobo submissions are kept. */
export async function POST(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const blocked = writesBlocked();
  if (blocked) return blocked;
  const { code } = await params;
  return handle(async () => {
    await resetDemo(code);
    return NextResponse.json({ ok: true });
  });
}
