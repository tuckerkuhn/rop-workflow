import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { projectDesignSchema } from "@/lib/project-setup";
import { onProject, requireViewer } from "@/server/auth";
import { audit, handle } from "@/server/guard";
import { handRecordedCounts } from "@/server/kobo-fed";
import { createProject, listProjects } from "@/server/project-store";

/** Projects in the database, for the project picker. */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req);
    if (v instanceof NextResponse) return v;
    // Only the projects this person works on, each with how many indicators take results by hand.
    const hand = await handRecordedCounts();
    return NextResponse.json({ projects: (await listProjects()).filter((p) => onProject(v.user, p.code)).map((p) => ({ ...p, handRecorded: hand.get(p.code) ?? 0 })) });
  });
}

/** Creates a project from setup. */
export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: "Only project managers and plan approvers can create projects." });
    if (v instanceof NextResponse) return v;
    const parsed = projectDesignSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid project." }, { status: 400 });
    const code = await createProject(parsed.data);
    await audit(code, { entity: "project", entityId: crypto.randomUUID(), action: "project_created", by: v.user.id, detail: { name: parsed.data.name, startDate: parsed.data.startDate, endDate: parsed.data.endDate, indicators: parsed.data.indicators.length, donors: parsed.data.donors ?? [] } });
    return NextResponse.json({ code }, { status: 201 });
  });
}
