import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { realToday } from "@/lib/clock";
import { AWAY_KEY, EMPTY_AWAY, type AwayInput, type AwayState } from "@/lib/delegation";
import type { AppUser } from "@/lib/demo";
import { HttpError } from "@/server/guard";
import { orgIdForPerson } from "@/server/org-settings-store";

/**
 * Who is away and who acts for them (lib/delegation, MF-01), one document per organization. Read
 * by the people list and the authority table (server/auth), so every approval check and every
 * screen sees the delegate as holding the away person's roles for those days.
 */

/** The organization the app runs for: the first one (the app serves one organization per deployment). */
async function firstOrg(): Promise<string | null> {
  const [first] = await db.select({ id: s.organizations.id }).from(s.organizations).orderBy(s.organizations.createdAt).limit(1);
  return first?.id ?? null;
}

export async function loadAway(orgId?: string | null): Promise<AwayState> {
  const org = orgId ?? (await firstOrg());
  if (!org) return EMPTY_AWAY;
  const [row] = await db
    .select()
    .from(s.organizationState)
    .where(and(eq(s.organizationState.organizationId, org), eq(s.organizationState.key, AWAY_KEY)))
    .limit(1);
  const d = (row?.data as Partial<AwayState> | undefined) ?? {};
  return { entries: d.entries ?? [], ...(d.escalateAfterDays !== undefined ? { escalateAfterDays: d.escalateAfterDays } : {}) };
}

async function save(org: string, data: AwayState) {
  await db
    .insert(s.organizationState)
    .values({ organizationId: org, key: AWAY_KEY, data })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data, updatedAt: new Date() } });
}

/** A person records their own time away; an administrator may record it for anyone. */
export const mayRecordAway = (u: AppUser, person: string) => u.kind === "employee" && (u.id === person || !!u.admin);

export async function recordAway(input: AwayInput, by: AppUser, people: AppUser[]) {
  if (!mayRecordAway(by, input.person)) throw new HttpError(403, "You record your own time away. An administrator can record it for someone else.");
  if (!people.some((p) => p.id === input.person && p.kind === "employee")) throw new HttpError(400, "No such person on the staff.");
  if (input.delegate && !people.some((p) => p.id === input.delegate && p.kind === "employee")) throw new HttpError(400, "Choose someone on the staff to act for you.");
  if (input.to < realToday()) throw new HttpError(400, "That time away has already ended.");
  const org = (await orgIdForPerson(by.id)) ?? (await firstOrg());
  if (!org) throw new HttpError(409, "No organization is set up yet.");
  const cur = await loadAway(org);
  const clash = cur.entries.find((a) => a.person === input.person && a.from <= input.to && input.from <= a.to);
  if (clash) throw new HttpError(409, `This overlaps time away already recorded (${clash.from} to ${clash.to}). Change or remove that first.`);
  const entry = { id: randomUUID(), ...input, by: by.id, at: new Date().toISOString() };
  await save(org, { ...cur, entries: [...cur.entries, entry] });
  await db.insert(s.auditLog).values({ projectId: null, entity: "away", entityId: entry.id, action: "away_recorded", detail: { by: by.id, person: input.person, from: input.from, to: input.to, delegate: input.delegate ?? null } });
  return entry;
}

export async function removeAway(id: string, by: AppUser) {
  const org = (await orgIdForPerson(by.id)) ?? (await firstOrg());
  if (!org) throw new HttpError(404, "No such time away.");
  const cur = await loadAway(org);
  const a = cur.entries.find((x) => x.id === id);
  if (!a) throw new HttpError(404, "No such time away.");
  if (!mayRecordAway(by, a.person)) throw new HttpError(403, "Only the person or an administrator removes this.");
  await save(org, { ...cur, entries: cur.entries.filter((x) => x.id !== id) });
  await db.insert(s.auditLog).values({ projectId: null, entity: "away", entityId: id, action: "away_removed", detail: { by: by.id, person: a.person, from: a.from, to: a.to } });
}

/** The organization's setting: days an away person with no delegate waits before their line manager steps in. */
export async function setEscalateDays(days: number, by: AppUser) {
  if (!by.admin) throw new HttpError(403, "Only an administrator changes this.");
  const org = (await orgIdForPerson(by.id)) ?? (await firstOrg());
  if (!org) throw new HttpError(409, "No organization is set up yet.");
  const cur = await loadAway(org);
  await save(org, { ...cur, escalateAfterDays: days });
}
