import { NextResponse } from "next/server";
import { z } from "zod";
import { isMelOwner, requireViewer } from "@/server/auth";
import { handle, HttpError, readBody } from "@/server/guard";
import { decide } from "@/server/review";

const bodySchema = z.object({ status: z.enum(["accepted", "queried"]), note: z.string().trim().max(1000).optional() });

/** MEL decision on one record in this project's review queue: { status: "accepted" | "queried", note? }. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: isMelOwner, why: "Only the MEL owner can accept or query records." });
    if (v instanceof NextResponse) return v;
    if (!z.uuid().safeParse(id).success) throw new HttpError(404, "That record is not in this project's review queue. Reload the queue.");
    const { status, note } = await readBody(req, bodySchema, "Choose Accept or Query. A query needs a short note.");
    return NextResponse.json(await decide(code, id, status, v.user, note));
  });
}
