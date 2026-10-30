import { NextResponse } from "next/server";
import { demoUser, handle, writesBlocked } from "@/server/guard";
import { decide } from "@/server/review";

/** MEL decision on one record: { status: "accepted" | "queried", note? }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = writesBlocked();
  if (blocked) return blocked;
  const { id } = await params;
  const user = demoUser(req);
  if (!user?.project.includes("mel-owner")) return NextResponse.json({ error: "Only the MEL owner can accept or query records." }, { status: 403 });
  return handle(async () => {
    const { status, note } = (await req.json()) as { status: "accepted" | "queried"; note?: string };
    if (status !== "accepted" && status !== "queried") return NextResponse.json({ error: "status must be accepted or queried" }, { status: 400 });
    return NextResponse.json(await decide(id, status, user, note));
  });
}
