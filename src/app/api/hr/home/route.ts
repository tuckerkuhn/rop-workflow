import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadHrHome } from "@/server/hr-home";

/** Home for HR staff. People holding an HR role only. */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const out = await loadHrHome(v.user.id);
    if (!out) return NextResponse.json({ error: "This view is for people holding an HR role." }, { status: 403 });
    return NextResponse.json(out);
  });
}
