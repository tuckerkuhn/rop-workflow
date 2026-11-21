import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { donorView } from "@/server/donor-view-store";
import { handle } from "@/server/guard";

/**
 * What a donor sees in their own account: the released reports, their money as the latest of them
 * gave it, and the next report date. A donor gets their own organization's view whatever is
 * asked; staff on the project may look at any donor's (`?donor=<id>`).
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req);
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await donorView(code, v.user, new URL(req.url).searchParams.get("donor")));
  });
}
