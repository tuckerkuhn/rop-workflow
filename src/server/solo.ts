import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema as sch } from "@/db";
import { selfSchema, type SelfConfirm } from "@/lib/solo";
import { projectByCode } from "@/server/field-store";
import { loadOrgSettings } from "@/server/org-settings-store";
import { donorOf, loadPolicy, projectRules } from "@/server/policy-store";

/**
 * Solo mode for sign-offs (B2). Two people sign by default: whoever prepared something does not
 * approve it. An administrator may turn on solo mode for a small team; then the same person may
 * approve their own result, monthly review change, bill or purchase, each time confirming "I
 * prepared this and I am approving it myself", and the audit entry is marked self-approved.
 * Never in solo mode: a project whose donor rules require a second person, and (checked by the
 * procurement guard) large awards, sole sources and exceptions.
 */

export { selfSchema, type SelfConfirm };

export type SoloState = { on: boolean; blocked: string | null };

/** Whether solo mode applies on a project: on for its organization, and no donor rule against it. */
export async function soloFor(code: string): Promise<SoloState> {
  const project = await projectByCode(code);
  const [org, setting, rules] = await Promise.all([loadOrgSettings(project.organizationId), loadPolicy(code), projectRules(code)]);
  const on = !!org.solo?.on;
  const donor = donorOf(setting);
  // A donor's rule binds here even before anyone layers it on: it only ever asks for a second person.
  const donorSays = donor?.values.secondPersonRequired?.value === true;
  const inForce = rules.values.secondPersonRequired === true;
  const blocked = donorSays ? `${donor?.name ?? "The donor"}'s rules require a second person on every approval for this project.` : inForce ? "This project's rules require a second person on every approval." : null;
  return { on, blocked };
}

/**
 * The check for one self-approval. `refusal` is the usual two-person message, given when solo mode
 * is off. On success, the audit detail that marks the entry.
 */
export function selfApproval(state: SoloState, self: SelfConfirm | undefined, refusal: string): { ok: true; detail: { selfApproved: true; soloNote?: string } } | { ok: false; why: string } {
  if (!state.on) return { ok: false, why: refusal };
  if (state.blocked) return { ok: false, why: `${refusal} ${state.blocked}` };
  if (!self?.confirm) return { ok: false, why: "Confirm that you prepared this and are approving it yourself." };
  return { ok: true, detail: { selfApproved: true, ...(self.note ? { soloNote: self.note } : {}) } };
}

/**
 * Sign-offs in the period that the person who prepared them approved
 * themselves. A warning, never a blocker: a second look before release is good practice. Results
 * count by their date; bills, review changes and purchases by when they were approved.
 */
export async function selfApprovedIn(code: string, from: string, to: string) {
  const p = await projectByCode(code);
  const rows = await db
    .select({ at: sch.auditLog.at, entity: sch.auditLog.entity, detail: sch.auditLog.detail })
    .from(sch.auditLog)
    .where(and(eq(sch.auditLog.projectId, p.id), gte(sch.auditLog.at, new Date(`${from}T00:00:00Z`)), sql`${sch.auditLog.detail}->>'selfApproved' = 'true'`));
  const end = new Date(`${to}T23:59:59.999Z`);
  return rows.filter((r) => {
    const date = (r.detail as { date?: unknown } | null)?.date;
    return r.entity === "result" && typeof date === "string" ? date >= from && date <= to : r.at <= end;
  }).length;
}

/** Of these results, the ones their recorder accepted themselves in solo mode. */
export async function selfAcceptedResults(projectId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: sch.auditLog.entityId })
    .from(sch.auditLog)
    .where(and(eq(sch.auditLog.projectId, projectId), eq(sch.auditLog.entity, "result"), eq(sch.auditLog.action, "result_accepted"), inArray(sch.auditLog.entityId, ids), sql`${sch.auditLog.detail}->>'selfApproved' = 'true'`));
  return new Set(rows.map((r) => r.id));
}
