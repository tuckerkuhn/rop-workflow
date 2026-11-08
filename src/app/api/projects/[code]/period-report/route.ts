import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { periodReport } from "@/server/period-report-store";

/** The annual report (?kind=annual&year=2026) or the final report (?kind=final). Staff only. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: "Reports in preparation are for project staff." });
    if (v instanceof NextResponse) return v;
    const q = new URL(req.url).searchParams;
    const kind = q.get("kind");
    const year = Number(q.get("year"));
    if (kind === "final") return NextResponse.json(await periodReport(code, { kind: "final" }));
    if (kind === "annual" && year >= 2000 && year <= 2100) return NextResponse.json(await periodReport(code, { kind: "annual", year }));
    return NextResponse.json({ error: "Choose ?kind=annual&year=2026 or ?kind=final." }, { status: 400 });
  });
}
