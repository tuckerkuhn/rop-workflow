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

/**
 * Whether this person is the one the project names to approve KoboCollect data: for example the
 * Director of MEL. That person vouches for field data, so they are shown where a weekly photo was
 * taken (decision V, 25 Nov 2026). The stand-in and a role group are not: the place of a photo
 * can be where a farmer lives, so it goes to one named person and no further.
 */
export async function vouchesForFieldData(code: string, u: { id: string } | null | undefined): Promise<boolean> {
  if (!u) return false;
  const rule = await koboApprovalFor(code);
  return rule.who === "named" && !!rule.person && rule.person === u.id;
}
