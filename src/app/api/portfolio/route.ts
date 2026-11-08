import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadPortfolio } from "@/server/portfolio-store";

/** All the person's projects side by side. Staff only. */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: "The portfolio is for staff." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadPortfolio(v.user));
  });
}
