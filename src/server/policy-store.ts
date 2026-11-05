import { and, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { donorById } from "@/lib/donors";
import { MILEAGE_RATE } from "@/lib/expense";
import { ROP, effective, type Cited, type Decision, type Profile } from "@/lib/policy";
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

/** The donor profile a project's setting points to: a library donor, a custom one, or none. */
export const donorOf = (setting: PolicySetting): Profile | null =>
  setting.donor === "custom" && setting.custom ? { id: "custom", name: setting.custom.name, kind: "donor", summary: "Entered for this project.", documents: [], values: setting.custom.values } : donorById(setting.donor);

/**
 * The mileage rate (USD per mile) for each funding source: the donor's rate for that project,
 * else ROP's default. Sources that are not projects (general and admin) use the default.
 */
export async function mileageRates(codes: string[]): Promise<Record<string, { rate: number; from: string }>> {
  const out: Record<string, { rate: number; from: string }> = {};
  const fallback = { rate: Number(ROP.values.mileageRateUsd?.value ?? MILEAGE_RATE), from: "ROP default (US State Department rate)" };
  for (const c of codes) out[c] = fallback;
  if (!codes.length) return out;
  const rows = await db
    .select({ code: s.projects.code, data: s.projectState.data })
    .from(s.projectState)
    .innerJoin(s.projects, eq(s.projects.id, s.projectState.projectId))
    .where(and(eq(s.projectState.key, "policy"), inArray(s.projects.code, codes)));
  for (const r of rows) {
    if (!r.code) continue;
    const setting = { ...EMPTY, ...((r.data as Partial<PolicySetting> | null) ?? {}) };
    const donor = donorOf(setting);
    const line = effective(ROP, donor, setting.decisions).lines.find((l) => l.key === "mileageRateUsd");
    const rate = Number(line?.value);
    if (Number.isFinite(rate) && rate > 0) out[r.code] = { rate, from: line?.donor && donor ? `${donor.name}'s rate` : fallback.from };
  }
  return out;
}
