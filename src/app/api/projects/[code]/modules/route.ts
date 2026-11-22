import { NextResponse } from "next/server";
import { canEditProject, type AppUser } from "@/lib/demo";
import { ALL_MODULES, modulesChangeSchema, type Modules } from "@/lib/project-modules";
import { requireViewer } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { audit, handle } from "@/server/guard";
import { loadProjectState, updateProjectState } from "@/server/project-state";

const KEY = "modules";
const staff = (u: AppUser) => u.kind === "employee";
type Ctx = { params: Promise<{ code: string }> };

/** The parts of the app this project uses (lib/project-modules). For staff. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: staff });
    if (v instanceof NextResponse) return v;
    return NextResponse.json({ modules: await loadProjectState<Modules>((await projectByCode(code)).id, KEY, ALL_MODULES) });
  });
}

/**
 * Switches parts on or off: the body names only the parts changed, merged into what is saved under
 * the lock, so two people switching different parts at once both keep their change. Nothing is
 * deleted: a part switched off leaves the menus and keeps its records.
 */
export async function PUT(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: "Only the project manager and plan approvers can change what the project uses." });
    if (v instanceof NextResponse) return v;
    const parsed = modulesChangeSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const project = await projectByCode(code);
    const { before, after } = await updateProjectState<Modules, { before: Modules; after: Modules }>(project.id, KEY, ALL_MODULES, async (cur) => {
      const after = { ...cur, ...parsed.data };
      return { data: after, result: { before: cur, after } };
    });
    await audit(code, { entity: "project", entityId: project.id, action: "project_modules_set", by: v.user.id, detail: { before, after } });
    return NextResponse.json({ modules: after });
  });
}
