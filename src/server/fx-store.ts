import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { EMPTY_FX, FX_KEY, registerRates, type FxInput, type FxState } from "@/lib/fx";
import type { AppUser } from "@/lib/demo";
import { holdsType } from "@/lib/authority";
import { HttpError } from "@/server/guard";
import { orgIdForPerson } from "@/server/org-settings-store";
import { oncePerRequest } from "@/server/request-memo";

/** The organization's monthly exchange rates (lib/fx, MF-11), one document per organization. */
async function org(personId?: string): Promise<string | null> {
  if (personId) return orgIdForPerson(personId);
  const [first] = await db.select({ id: s.organizations.id }).from(s.organizations).orderBy(s.organizations.createdAt).limit(1);
  return first?.id ?? null;
}

export async function loadFx(orgId?: string | null): Promise<FxState> {
  const id = orgId ?? (await org());
  if (!id) return EMPTY_FX;
  const [row] = await db.select().from(s.organizationState).where(and(eq(s.organizationState.organizationId, id), eq(s.organizationState.key, FX_KEY))).limit(1);
  return { rates: ((row?.data as Partial<FxState> | undefined)?.rates ?? []) };
}

/** Reads the rates once per request and registers them, so the money helpers use this month's rate. */
export async function ratesNow(): Promise<FxState> {
  const st = await oncePerRequest("fx", () => loadFx().catch(() => EMPTY_FX));
  registerRates(st.rates);
  return st;
}

/** Finance (or an administrator) records a month's rate; a month's rate can be replaced, and the change is kept. */
export const mayRecordRates = (u: AppUser) => u.kind === "employee" && (!!u.admin || u.procurement.includes("finance") || holdsType(u.id, "finance") || holdsType(u.id, "cfo"));

export async function recordRate(input: FxInput, by: AppUser) {
  if (!mayRecordRates(by)) throw new HttpError(403, "Only finance records the month's exchange rate.");
  const id = await org(by.id);
  if (!id) throw new HttpError(409, "No organization is set up yet.");
  const cur = await loadFx(id);
  const before = cur.rates.find((r) => r.currency === input.currency && r.month === input.month) ?? null;
  const rates = [...cur.rates.filter((r) => r !== before), { ...input, by: by.id, byName: by.name, at: new Date().toISOString() }];
  await db
    .insert(s.organizationState)
    .values({ organizationId: id, key: FX_KEY, data: { rates } })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data: { rates }, updatedAt: new Date() } });
  await db.insert(s.auditLog).values({ projectId: null, entity: "fx-rate", entityId: crypto.randomUUID(), action: "fx_rate_set", detail: { by: by.id, ...input, before: before ? before.perUsd : null } });
  registerRates(rates);
  return { rates };
}
