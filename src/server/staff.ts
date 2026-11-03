import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { users, type AppUser } from "@/lib/demo";

/** The AppUser fields stored in staff.profile: everything except id and name. */
function profileOf(u: AppUser): Omit<AppUser, "id" | "name"> {
  const profile: Partial<AppUser> = { ...u };
  delete profile.id;
  delete profile.name;
  return profile as Omit<AppUser, "id" | "name">;
}

async function orgId() {
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) throw new Error("No organization in the database. Run npm run db:seed first.");
  return org.id;
}

/** Adds or refreshes the demo people as staff profiles. Emails and sign-in links are left alone. */
export async function seedStaff() {
  const organizationId = await orgId();
  for (const u of users) {
    await db
      .insert(s.staff)
      .values({ organizationId, personId: u.id, fullName: u.name, profile: profileOf(u) })
      .onConflictDoUpdate({ target: s.staff.personId, set: { fullName: u.name, profile: profileOf(u), updatedAt: new Date() } });
  }
  return users.length;
}

/**
 * Gives an email access as an existing person (e.g. "tucker", "elena"), or as a new person
 * copied from another's roles. Creates the Supabase Auth account so the person can request a
 * code; nothing is emailed until they do.
 */
export async function addPerson(opts: { email: string; person: string; name?: string; title?: string; org?: string; like?: string }) {
  const email = opts.email.trim().toLowerCase();
  const [existing] = await db.select().from(s.staff).where(eq(s.staff.personId, opts.person)).limit(1);

  if (existing) {
    await db.update(s.staff).set({ email, fullName: opts.name ?? existing.fullName, active: true, updatedAt: new Date() }).where(eq(s.staff.id, existing.id));
  } else {
    if (!opts.like || !opts.name || !opts.title) throw new Error(`No person "${opts.person}". For a new person, pass --name, --title and --like <existing person whose roles to copy>.`);
    const [template] = await db.select().from(s.staff).where(eq(s.staff.personId, opts.like)).limit(1);
    if (!template?.profile) throw new Error(`No person "${opts.like}" to copy roles from.`);
    const base = template.profile as Omit<AppUser, "id" | "name">;
    const profile = { ...base, title: opts.title, org: opts.org ?? base.org, reportsTo: base.reportsTo, feedback: undefined, admin: false };
    await db.insert(s.staff).values({ organizationId: await orgId(), personId: opts.person, fullName: opts.name, email, profile });
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { email, person: opts.person, account: "SUPABASE_SERVICE_ROLE_KEY is not set, so no sign-in account was created yet." };
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } });
  const { error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error && !/already (been )?registered|already exists/i.test(error.message)) throw new Error(`Supabase did not create the sign-in account: ${error.message}`);
  return { email, person: opts.person, account: error ? "already had a sign-in account" : "sign-in account created" };
}

/** Removes someone's access. Their records and audit history stay. */
export async function removePerson(person: string) {
  const r = await db.update(s.staff).set({ active: false, updatedAt: new Date() }).where(eq(s.staff.personId, person)).returning({ id: s.staff.id });
  if (!r.length) throw new Error(`No person "${person}".`);
}
