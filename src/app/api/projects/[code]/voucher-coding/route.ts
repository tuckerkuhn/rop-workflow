import { NextResponse } from "next/server";
import { db } from "@/db";
import { canEditProject } from "@/lib/demo";
import { EMPTY_VOUCHER_SETUP, VOUCHER_SETUP_KEY, voucherSetupSchema, type VoucherSetup } from "@/lib/voucher-setup";
import { logAudit } from "@/server/audit";
import { isEmployee, requireViewer } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { handle } from "@/server/guard";
import { loadProjectState, saveProjectState } from "@/server/project-state";

type Ctx = { params: Promise<{ code: string }> };

/** The project's voucher coding (lib/voucher-setup). Staff only. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    const project = await projectByCode(decodeURIComponent(code));
    return NextResponse.json(await loadProjectState<VoucherSetup>(project.id, VOUCHER_SETUP_KEY, EMPTY_VOUCHER_SETUP));
  });
}

/** Set by the project manager or Finance in project setup. */
export async function PUT(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => canEditProject(u) || u.procurement.includes("finance"), why: "Only the project manager and Finance set the voucher coding." });
    if (v instanceof NextResponse) return v;
    const parsed = voucherSetupSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "The coding could not be saved: check each field." }, { status: 400 });
    const project = await projectByCode(decodeURIComponent(code));
    const before = await loadProjectState<VoucherSetup>(project.id, VOUCHER_SETUP_KEY, EMPTY_VOUCHER_SETUP);
    await saveProjectState(project.id, VOUCHER_SETUP_KEY, parsed.data);
    await logAudit(db, project.id, { entity: "project", entityId: project.id, action: "voucher_coding_set", by: v.user.id, detail: { before, after: parsed.data } });
    return NextResponse.json({ ok: true });
  });
}
