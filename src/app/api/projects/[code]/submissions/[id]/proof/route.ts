import { NextResponse } from "next/server";
import { z } from "zod";
import { isEmployee, onProject, requireViewer } from "@/server/auth";
import { handle, HttpError } from "@/server/guard";
import { submissionPhoto, submissionProof } from "@/server/submission-proof";

/**
 * The proof behind one KoboCollect field form in the review queue, for staff on the project:
 *   GET                    which photos it holds, and where and when it was made (never typed)
 *   GET ?photo=<question>  that photo, fetched from the project's own KoboToolbox account
 *
 * A photo can show a farmer and a GPS point is where a farmer lives: staff on the project who can
 * see field records only, and the coordinates only for people who may see participant names.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code: raw, id } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    if (!onProject(v.user, code) || v.user.fieldAccess === "none") throw new HttpError(403, "Your role does not open field records on this project.");
    if (!z.uuid().safeParse(id).success) throw new HttpError(404, "That record is not in this project's review queue. Reload the queue.");
    const question = new URL(req.url).searchParams.get("photo");
    if (!question) return NextResponse.json(await submissionProof(code, id, !!v.user.pii), { headers: { "Cache-Control": "private, no-store" } });
    if (!/^[A-Za-z][A-Za-z0-9_/]{0,80}$/.test(question)) throw new HttpError(400, "That is not a question on the form.");
    const photo = await submissionPhoto(code, id, question);
    return new NextResponse(new Uint8Array(photo.bytes), { headers: { "Content-Type": photo.type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  });
}
