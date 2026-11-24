import { NextResponse } from "next/server";
import { z } from "zod";
import { collectorOf, reviewRefusal } from "@/lib/kobo-approval";
import { onProject, people, requireViewer } from "@/server/auth";
import { koboApprovalFor } from "@/server/kobo-approval";
import { handle, HttpError, readBody } from "@/server/guard";
import { decide } from "@/server/review";

const bodySchema = z.object({ status: z.enum(["accepted", "queried"]), note: z.string().trim().max(1000).optional() });

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
    const { status, note } = await readBody(req, bodySchema, "Choose Accept or Query. A query needs a short note.");
    return NextResponse.json(await decide(code, id, status, v.user, note, (fromKobo, by, form) => reviewRefusal(v.user, team, { fromKobo, collector: fromKobo ? collectorOf(by, rule, team) : by, form }, rule, status, note)));
  });
}
