import { z } from "zod";
import type { AppUser } from "@/lib/demo";

/**
 * Backup approvers (review round 1, MF-01). A person who will be away records when, and who acts
 * for them. For those days the delegate holds the away person's approval roles too, so work that
 * waits on the away person reaches the delegate, and what the delegate signs says "on behalf of".
 * With no delegate named, the away person's line manager steps in once they have been away for a
 * set number of days (`escalateAfterDays`, an organization setting, 3 by default), so nothing waits
 * for weeks. The board approves the authority table as the written delegation (D-13): this only
 * moves an approval to someone the table already trusts with the same work while its holder is away.
 *
 * Kept in organization_state ("away"). Administrator rights are never delegated.
 */

export const AWAY_KEY = "away";
export const DEFAULT_ESCALATE_DAYS = 3;

export type Away = { id: string; person: string; from: string; to: string; delegate?: string; note?: string; by: string; at: string };
export type AwayState = { entries: Away[]; escalateAfterDays?: number };
export const EMPTY_AWAY: AwayState = { entries: [] };

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.");
export const awayInput = z
  .object({ person: z.string().min(1).max(60), from: iso, to: iso, delegate: z.string().min(1).max(60).optional(), note: z.string().trim().max(300).optional() })
  .refine((a) => a.from <= a.to, { message: "The last day away is before the first.", path: ["to"] })
  .refine((a) => a.delegate !== a.person, { message: "Choose someone else to act for you.", path: ["delegate"] });
export type AwayInput = z.infer<typeof awayInput>;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Who acts for whom today: delegate id to the people they act for. */
export function actingMap(state: AwayState, people: Pick<AppUser, "id" | "reportsTo">[], today: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (who: string, forWhom: string) => out.set(who, [...(out.get(who) ?? []), forWhom]);
  const escalate = state.escalateAfterDays ?? DEFAULT_ESCALATE_DAYS;
  for (const a of state.entries) {
    if (today < a.from || today > a.to) continue;
    if (a.delegate) add(a.delegate, a.person);
    else {
      // No delegate: the line manager, once the person has been away long enough.
      const boss = people.find((p) => p.id === a.person)?.reportsTo;
      if (boss && today >= addDays(a.from, escalate)) add(boss, a.person);
    }
  }
  return out;
}

/** Whether this person is away today, and the entry saying so. */
export const awayToday = (state: AwayState, person: string, today: string) => state.entries.find((a) => a.person === person && today >= a.from && today <= a.to) ?? null;

const union = <T,>(a: T[], b: T[]) => [...new Set([...a, ...b])];
const ACCESS = ["none", "view", "edit"] as const;
const higher = <A extends string>(a: A, b: A) => (ACCESS.indexOf(a as (typeof ACCESS)[number]) >= ACCESS.indexOf(b as (typeof ACCESS)[number]) ? a : b);

/**
 * The people with their roles while someone is away: each delegate also holds the roles of the
 * people they act for (field, procurement and project roles, access and projects), and says whom
 * they act for. Administrator rights and participant-name access are never passed on.
 */
export type Own = Pick<AppUser, "field" | "procurement" | "project" | "fieldAccess" | "procurementAccess" | "projects">;
export function withDelegation<U extends AppUser>(people: U[], state: AwayState, today: string): (U & { actingFor?: { id: string; name: string }[]; own?: Own })[] {
  const acting = actingMap(state, people, today);
  if (!acting.size) return people;
  return people.map((p) => {
    const forWhom = (acting.get(p.id) ?? []).map((id) => people.find((x) => x.id === id)).filter((x): x is U => !!x);
    if (!forWhom.length) return p;
    // Their own roles are kept beside, so what they sign with a borrowed role says so (signedName).
    const own: Own = { field: p.field, procurement: p.procurement, project: p.project, fieldAccess: p.fieldAccess, procurementAccess: p.procurementAccess, projects: p.projects };
    return forWhom.reduce<U & { actingFor?: { id: string; name: string }[]; own?: Own }>(
      (u, o) => ({
        ...u,
        field: union(u.field, o.field),
        procurement: union(u.procurement, o.procurement),
        project: union(u.project, o.project),
        fieldAccess: higher(u.fieldAccess, o.fieldAccess),
        procurementAccess: higher(u.procurementAccess, o.procurementAccess),
        // A person on every project (no list) stays on every project; otherwise both lists.
        ...(u.projects && o.projects ? { projects: union(u.projects, o.projects) } : u.projects ? { projects: undefined } : {}),
        actingFor: [...(u.actingFor ?? []), { id: o.id, name: o.name }],
      }),
      { ...p, own },
    );
  });
}

/** The authority table with each delegate added beside the role types the people they act for hold. */
export function holdersWithDelegation<T extends Partial<Record<string, string[]>>>(holders: T, state: AwayState, people: Pick<AppUser, "id" | "reportsTo">[], today: string): T {
  const acting = actingMap(state, people, today);
  if (!acting.size) return holders;
  const out: Record<string, string[]> = {};
  for (const [type, ids] of Object.entries(holders)) {
    const extra = [...acting.entries()].filter(([, forWhom]) => forWhom.some((f) => ids?.includes(f))).map(([d]) => d);
    out[type] = union(ids ?? [], extra);
  }
  return out as T;
}

/** The person as they are without anything they hold for someone away. */
export const ownSelf = <U extends AppUser & { own?: Own }>(u: U): U => (u.own ? { ...u, ...u.own } : u);

/**
 * "Nadia Rahimi on behalf of Karim Ahmadi" when the person may do this only while acting for
 * someone (`may` refuses their own roles); their own name otherwise.
 */
export function signedName<U extends AppUser & { actingFor?: { name: string }[]; own?: Own }>(u: U, may: (x: U) => boolean): string {
  if (!u.actingFor?.length || may(ownSelf(u))) return u.name;
  return `${u.name} on behalf of ${u.actingFor.map((a) => a.name).join(" and ")}`;
}
