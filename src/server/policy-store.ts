import { and, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { donorById } from "@/lib/donors";
import { MILEAGE_RATE } from "@/lib/expense";
import type { AgreementLayer } from "@/lib/agreement";
import { ROP, effective, type Approval, type Cited, type Decision, type Profile } from "@/lib/policy";
import { loadOrgSettings, withSettings } from "@/server/org-settings-store";
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
  /** Stricter donor requirements approved to layer on top of the organization's procedures. */
  approvals?: Record<string, Approval>;
  history: (Decision & { key: string; layered?: boolean })[];
  /** Rules read from the signed agreement and confirmed in setup (lib/agreement): for this project they take the place of the donor profile's. */
  agreement?: AgreementLayer;
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

/** The rules a project follows: its organization's rules (with Settings changes) combined with its donor's. */
export async function projectRules(code: string) {
  const project = await projectByCode(code);
  const setting = await loadPolicy(code);
  return effective(withSettings(await loadOrgSettings(project.organizationId)), donorOf(setting), setting.decisions, setting.approvals);
}

/** The donor profile a project's setting points to: a library donor, a custom one, or none. */
export const donorOf = (setting: PolicySetting): Profile | null => {
  const base = setting.donor === "custom" && setting.custom ? { id: "custom", name: setting.custom.name, kind: "donor" as const, summary: "Entered for this project.", documents: [], values: setting.custom.values } : donorById(setting.donor);
  const a = setting.agreement;
  if (!a || !Object.keys(a.values).length) return base;
  // The signed agreement is the better source for this project: its confirmed values take the place of the profile's.
  const values: Record<string, Cited> = { ...(base?.values ?? {}) };
  for (const [k, v] of Object.entries(a.values)) values[k] = { value: v.value, source: `${v.source} (confirmed by ${v.by}, ${v.at.slice(0, 10)})`, confidence: "documented" };
  return {
    id: base?.id ?? "agreement",
    name: base?.name ?? "The agreement",
    kind: "donor",
    summary: base ? `${base.summary} Where the signed agreement says otherwise, its terms apply (${Object.keys(a.values).length} confirmed in setup).` : "The rules read from the signed agreement and confirmed in setup.",
    documents: [...(base?.documents ?? []), ...(a.file ? [{ title: a.file, where: "Uploaded in setup" }] : [])],
    values,
  };
};

/**
 * The mileage rate (USD per mile) for each funding source: the donor's rate for that project,
 * else ROP's default. Sources that are not projects (general and admin) use the default.
 */
export async function mileageRates(codes: string[]): Promise<Record<string, { rate: number; from: string }>> {
  const out: Record<string, { rate: number; from: string }> = {};
  // The organization's default, as set in Settings (one organization for now: the first one's).
  const [first] = await db.select({ id: s.organizations.id }).from(s.organizations).orderBy(s.organizations.createdAt).limit(1);
  const orgs = new Map<string, Profile>();
  const orgFor = async (id: string) => orgs.get(id) ?? orgs.set(id, withSettings(await loadOrgSettings(id))).get(id)!;
  const own = first ? await orgFor(first.id) : ROP;
  const fallback = { rate: Number(own.values.mileageRateUsd?.value ?? MILEAGE_RATE), from: `${own.name} default` };
  for (const c of codes) out[c] = fallback;
  if (!codes.length) return out;
  const rows = await db
    .select({ code: s.projects.code, org: s.projects.organizationId, data: s.projectState.data })
    .from(s.projectState)
    .innerJoin(s.projects, eq(s.projects.id, s.projectState.projectId))
    .where(and(eq(s.projectState.key, "policy"), inArray(s.projects.code, codes)));
  for (const r of rows) {
    if (!r.code) continue;
    const setting = { ...EMPTY, ...((r.data as Partial<PolicySetting> | null) ?? {}) };
    const donor = donorOf(setting);
    const line = effective(await orgFor(r.org), donor, setting.decisions, setting.approvals).lines.find((l) => l.key === "mileageRateUsd");
    const rate = Number(line?.value);
    if (Number.isFinite(rate) && rate > 0) out[r.code] = { rate, from: line?.donor && donor ? `${donor.name}'s rate` : fallback.from };
  }
  return out;
}
