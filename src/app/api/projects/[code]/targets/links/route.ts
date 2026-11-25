import { NextResponse } from "next/server";
import { confirmLinksSchema } from "@/lib/target-details";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { checkPlanChange, logPlanChange, planSignedOff } from "@/server/plan-guard";
import { confirmLinks, loadTargetDetails } from "@/server/target-details";

type Ctx = { params: Promise<{ code: string }> };

/** Saves the suggested workplan items and budget lines a plan approver confirmed ("Use this", "Use all suggestions"). */
export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: isEmployee });
    if (v instanceof NextResponse) return v;
    // A signed-off plan: as for the rest of the plan, a plan approver changes it with a written
    // reason; anyone else proposes the change in the monthly review (decision 7, 25 Nov 2026).
    const refused = await checkPlanChange(code, v.user, req);
    if (refused) return refused;
    const parsed = confirmLinksSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
    const why = await confirmLinks(code, parsed.data, v.user);
    if (why) return NextResponse.json({ error: why.error }, { status: why.status });
    if (await planSignedOff(code)) await logPlanChange(code, v.user, req, "design", { targetLinks: parsed.data.links.length });
    return NextResponse.json(await loadTargetDetails(code, v.user));
  });
}
