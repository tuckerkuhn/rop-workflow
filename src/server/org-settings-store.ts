import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ROP, type Profile, type Value } from "@/lib/policy";
import { profileById } from "@/lib/presets";

/**
 * The organization's own rules as changed in Settings, kept as one organization_state document.
 * The written policy (lib/policy.ts, ROP) stays the base; each change records who made it, when
 * and why, and every change is kept in the history.
 */
export type OrgChange = { key: string; value: Value; by: string; name: string; at: string; reason: string; preset?: string; reset?: boolean };
/** Solo mode (B2): a small team's one person may prepare and approve, confirming it each time. Off unless an administrator turns it on. */
export type SoloChange = { on: boolean; by: string; name: string; at: string; reason: string };
export type OrgSettings = { values: Record<string, OrgChange>; history: OrgChange[]; solo?: SoloChange; soloHistory?: SoloChange[] };

const EMPTY: OrgSettings = { values: {}, history: [] };

export async function loadOrgSettings(orgId: string): Promise<OrgSettings> {
  try {
    const [row] = await db
      .select()
      .from(s.organizationState)
      .where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, "settings")))
      .limit(1);
    return { ...EMPTY, ...((row?.data as Partial<OrgSettings> | undefined) ?? {}) };
  } catch (e) {
    // Before migration 0020 runs there is no table yet: the written policy applies unchanged.
    if ((e as { code?: string }).code === "42P01" || (e as { cause?: { code?: string } }).cause?.code === "42P01") return EMPTY;
    throw e;
  }
}

export async function saveOrgSettings(orgId: string, data: OrgSettings) {
  await db
    .insert(s.organizationState)
    .values({ organizationId: orgId, key: "settings", data })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data, updatedAt: new Date() } });
}

/** The organization's rules in force: the written policy with the changes made in Settings. */
export function withSettings(settings: OrgSettings, base: Profile = ROP): Profile {
  const values = { ...base.values };
  for (const c of Object.values(settings.values))
    values[c.key] = { value: c.value, source: `${c.preset ? `Layered on from the ${profileById(c.preset)?.name ?? c.preset} profile` : "Added in Settings"}, approved by ${c.name}, ${c.at}: ${c.reason}` };
  return { ...base, values };
}

export async function orgProfile(orgId: string): Promise<Profile> {
  return withSettings(await loadOrgSettings(orgId));
}

/**
 * The organization a signed-in person belongs to. People from the sample team, who have no
 * staff row, see the only organization there is.
 */
export async function orgIdForPerson(personId: string): Promise<string | null> {
  const [me] = await db.select({ org: s.staff.organizationId }).from(s.staff).where(eq(s.staff.personId, personId)).limit(1);
  if (me) return me.org;
  const [first] = await db.select({ id: s.organizations.id }).from(s.organizations).orderBy(s.organizations.createdAt).limit(1);
  return first?.id ?? null;
}
