import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { familiesView } from "@/server/families";
import { handle } from "@/server/guard";

/** Home's first line: what the work came to for people this quarter, and one family's story. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await familiesView(code));
  });
}
