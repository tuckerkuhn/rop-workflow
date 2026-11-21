import { NextResponse } from "next/server";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadHome } from "@/server/home-store";
import { nextReport } from "@/server/next-report";

type Ctx = { params: Promise<{ code: string }> };

/**
 * Home's summary for a database project: on time, on budget, waiting for you, deadlines, in season.
 * With ?with=next-report it also carries what stands between the project and its next report
 * (the same answer as /next-report), so Home opens on one request: both read the same review and
 * report figures, and in one request those are read once (server/request-memo).
 */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    if (new URL(req.url).searchParams.get("with") !== "next-report") return NextResponse.json(await loadHome(code, v.user));
    const [home, report] = await Promise.all([loadHome(code, v.user), nextReport(code).catch(() => null)]);
    return NextResponse.json({ ...home, nextReport: report });
  });
}
