import type { LineReason, OverspendReason } from "@/lib/overspend";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { loadProjectState, updateProjectState } from "@/server/project-state";

/** The reason each budget line is over budget (lib/overspend.ts), as project_state "overspendReasons". */
const KEY = "overspendReasons";

export async function loadLineReasons(projectId: string): Promise<Record<string, LineReason>> {
  return loadProjectState<Record<string, LineReason>>(projectId, KEY, {});
}

/** Sets or clears (null) one line's reason, and logs it. */
export async function saveLineReason(code: string, line: string, r: { reason: OverspendReason; note: string } | null, by: string) {
  const project = await projectByCode(code);
  // Changed with the record locked: reasons set on two lines at the same moment both stay.
  await updateProjectState<Record<string, LineReason>, null>(project.id, KEY, {}, async (cur, tx) => {
    const all = { ...cur };
    const before = all[line] ?? null;
    if (r) all[line] = { reason: r.reason, note: r.note, by, at: new Date().toISOString() };
    else delete all[line];
    await logAudit(tx, project.id, { entity: "budget_line", entityId: project.id, action: r ? "overspend_reason_set" : "overspend_reason_cleared", by, detail: { line, reason: r?.reason ?? null, note: r?.note ?? null, before: before ? { reason: before.reason, note: before.note } : null } });
    return { data: all, result: null };
  });
}
