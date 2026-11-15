import { NextResponse } from "next/server";
import { z } from "zod";
import { canEditProject } from "@/lib/demo";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { approverNames, collectorOf, KOBO_APPROVAL_OPTIONS, koboApprovalProblem, mayApproveKobo, suggestedCollector, type KoboApproval } from "@/lib/kobo-approval";
import { projectByCode } from "@/server/field-store";
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
    // The KoboCollect accounts that have sent records to this project, and who each one is.
    const project = await projectByCode(code);
    const sent = await db.selectDistinct({ account: s.evidence.completedBy }).from(s.evidence).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.source, "kobo"), isNotNull(s.evidence.completedBy)));
    const names = [...new Set([...sent.map((x) => x.account!.trim()).filter(Boolean), ...Object.keys(rule.accounts ?? {})])].sort((a, b) => a.localeCompare(b));
    return NextResponse.json({
      accounts: names.map((account) => ({ account, person: collectorOf(account, rule, staff), saved: !!rule.accounts?.[account], suggested: suggestedCollector(account, staff) })),
      rule,
      options: KOBO_APPROVAL_OPTIONS,
      people: staff.map((p) => ({ id: p.id, name: p.name, title: p.title, fieldAccess: p.fieldAccess })),
      approvers: approverNames(staff, rule),
      mine: mayApproveKobo(v.user, rule),
      canEdit: (canEditProject(v.user) || !!v.user.admin) && v.user.kind === "employee",
    });
  });
}

const body = z.object({ who: z.enum(["mel", "named", "manager"]), person: z.string().max(80).optional(), standIn: z.string().max(80).optional(), accounts: z.record(z.string().trim().min(1).max(120), z.string().max(80)).optional() });

export async function PUT(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => (canEditProject(u) || !!u.admin) && u.kind === "employee", why: "Only the project manager, plan approvers and administrators choose who approves KoboCollect data." });
    if (v instanceof NextResponse) return v;
    const b = await readBody(req, body, "Choose who approves KoboCollect data.");
    const staff = await team(code);
    // Only matches to people on this project's staff are kept; an empty choice removes the match.
    const accounts = Object.fromEntries(Object.entries(b.accounts ?? {}).filter(([, id]) => staff.some((p) => p.id === id)));
    const rule: KoboApproval = { ...(b.who === "named" ? { who: "named", person: b.person || undefined, standIn: b.standIn || undefined } : { who: b.who }), ...(Object.keys(accounts).length ? { accounts } : {}) };
    const problem = koboApprovalProblem(rule, staff);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const before = await koboApprovalFor(code);
    await saveKoboApproval(code, rule);
    await audit(code, { entity: "kobo", entityId: crypto.randomUUID(), action: "kobo_approval_set", by: v.user.id, detail: { before, after: rule } });
    return NextResponse.json({ rule, approvers: approverNames(staff, rule) });
  });
}
