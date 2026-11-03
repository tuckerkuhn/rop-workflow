import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { projectDesignSchema } from "@/lib/project-setup";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { projectDesign, updateProject } from "@/server/project-store";

type Ctx = { params: Promise<{ code: string }> };

/** The project design, to edit in setup. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    const design = await projectDesign(code);
    return design ? NextResponse.json(design) : NextResponse.json({ error: "This project is kept in the browser only." }, { status: 404 });
  });
}

export async function PUT(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: "Only the project manager and plan approvers can change the project design." });
    if (v instanceof NextResponse) return v;
    const parsed = projectDesignSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid project." }, { status: 400 });
    if (!(await updateProject(code, parsed.data))) return NextResponse.json({ error: "No such project." }, { status: 404 });
    return NextResponse.json({ ok: true });
  });
}
