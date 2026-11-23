import { NextResponse } from "next/server";
import { askSchema, canAsk } from "@/lib/procurement-plan";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { askForUnplanned } from "@/server/procurement-plan-store";

/**
 * Asks for a purchase that is not on the procurement calendar. It is added as a draft marked as not
 * planned, and needs the same two approvals as a planned item before a request can start.
 */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canAsk, why: "You can view Procurement but not ask for purchases." });
    if (v instanceof NextResponse) return v;
    const parsed = askSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Fill in every field." }, { status: 400 });
    const r = await askForUnplanned(code, parsed.data, v.user);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r);
  });
}
