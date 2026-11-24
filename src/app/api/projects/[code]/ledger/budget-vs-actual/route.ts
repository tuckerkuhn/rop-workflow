import { NextResponse } from "next/server";
import { guard, handle } from "@/server/guard";
import { budgetActualView, drillView } from "@/server/ledger-view";

type Ctx = { params: Promise<{ code: string }> };

/**
 * Budget vs actual from the books, by donor and budget line (staff on the project). With
 * ?line=<budget line id or "none"> (and ?donor=<donor id or "none">): the posted entries behind
 * that figure instead.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await guard(req, { allow: (u) => u.kind === "employee" });
    const q = new URL(req.url).searchParams;
    const line = q.get("line");
    if (line) return NextResponse.json({ entries: await drillView(code, v.user, line, q.get("donor") ?? undefined) });
    return NextResponse.json(await budgetActualView(code));
  }, "ledger");
}
