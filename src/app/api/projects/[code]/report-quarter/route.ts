import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { reportQuarter } from "@/server/next-report";

/** The quarter "the next report" is about (server/next-report reportQuarter): the report page opens on it. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json({ quarter: await reportQuarter(code) });
  });
}
