import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Cited, Decision } from "@/lib/policy";
import { projectByCode } from "@/server/field-store";

/**
 * A project's policy setting, kept as one project_state document: which donor profile it
 * follows (or custom values for a donor not in the library), and the decisions an administrator
 * made on conflicts, with every earlier decision kept in the history.
 */
export type PolicySetting = {
  donor: string | null;
  custom: { name: string; values: Record<string, Cited> } | null;
  decisions: Record<string, Decision>;
  history: (Decision & { key: string })[];
  chosenBy?: { by: string; name: string; at: string };
};

const EMPTY: PolicySetting = { donor: null, custom: null, decisions: {}, history: [] };

export async function loadPolicy(code: string): Promise<PolicySetting> {
  const project = await projectByCode(code);
  const [row] = await db
    .select()
    .from(s.projectState)
    .where(and(eq(s.projectState.projectId, project.id), eq(s.projectState.key, "policy")))
    .limit(1);
  return { ...EMPTY, ...((row?.data as Partial<PolicySetting> | undefined) ?? {}) };
}

export async function savePolicy(code: string, data: PolicySetting) {
  const project = await projectByCode(code);
  await db
    .insert(s.projectState)
    .values({ projectId: project.id, key: "policy", data })
    .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data, updatedAt: new Date() } });
}
