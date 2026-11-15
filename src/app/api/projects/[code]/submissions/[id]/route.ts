import { NextResponse } from "next/server";
import { z } from "zod";
import { approverNames, mayApproveKobo, mayDecide } from "@/lib/kobo-approval";
import { isMelOwner, onProject, people, requireViewer } from "@/server/auth";
import { koboApprovalFor } from "@/server/kobo-approval";
import { handle, HttpError, readBody } from "@/server/guard";
import { decide } from "@/server/review";

const bodySchema = z.object({ status: z.enum(["accepted", "queried"]), note: z.string().trim().max(1000).optional() });

/** MEL decision on one record in this project's review queue: { status: "accepted" | "queried", note? }. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  return handle(async () => {
    // A record from KoboCollect is decided by whoever this project names for KoboCollect data; any other by MEL.
    const rule = await koboApprovalFor(code);
    const v = await requireViewer(req, { write: true, allow: (u) => isMelOwner(u) || mayApproveKobo(u, rule), why: "Only the people who check field records on this project can accept or query them." });
    if (v instanceof NextResponse) return v;
    if (!z.uuid().safeParse(id).success) throw new HttpError(404, "That record is not in this project's review queue. Reload the queue.");
    const { status, note } = await readBody(req, bodySchema, "Choose Accept or Query. A query needs a short note.");
    const names = approverNames((await people()).filter((p) => onProject(p, code)), rule);
    return NextResponse.json(await decide(code, id, status, v.user, note, (fromKobo) => (mayDecide(v.user, fromKobo, rule) ? null : fromKobo ? `This record came from KoboCollect. On this project ${names} approves KoboCollect data.` : "Only the MEL owner can accept or query this record.")));
  });
}
