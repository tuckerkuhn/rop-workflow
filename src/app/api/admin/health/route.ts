import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { health } from "@/server/limits";

/** Administrators: recent server errors, AI use against its limits, and whether email is set up. */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => !!u.admin, why: "Only administrators see the health page." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await health());
  });
}
