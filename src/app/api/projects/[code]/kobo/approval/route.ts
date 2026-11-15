import { NextResponse } from "next/server";
import { z } from "zod";
import { canEditProject } from "@/lib/demo";
import { approverNames, KOBO_APPROVAL_OPTIONS, koboApprovalProblem, mayApproveKobo, type KoboApproval } from "@/lib/kobo-approval";
import { onProject, people, requireViewer } from "@/server/auth";
import { audit, handle, readBody } from "@/server/guard";
import { koboApprovalFor, saveKoboApproval } from "@/server/kobo-approval";

type Ctx = { params: Promise<{ code: string }> };

const team = async (code: string) => (await people()).filter((p) => p.kind === "employee" && onProject(p, code));

/** Who approves KoboCollect data on this project, the options, and the people to choose from. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req);
    if (v instanceof NextResponse) return v;
    const rule = await koboApprovalFor(code);
    const staff = await team(code);
    return NextResponse.json({
      rule,
      options: KOBO_APPROVAL_OPTIONS,
      people: staff.map((p) => ({ id: p.id, name: p.name, title: p.title })),
      approvers: approverNames(staff, rule),
      mine: mayApproveKobo(v.user, rule),
      canEdit: (canEditProject(v.user) || !!v.user.admin) && v.user.kind === "employee",
    });
  });
}

const body = z.object({ who: z.enum(["mel", "named", "manager"]), person: z.string().max(80).optional(), standIn: z.string().max(80).optional() });

export async function PUT(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => (canEditProject(u) || !!u.admin) && u.kind === "employee", why: "Only the project manager, plan approvers and administrators choose who approves KoboCollect data." });
    if (v instanceof NextResponse) return v;
    const b = await readBody(req, body, "Choose who approves KoboCollect data.");
    const rule: KoboApproval = b.who === "named" ? { who: "named", person: b.person || undefined, standIn: b.standIn || undefined } : { who: b.who };
    const staff = await team(code);
    const problem = koboApprovalProblem(rule, staff);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const before = await koboApprovalFor(code);
    await saveKoboApproval(code, rule);
    await audit(code, { entity: "kobo", entityId: crypto.randomUUID(), action: "kobo_approval_set", by: v.user.id, detail: { before, after: rule } });
    return NextResponse.json({ rule, approvers: approverNames(staff, rule) });
  });
}
