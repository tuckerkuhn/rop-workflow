import { NextResponse } from "next/server";
import { isMelOwner, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { decide } from "@/server/review";

/** MEL decision on one record: { status: "accepted" | "queried", note? }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: isMelOwner, why: "Only the MEL owner can accept or query records." });
    if (v instanceof NextResponse) return v;
    const { status, note } = (await req.json()) as { status: "accepted" | "queried"; note?: string };
    if (status !== "accepted" && status !== "queried") return NextResponse.json({ error: "status must be accepted or queried" }, { status: 400 });
    return NextResponse.json(await decide(id, status, v.user, note));
  });
}
