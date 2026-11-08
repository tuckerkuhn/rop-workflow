import { createServerClient } from "@supabase/ssr";
import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { loadOrgSettings, withSettings } from "@/server/org-settings-store";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { userById, users, type AppUser } from "@/lib/demo";

/**
 * Who is making a request.
 *
 * Live mode (default): the Supabase Auth session cookie, matched to a row in `staff`.
 * Demo mode (DEMO_SIGN_IN=1): the person picked in the browser, sent as the x-demo-user header.
 * Demo mode is for laptops and demo copies on a database of fictional data only.
 */

export const demoMode = () => process.env.DEMO_SIGN_IN === "1";
/** Live sign-in needs the Supabase URL and public key; without them nobody can sign in. */
export const authConfigured = () => !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export const VIEW_AS_COOKIE = "rop-view-as";

export type Viewer = {
  /** Whose screens are shown. Under "View as", the viewed person, with names only if the actor may see them. */
  user: AppUser;
  /** Who is actually signed in. */
  actor: AppUser;
  actorStaffId: string | null;
  viewingAs: boolean;
  /**
   * Live sign-in only: the second step still to do. "verify": the person has an authenticator app
   * set up and has not entered its code this session. "enroll": the organization requires one and
   * they have none yet. Every API refuses until it is done; only the session answers.
   */
  twoStep?: "verify" | "enroll";
};

type StaffRow = typeof s.staff.$inferSelect;
export const toAppUser = (row: StaffRow): AppUser => ({ ...(row.profile as Omit<AppUser, "id" | "name">), id: row.personId ?? row.id, name: row.fullName });

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // Route handlers can set cookies; server components cannot, and the middleware refreshes them there.
        try {
          for (const c of list) store.set(c.name, c.value, c.options);
        } catch {}
      },
    },
  });
}

/** The signed-in staff row, linking the Auth account by email on first sign-in. */
async function signedInStaff(): Promise<StaffRow | null> {
  if (!authConfigured()) return null;
  const { data } = await (await supabaseServer()).auth.getUser();
  const auth = data.user;
  if (!auth?.email) return null;
  const [byId] = await db.select().from(s.staff).where(eq(s.staff.authUserId, auth.id)).limit(1);
  if (byId) return byId.active ? byId : null;
  const [byEmail] = await db.select().from(s.staff).where(sql`lower(${s.staff.email}) = ${auth.email.toLowerCase()}`).limit(1);
  if (!byEmail?.active) return null;
  await db.update(s.staff).set({ authUserId: auth.id, updatedAt: new Date() }).where(eq(s.staff.id, byEmail.id));
  return byEmail;
}

/** Whether this session still owes its second step (see Viewer.twoStep). */
async function twoStepState(organizationId: string): Promise<Viewer["twoStep"]> {
  const { data } = await (await supabaseServer()).auth.mfa.getAuthenticatorAssuranceLevel();
  if (!data || data.currentLevel === "aal2") return undefined;
  if (data.nextLevel === "aal2") return "verify";
  const required = withSettings(await loadOrgSettings(organizationId)).values.twoStepRequired?.value === true;
  return required ? "enroll" : undefined;
}

export async function getViewer(req: Request): Promise<Viewer | null> {
  if (demoMode()) {
    const u = userById(req.headers.get("x-demo-user") ?? "");
    return u ? { user: u, actor: u, actorStaffId: null, viewingAs: false } : null;
  }
  const row = await signedInStaff();
  if (!row) return null;
  const actor = toAppUser(row);
  const twoStep = await twoStepState(row.organizationId);
  if (twoStep) return { user: actor, actor, actorStaffId: row.id, viewingAs: false, twoStep };
  const asId = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  if (actor.admin && asId && asId !== actor.id) {
    const [target] = await db.select().from(s.staff).where(eq(s.staff.personId, asId)).limit(1);
    if (target?.active) {
      const viewed = toAppUser(target);
      // View as never unlocks names the signed-in person may not see.
      return { user: { ...viewed, pii: viewed.pii && actor.pii }, actor, actorStaffId: row.id, viewingAs: true };
    }
  }
  return { user: actor, actor, actorStaffId: row.id, viewingAs: false };
}

/** Everyone the app can name: the database staff list in live mode, the fictional cast in demo mode. */
export async function people(): Promise<AppUser[]> {
  if (demoMode()) return users;
  const rows = await db.select().from(s.staff).where(eq(s.staff.active, true));
  return rows.filter((r) => r.personId && r.profile).map(toAppUser);
}

const deny = (status: 401 | 403, error: string) => NextResponse.json({ error }, { status });

/**
 * Signed-in check for a route. Pass `allow` to require a role; `write` refuses "View as"
 * sessions, which are read-only. Returns the viewer, or the response to send instead.
 */
export async function requireViewer(req: Request, opts: { write?: boolean; allow?: (u: AppUser) => boolean; why?: string } = {}): Promise<Viewer | NextResponse> {
  const v = await getViewer(req);
  if (!v) return deny(401, "Sign in to continue.");
  if (v.twoStep) return deny(401, v.twoStep === "verify" ? "Enter the code from your authenticator app to continue." : "Your organization requires two-step sign-in: set it up to continue.");
  if (opts.write && v.viewingAs) return deny(403, `You are viewing as ${v.user.name}. View as is read-only.`);
  if (opts.allow && !opts.allow(v.user)) return deny(403, opts.why ?? "Your role does not allow this.");
  // Per-project access: a person listed on projects has their roles only there.
  const code = new URL(req.url).pathname.match(/^\/api\/projects\/([^/]+)/)?.[1];
  if (code && !onProject(v.user, decodeURIComponent(code))) return deny(403, "You do not work on this project. An administrator can add it to your projects in Settings, People.");
  return v;
}

export const isEmployee = (u: AppUser) => u.kind === "employee";
/** Whether a person works on a project: everyone without a project list does; administrators always do. */
export const onProject = (u: AppUser, code: string) => !u.projects?.length || u.projects.includes(code) || !!u.admin;
export const isMelOwner = (u: AppUser) => u.project.includes("mel-owner");
