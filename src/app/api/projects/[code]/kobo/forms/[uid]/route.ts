import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { liveQuestions, readable } from "@/server/kobo-link";

/** The questions on one form, read from KoboToolbox now, for mapping to indicators. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string; uid: string }> }) {
  const { code, uid } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: canEditProject, why: "Only the project manager and plan approvers can map questions." });
    if (v instanceof NextResponse) return v;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(uid)) return NextResponse.json({ error: "Invalid form id." }, { status: 400 });
    return readable(async () => NextResponse.json({ questions: await liveQuestions(code, uid) }));
  });
}
