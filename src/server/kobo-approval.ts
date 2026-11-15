import { DEFAULT_KOBO_APPROVAL, KOBO_APPROVAL_KEY, type KoboApproval } from "@/lib/kobo-approval";
import { projectByCode } from "@/server/field-store";
import { loadProjectState, saveProjectState } from "@/server/project-state";

/** The project's rule for who approves KoboCollect data (lib/kobo-approval): the MEL role until someone chooses. */
export async function koboApprovalFor(code: string): Promise<KoboApproval> {
  const project = await projectByCode(code);
  return loadProjectState<KoboApproval>(project.id, KOBO_APPROVAL_KEY, DEFAULT_KOBO_APPROVAL);
}

export async function saveKoboApproval(code: string, rule: KoboApproval) {
  const project = await projectByCode(code);
  await saveProjectState(project.id, KOBO_APPROVAL_KEY, rule);
}
