import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { soloFor } from "@/server/solo";

/** Whether solo sign-off applies on this project (server/solo.ts), so screens can offer it. Staff only. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: "Sign-offs are for project staff." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await soloFor(code));
  });
}
