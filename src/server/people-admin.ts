import { createClient } from "@supabase/supabase-js";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { describeChange, type PersonInput } from "@/lib/access";
import type { AppUser } from "@/lib/demo";

/**
 * The people screen's store: staff rows (one per person who may sign in) and the change log.
 * Every change is written to audit_log (entity "staff") with who made it and what changed.
 * A person is never deleted: turning access off keeps their history.
 */

type Row = typeof s.staff.$inferSelect;
type Profile = Partial<Omit<AppUser, "id" | "name">>;

export function personOf(r: Row): PersonInput & { id: string; active: boolean; signedIn: boolean } {
  const p = (r.profile ?? {}) as Profile;
  return {
    id: r.personId ?? r.id,
    name: r.fullName,
    title: p.title ?? "",
    email: r.email,
    kind: p.kind ?? "employee",
    org: p.org ?? "Roots of Peace",
    reportsTo: p.reportsTo ?? null,
    lang: p.lang ?? "en",
    project: p.project ?? [],
    field: p.field ?? [],
    fieldAccess: p.fieldAccess ?? "none",
    procurement: p.procurement ?? [],
    procurementAccess: p.procurementAccess ?? "none",
    pii: !!p.pii,
    admin: !!p.admin,
    leads: p.leads ?? [],
    active: r.active,
    signedIn: !!r.authUserId,
  };
}

const profileOf = (p: PersonInput, old: Profile): Profile => ({
  ...old,
  title: p.title,
  kind: p.kind,
  org: p.org,
  reportsTo: p.reportsTo ?? undefined,
  lang: p.lang,
  project: p.project,
  field: p.field,
  fieldAccess: p.fieldAccess,
  procurement: p.procurement,
  procurementAccess: p.procurementAccess,
  pii: p.pii,
  admin: p.admin,
  leads: p.leads.length ? p.leads : undefined,
});

export async function listPeople() {
  const rows = await db.select().from(s.staff).orderBy(s.staff.fullName);
  return rows.filter((r) => r.personId).map(personOf);
}

async function rowOf(id: string) {
  const [r] = await db.select().from(s.staff).where(eq(s.staff.personId, id)).limit(1);
  return r ?? null;
}

async function log(staffId: string, action: string, by: { id: string; staffId: string | null }, detail: Record<string, unknown>) {
  await db.insert(s.auditLog).values({ entity: "staff", entityId: staffId, action, actorId: by.staffId, detail: { by: by.id, ...detail } });
}

export class PeopleError extends Error {}

async function emailTaken(email: string | null, exceptId?: string) {
  if (!email) return false;
  const [r] = await db
    .select({ id: s.staff.id })
    .from(s.staff)
    .where(and(sql`lower(${s.staff.email}) = ${email.toLowerCase()}`, exceptId ? ne(s.staff.id, exceptId) : sql`true`))
    .limit(1);
  return !!r;
}

/** A short id from the name, unique among staff: "Ahmad Shah Shafaq" → "ahmad-shah" or "ahmad-shah-2". */
async function newId(name: string) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 2).join("-") || "person";
  for (let k = 1; k < 100; k++) {
    const id = k === 1 ? base : `${base}-${k}`;
    if (!(await rowOf(id))) return id;
  }
  throw new PeopleError("Could not make an id for this person.");
}

export async function addPerson(p: PersonInput, by: { id: string; staffId: string | null }) {
  if (await emailTaken(p.email)) throw new PeopleError("Someone already has that email.");
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) throw new PeopleError("No organization in the database.");
  const personId = await newId(p.name);
  const [r] = await db.insert(s.staff).values({ organizationId: org.id, personId, fullName: p.name, email: p.email, profile: profileOf(p, {}) }).returning();
  await log(r.id, "add", by, { person: personId, changes: describeChange(null, p) });
  return personId;
}

export async function updatePerson(id: string, p: PersonInput, by: { id: string; staffId: string | null }) {
  const r = await rowOf(id);
  if (!r) throw new PeopleError("No such person.");
  const before = personOf(r);
  if (await emailTaken(p.email, r.id)) throw new PeopleError("Someone else already has that email.");
  if (before.admin && !p.admin && (await activeAdmins()).filter((x) => x !== id).length === 0) throw new PeopleError("This is the last administrator. Make someone else an administrator first.");
  const changes = describeChange(before, p);
  if (!changes.length) return [];
  // A new email means a different sign-in: unlink the old account.
  const relink = (before.email ?? "") !== (p.email ?? "");
  await db
    .update(s.staff)
    .set({ fullName: p.name, email: p.email, profile: profileOf(p, (r.profile ?? {}) as Profile), ...(relink ? { authUserId: null } : {}), updatedAt: new Date() })
    .where(eq(s.staff.id, r.id));
  await log(r.id, "update", by, { person: id, changes });
  return changes;
}

async function activeAdmins() {
  return (await listPeople()).filter((x) => x.active && x.admin).map((x) => x.id);
}

export async function setActive(id: string, active: boolean, by: { id: string; staffId: string | null }) {
  const r = await rowOf(id);
  if (!r) throw new PeopleError("No such person.");
  if (!active && personOf(r).admin && (await activeAdmins()).filter((x) => x !== id).length === 0) throw new PeopleError("This is the last administrator.");
  await db.update(s.staff).set({ active, updatedAt: new Date() }).where(eq(s.staff.id, r.id));
  await log(r.id, active ? "reactivate" : "deactivate", by, { person: id, changes: [active ? "Access turned back on" : "Access turned off"] });
}

/** Whether this server can create sign-in accounts itself. */
export const canCreateAccounts = () => !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL;

/** Creates the Supabase sign-in account for the person's email; nothing is emailed until they ask for a code. */
export async function createAccount(id: string, by: { id: string; staffId: string | null }) {
  const r = await rowOf(id);
  if (!r?.email) throw new PeopleError("Add an email first.");
  if (!canCreateAccounts()) throw new PeopleError("This server cannot create sign-in accounts: add the email in the Supabase dashboard (Authentication, Users, Add user), or set SUPABASE_SERVICE_ROLE_KEY.");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { error } = await admin.auth.admin.createUser({ email: r.email, email_confirm: true });
  const already = !!error && /already (been )?registered|already exists/i.test(error.message);
  if (error && !already) throw new PeopleError(`Supabase did not create the account: ${error.message}`);
  await log(r.id, "account", by, { person: id, changes: [already ? "Sign-in account already existed" : "Sign-in account created"] });
  return already ? "already had a sign-in account" : "sign-in account created";
}

/** The latest changes to people, newest first. */
export async function changeLog(limit = 50) {
  const rows = await db
    .select({ at: s.auditLog.at, action: s.auditLog.action, detail: s.auditLog.detail })
    .from(s.auditLog)
    .where(eq(s.auditLog.entity, "staff"))
    .orderBy(desc(s.auditLog.at))
    .limit(limit);
  return rows.map((r) => {
    const d = (r.detail ?? {}) as { by?: string; person?: string; changes?: string[] };
    return { at: r.at.toISOString(), action: r.action, by: d.by ?? "", person: d.person ?? "", changes: d.changes ?? [] };
  });
}
