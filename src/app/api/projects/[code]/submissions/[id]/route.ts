import { NextResponse } from "next/server";
import { z } from "zod";
import { fieldRec, reviewRefusal } from "@/lib/kobo-approval";
import { onProject, people, requireViewer } from "@/server/auth";
import { koboApprovalFor } from "@/server/kobo-approval";
import { handle, HttpError, readBody } from "@/server/guard";
import { decide, settleHeld } from "@/server/review";

const bodySchema = z.union([
  z.object({ status: z.enum(["accepted", "queried"]), note: z.string().trim().max(1000).optional() }),
  // A farmer left open on an accepted training session record, held in Farmer selection: record them now, or leave them out.
  z.object({ held: z.string().trim().regex(/^[A-Za-z0-9-]{1,40}$/), action: z.enum(["record", "leave_out"]) }),
]);

/**
 * MEL decision on one record in this project's review queue: { status: "accepted" | "queried", note? }.
 * The technical lead may also send a field form back with a note, never accept one (lib/kobo-approval reviewRefusal).
 */
export async function POST(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  return handle(async () => {
    // A record from KoboCollect is decided by whoever this project names for KoboCollect data; any other by MEL.
    const rule = await koboApprovalFor(code);
    const team = (await people()).filter((p) => onProject(p, code));
    // Decided by the project's KoboCollect approver (a phone record) or MEL (any other), never by
    // whoever collected it; with nobody else, by the person the collector reports to. The technical
    // lead may send a field form back with a note, but not accept it.
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee", why: "Only staff can accept or query field records." });
    if (v instanceof NextResponse) return v;
    if (!z.uuid().safeParse(id).success) throw new HttpError(404, "That record is not in this project's review queue. Reload the queue.");
    const body = await readBody(req, bodySchema, "Choose Accept or Query. A query needs a short note.");
    // Decided by whoever may accept the record itself.
    if ("held" in body) return NextResponse.json(await settleHeld(code, id, body.held, body.action, v.user, (source, by, form) => reviewRefusal(v.user, team, { ...fieldRec({ source, by }, rule, team), form }, rule, "accepted")));
    const { status, note } = body;
    return NextResponse.json(await decide(code, id, status, v.user, note, (source, by, form) => reviewRefusal(v.user, team, { ...fieldRec({ source, by }, rule, team), form }, rule, status, note)));
  });
}
