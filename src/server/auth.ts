import { createServerClient } from "@supabase/ssr";
import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { projectRolesFromTypes, type Authority } from "@/lib/authority";
import { HR_ACCESS_ROLES } from "@/lib/hr";
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
  /** The signed-in person's organization. Null only in demo mode, where there is one fictional organization. */
  organizationId: string | null;
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
async function twoStepState(organizationId: string, person: AppUser): Promise<Viewer["twoStep"]> {
  const { data } = await (await supabaseServer()).auth.mfa.getAuthenticatorAssuranceLevel();
  if (!data || data.currentLevel === "aal2") return undefined;
  if (data.nextLevel === "aal2") return "verify";
  const values = withSettings(await loadOrgSettings(organizationId)).values;
  if (values.twoStepRequired?.value === true) return "enroll";
  // People who see personal data: administrators, HR role holders and anyone who sees participants' names.
  if (values.twoStepSensitive?.value === true) {
    const holders = await roleHolders();
    if (person.admin || person.pii || HR_ACCESS_ROLES.some((r) => holders[r]?.includes(person.id))) return "enroll";
  }
  return undefined;
}

/** Who holds each role type, read from the HR record at most once a minute per server. */
let holdersCache: { at: number; holders: Authority } | null = null;
async function roleHolders(): Promise<Authority> {
  if (holdersCache && Date.now() - holdersCache.at < 60_000) return holdersCache.holders;
  const loaded = await (await import("@/server/hr-store")).loadHr().catch(() => null);
  const holders = (loaded?.state.rules?.holders ?? {}) as Authority;
  // A failed read is not remembered, so a database hiccup does not take approvals away for a minute.
  if (loaded) holdersCache = { at: Date.now(), holders };
  return holders;
}
/** Adds the project roles a person has from the role types they hold (lib/authority PROJECT_ROLE_TYPES). */
async function withRoleTypes(u: AppUser): Promise<AppUser> {
  const extra = projectRolesFromTypes(u.id, await roleHolders()).filter((r) => !u.project.includes(r));
  return extra.length ? { ...u, project: [...u.project, ...extra] } : u;
}

export async function getViewer(req: Request): Promise<Viewer | null> {
  const v = await viewerAsStored(req);
  if (!v || v.twoStep) return v;
  const actor = await withRoleTypes(v.actor);
  return { ...v, actor, user: v.viewingAs ? await withRoleTypes(v.user) : actor };
}

async function viewerAsStored(req: Request): Promise<Viewer | null> {
  if (demoMode()) {
    const u = userById(req.headers.get("x-demo-user") ?? "");
    return u ? { user: u, actor: u, actorStaffId: null, organizationId: null, viewingAs: false } : null;
  }
  const row = await signedInStaff();
  if (!row) return null;
  const actor = toAppUser(row);
  const twoStep = await twoStepState(row.organizationId, actor);
  if (twoStep) return { user: actor, actor, actorStaffId: row.id, organizationId: row.organizationId, viewingAs: false, twoStep };
  const asId = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  if (actor.admin && asId && asId !== actor.id) {
    const [target] = await db.select().from(s.staff).where(eq(s.staff.personId, asId)).limit(1);
    // Only someone in the administrator's own organization.
    if (target?.active && target.organizationId === row.organizationId) {
      const viewed = toAppUser(target);
      // View as never unlocks names the signed-in person may not see.
      return { user: { ...viewed, pii: viewed.pii && actor.pii }, actor, actorStaffId: row.id, organizationId: row.organizationId, viewingAs: true };
    }
  }
  return { user: actor, actor, actorStaffId: row.id, organizationId: row.organizationId, viewingAs: false };
}

/** Everyone the app can name: the database staff list in live mode, the fictional cast in demo mode. */
export async function people(): Promise<AppUser[]> {
  if (demoMode()) return users;
  const rows = await db.select().from(s.staff).where(eq(s.staff.active, true));
  return rows.filter((r) => r.personId && r.profile).map(toAppUser);
}

const deny = (status: 401 | 403 | 404, error: string) => NextResponse.json({ error }, { status });

/**
 * Signed-in check for a route. Pass `allow` to require a role; `write` refuses "View as"
 * sessions, which are read-only. Returns the viewer, or the response to send instead.
 */
