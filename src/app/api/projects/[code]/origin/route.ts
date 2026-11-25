import { NextResponse } from "next/server";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadOrigin } from "@/server/project-origin";

type Ctx = { params: Promise<{ code: string }> };

/** The proposal (or opportunity) this project comes from, for Settings. Staff only: win themes are internal. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    const o = await loadOrigin(decodeURIComponent(code));
    return NextResponse.json({ origin: o && { proposalId: o.proposalId, opportunityId: o.opportunityId, title: o.title, donor: o.donor, decidedAt: o.decidedAt } });
  });
}
