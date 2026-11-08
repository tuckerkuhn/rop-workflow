import { NextResponse } from "next/server";
import { db } from "@/db";
import type { AppUser } from "@/lib/demo";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";

/**
 * Change control for a project's plan (design and indicators, budget, workplan) once it is
 * signed off. In Design anyone allowed to edit setup may save; every save is still logged. After
 * sign-off the normal road is the monthly review (a proposed change a second reviewer approves);
 * a direct edit is allowed only to a plan approver, with a written reason, and is logged with it.
 */

export type PlanPart = "design" | "budget" | "workplan";
const OPEN = ["Develop", "Design"];
export const reasonOf = (req: Request) => {
  const raw = req.headers.get("x-change-reason") ?? "";
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    // A malformed header reads as no reason, which is refused with a clear message.
    return "";
  }
};

/** Null when the change may go ahead; otherwise the response to send. */
export async function checkPlanChange(code: string, u: AppUser, req: Request): Promise<NextResponse | null> {
  const project = await projectByCode(code).catch(() => null);
  if (!project || OPEN.includes(project.stage)) return null;
  if (!u.project.includes("plan-approver"))
    return NextResponse.json({ error: `The plan was signed off and the project is in ${project.stage}: propose the change in the monthly review, where a second reviewer approves it.`, signedOff: true }, { status: 409 });
  if (reasonOf(req).length < 10)
    return NextResponse.json({ error: "The plan is signed off: say why it is being changed (at least a sentence) in the box at the top of setup. The reason goes in the audit trail.", signedOff: true, needsReason: true }, { status: 409 });
  return null;
}

/** Records the save in the audit trail, with the reason when the plan was already signed off. */
export async function logPlanChange(code: string, u: AppUser, req: Request, part: PlanPart, detail: Record<string, unknown>) {
  const project = await projectByCode(code);
  const signed = !OPEN.includes(project.stage);
  await logAudit(db, project.id, { entity: "plan", entityId: project.id, action: signed ? "plan_changed_after_signoff" : "plan_edited", by: u.id, detail: { part, stage: project.stage, ...(signed ? { reason: reasonOf(req) } : {}), ...detail } });
}