export async function requireViewer(req: Request, opts: { write?: boolean; allow?: (u: AppUser) => boolean; why?: string } = {}): Promise<Viewer | NextResponse> {
  const v = await getViewer(req);
  if (!v) return deny(401, "Sign in to continue.");
  if (v.twoStep) return deny(401, v.twoStep === "verify" ? "Enter the code from your authenticator app to continue." : "Your organization requires two-step sign-in: set it up to continue.");
  if (opts.write && v.viewingAs) return deny(403, `You are viewing as ${v.user.name}. View as is read-only.`);
  // View as never opens HR, pay or personal files beyond what the administrator may see themselves.
  if (v.viewingAs && /^\/api\/(hr|payroll|files|timesheets|leave|expenses|onboarding|offboarding)(\/|$)/.test(new URL(req.url).pathname)) {
    const holders = await roleHolders();
    if (!HR_ACCESS_ROLES.some((r) => holders[r]?.includes(v.actor.id))) return deny(403, "View as does not open HR records, pay or personal files.");
  }
  if (opts.allow && !opts.allow(v.user)) return deny(403, opts.why ?? "Your role does not allow this.");
  // Per-project access: a person listed on projects has their roles only there.
  const code = new URL(req.url).pathname.match(/^\/api\/projects\/([^/]+)/)?.[1];
  if (code && !onProject(v.user, decodeURIComponent(code))) return deny(403, "You do not work on this project. An administrator can add it to your projects in Settings, People.");
  // The project must belong to the person's own organization. Another organization's project
  // answers exactly as a project that does not exist, so its code cannot be confirmed by guessing.
  if (code && v.organizationId) {
    const org = await organizationOfProject(decodeURIComponent(code));
    if (org && org !== v.organizationId) return deny(404, NO_PROJECT(decodeURIComponent(code)));
  }
  // The sample project is a finished example: everyone can open it, nobody can change it.
  if (code && opts.write && (await isSampleProject(decodeURIComponent(code)))) return deny(403, SAMPLE_READ_ONLY);
  return v;
}

export const SAMPLE_READ_ONLY = "This is the sample project, with fictional data: it can be looked at, not changed. Choose your own project to record or edit.";

/** Whether a project is the sample (projects.kind). A project never changes kind, so the answer is kept. */
const kindOf = new Map<string, string>();
export async function isSampleProject(code: string): Promise<boolean> {
  let kind = kindOf.get(code);
  if (kind === undefined) {
    const [p] = await db.select({ kind: s.projects.kind }).from(s.projects).where(eq(s.projects.code, code)).limit(1);
    kind = p?.kind ?? "real";
    if (p) kindOf.set(code, kind);
  }
  return kind === "sample";
}

/** What a person is told when a project code leads nowhere. */
export const NO_PROJECT = (code: string) => `There is no project ${code} here. Check the address, or choose the project again from Home.`;

/** A project's organization by its code. A project never changes organization, so the answer is kept. */
const orgOfProject = new Map<string, string>();
async function organizationOfProject(code: string): Promise<string | null> {
  const known = orgOfProject.get(code);
  if (known) return known;
  const [p] = await db.select({ org: s.projects.organizationId }).from(s.projects).where(eq(s.projects.code, code)).limit(1);
  if (p?.org) orgOfProject.set(code, p.org);
  return p?.org ?? null;
}

/**
 * The same organization check for routes that take the project from somewhere other than the
 * path (a query or a body): true when this person may act on that project.
 */
export async function inOwnOrganization(v: Viewer, code: string): Promise<boolean> {
  if (!v.organizationId) return true;
  const org = await organizationOfProject(code);
  return !org || org === v.organizationId;
}

export const isEmployee = (u: AppUser) => u.kind === "employee";
/** Sample project codes (C5) start with this; a project made in setup cannot (its letters are at most four). */
export const SAMPLE_PREFIX = "SAMPLE-";
/** Whether a person works on a project: everyone without a project list does; administrators always do. Everyone may open the sample. */
export const onProject = (u: AppUser, code: string) => !u.projects?.length || u.projects.includes(code) || !!u.admin || code.startsWith(SAMPLE_PREFIX);
export const isMelOwner = (u: AppUser) => u.project.includes("mel-owner");
