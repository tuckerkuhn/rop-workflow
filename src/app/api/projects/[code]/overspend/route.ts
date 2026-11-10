import { NextResponse } from "next/server";
import { lineReasonSchema } from "@/lib/overspend";
import { mayWriteReport } from "@/lib/qpr";
import { isEmployee, requireViewer } from "@/server/auth";
import { loadBudgetView } from "@/server/budget-view-store";
import { handle } from "@/server/guard";
import { saveLineReason } from "@/server/overspend-store";

type Ctx = { params: Promise<{ code: string }> };

/**
 * The reason a budget line is over budget, given on Budget (lib/overspend.ts). The people who write
 * the quarterly report give it; it is kept on the line and printed in each report while the line is over.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: isEmployee });
    if (v instanceof NextResponse) return v;
    if (!mayWriteReport(v.user)) return NextResponse.json({ error: "The MEL owner or a programme lead gives the reason." }, { status: 403 });
    const p = lineReasonSchema.safeParse(await req.json().catch(() => null));
    if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Choose a reason." }, { status: 400 });
    const view = await loadBudgetView(code, true);
    if (!view.explain?.lines[p.data.line]) return NextResponse.json({ error: "That budget line is not overspent." }, { status: 400 });
    await saveLineReason(code, p.data.line, p.data.reason ? { reason: p.data.reason, note: p.data.note } : null, v.user.id);
    return NextResponse.json({ saved: true });
  });
}
