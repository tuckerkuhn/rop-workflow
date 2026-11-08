import { NextResponse } from "next/server";
import { isEmployee, onProject, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { farmersCsv } from "@/server/kobo";

/** farmers.csv for the Kobo forms: farmer ID, village and household-head initials. Never names. */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("project") ?? "A-2027";
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    // The project comes from ?project=, which the path-based check in requireViewer does not see.
    if (!onProject(v.user, code)) return NextResponse.json({ error: "You do not work on this project." }, { status: 403 });
    return new Response(await farmersCsv(code), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="farmers.csv"' } });
  });
}
