import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { isSampleBook, resetSample } from "@/server/hr-store";

/** Restores the fictional sample records. Real HR books can never be reset. */
export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => !!u.admin, why: "Only an administrator can reset the sample records." });
    if (v instanceof NextResponse) return v;
    if (!isSampleBook()) return NextResponse.json({ error: "These are real records. They can never be reset." }, { status: 403 });
    await resetSample();
    return NextResponse.json({ ok: true });
  });
}
