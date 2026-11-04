import { NextResponse } from "next/server";
import { planActionSchema } from "@/lib/procurement-plan";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { actOnPlan } from "@/server/procurement-plan-store";

/** Approve, send back, reopen or change one item on the procurement calendar. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string; key: string }> }) {
  const { code, key } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.procurementAccess === "edit" || !!u.admin, why: "You can view Procurement but not change it." });
    if (v instanceof NextResponse) return v;
    const parsed = planActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    const r = await actOnPlan(code, key, parsed.data, v.user);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r);
  });
}
