import { NextResponse } from "next/server";
import { isEmployee, requireViewer } from "@/server/auth";
import { roster } from "@/server/field-store";
import { handle } from "@/server/guard";
import { listSubmissions } from "@/server/kobo";

/** The review queue: sample records plus real Kobo submissions, with the farmer roster for the data checker. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    const { project, submissions } = await listSubmissions(code);
    return NextResponse.json({ submissions, roster: await roster(project.id) });
  });
}
