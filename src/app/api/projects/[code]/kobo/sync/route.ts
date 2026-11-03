import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { isMelOwner, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { readable, sync } from "@/server/kobo-link";

/** Pulls new submissions from the project's forms. The project manager, plan approvers and the MEL owner may run it. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => canEditProject(u) || isMelOwner(u), why: "Your role cannot sync KoboToolbox." });
    if (v instanceof NextResponse) return v;
    return readable(async () => NextResponse.json(await sync(code)));
  });
}
