import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { projectDesignSchema } from "@/lib/project-setup";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { createProject, listProjects } from "@/server/project-store";

/** Projects in the database, for the project picker. */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req);
    if (v instanceof NextResponse) return v;
    return NextResponse.json({ projects: await listProjects() });
  });
}

/** Creates a project from setup. */
export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: "Only project managers and plan approvers can create projects." });
    if (v instanceof NextResponse) return v;
    const parsed = projectDesignSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid project." }, { status: 400 });
    return NextResponse.json({ code: await createProject(parsed.data) }, { status: 201 });
  });
}
