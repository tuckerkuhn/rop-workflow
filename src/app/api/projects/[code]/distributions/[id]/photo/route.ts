import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { listDistributions, mayApprove } from "@/server/distribution";
import { distributionFacts, koboPhoto, type PhotoWhich } from "@/server/distribution-photo";
import { handle, HttpError } from "@/server/guard";

/**
 * The proof behind one input distribution, for signed-in staff who may open it:
 *   GET ?which=note|handover   the KoboCollect photo itself, fetched from the project's KoboToolbox account
 *   GET ?facts=1               where and when it happened, from the phone and the photo (never typed)
 *
 * Never opened by the emailed approval link alone: a photo can show farmers' names and a GPS point
 * is where a farmer lives. Coordinates go only to people who may see participant names.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code: raw, id } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const d = (await listDistributions(code)).find((x) => x.id === id);
    if (!d) throw new HttpError(404, "That distribution is not on this project.");
    // The same people who may open the distribution itself: field staff, its approvers, whoever checks its KoboCollect record.
    const opens = v.user.fieldAccess !== "none" || (mayApprove(v.user, code) && d.approvers.includes(v.user.id)) || d.koboCheck.who.includes(v.user.id);
    if (!opens) throw new HttpError(403, "Your role does not open input distributions on this project.");

    const q = new URL(req.url).searchParams;
    if (q.get("facts")) return NextResponse.json({ facts: await distributionFacts(code, id, !!v.user.pii) }, { headers: { "Cache-Control": "private, no-store" } });

    const which = q.get("which");
    if (which !== "note" && which !== "handover") throw new HttpError(400, "Say which photo: note or handover.");
    const photo = await koboPhoto(code, id, which as PhotoWhich);
    return new NextResponse(new Uint8Array(photo.bytes), { headers: { "Content-Type": photo.type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  });
}
