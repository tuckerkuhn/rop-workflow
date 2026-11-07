import { NextResponse } from "next/server";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadHome } from "@/server/home-store";

type Ctx = { params: Promise<{ code: string }> };

/** Home's summary for a database project: on time, on budget, waiting for you, deadlines, in season. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadHome(code, v.user));
  });
}
