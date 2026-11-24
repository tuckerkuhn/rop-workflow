import { setRequestFileStores } from "@/server/request-memo";
import { createServerClient } from "@supabase/ssr";
import { eq, inArray, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { projectRolesFromTypes, type Authority } from "@/lib/authority";
import { HR_ACCESS_ROLES } from "@/lib/hr";
import { fileStoresFor, loadOrgSettings, storesFromSettings, withSettings, type OrgSettings } from "@/server/org-settings-store";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { userById, users, type AppUser } from "@/lib/demo";
import { supervisorsNow, withReportingLine } from "@/server/reporting-line";
import { oncePerRequest, requestOnlyReads } from "@/server/request-memo";
import { early } from "@/server/early";

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

type Supabase = Awaited<ReturnType<typeof supabaseServer>>;

/** The signed-in staff row, linking the Auth account by email on first sign-in. */
async function signedInStaff(supabase: Supabase): Promise<StaffRow | null> {
  const { data } = await supabase.auth.getUser();
  const auth = data.user;
  if (!auth?.email) return null;
  const [byId] = await db.select().from(s.staff).where(eq(s.staff.authUserId, auth.id)).limit(1);
  if (byId) return byId.active ? byId : null;
  const [byEmail] = await db.select().from(s.staff).where(sql`lower(${s.staff.email}) = ${auth.email.toLowerCase()}`).limit(1);
  if (!byEmail?.active) return null;
  await db.update(s.staff).set({ authUserId: auth.id, updatedAt: new Date() }).where(eq(s.staff.id, byEmail.id));
  return byEmail;
}

/**
 * A read started ahead (server/early): marked as handled, so one left unread after an early answer
 * does not crash the server; awaiting it still throws. Through Promise.resolve, so a query builder
 * runs once: a Drizzle query runs again each time `then` or `catch` is called on it.
 */
const ahead = early;

/** Whether this session still owes its second step (see Viewer.twoStep). `settings`: the organization's settings, already being read. */
async function twoStepState(supabase: Supabase, settings: Promise<OrgSettings>, person: AppUser): Promise<Viewer["twoStep"]> {
  // Read from the session the Auth check above has just confirmed (and refreshed, if it was due).
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!data || data.currentLevel === "aal2") return undefined;
  if (data.nextLevel === "aal2") return "verify";
  const values = withSettings(await settings).values;
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
/** A read under way, shared by everyone who asks meanwhile (sign-in reads it ahead; see viewerAsStored). */
let holdersReading: Promise<Authority> | null = null;
async function roleHolders(): Promise<Authority> {
  if (holdersCache && Date.now() - holdersCache.at < 60_000) return holdersCache.holders;
  holdersReading ??= (async () => {
    const loaded = await (await import("@/server/hr-store")).loadHr().catch(() => null);
    const holders = (loaded?.state.rules?.holders ?? {}) as Authority;
    // A failed read is not remembered, so a database hiccup does not take approvals away for a minute.
    if (loaded) holdersCache = { at: Date.now(), holders };
    return holders;
  })().finally(() => {
    holdersReading = null;
  });
  return holdersReading;
}
/** Adds the project roles a person has from the role types they hold (lib/authority PROJECT_ROLE_TYPES). */
async function withRoleTypes(u: AppUser): Promise<AppUser> {
  const extra = projectRolesFromTypes(u.id, await roleHolders()).filter((r) => !u.project.includes(r));
  return extra.length ? { ...u, project: [...u.project, ...extra] } : u;
}

export async function getViewer(req: Request): Promise<Viewer | null> {
  return (await resolveViewer(req)).viewer;
}

/**
 * The viewer, with the organization's settings as read during sign-in (live mode), so the file
 * stores need not read them a second time. The settings are read while the rest is checked.
 */
async function resolveViewer(req: Request): Promise<{ viewer: Viewer | null; settings: Promise<OrgSettings> | null }> {
  const stored = await viewerAsStored(req);
  const v = stored.viewer;
  if (!v || v.twoStep) return stored;
  const actor = await withRoleTypes(v.actor);
  return { viewer: { ...v, actor, user: v.viewingAs ? await withRoleTypes(v.user) : actor }, settings: stored.settings };
}

async function viewerAsStored(req: Request): Promise<{ viewer: Viewer | null; settings: Promise<OrgSettings> | null }> {
  if (demoMode()) {
    const u = userById(req.headers.get("x-demo-user") ?? "");
    return { viewer: u ? { user: u, actor: u, actorStaffId: null, organizationId: null, viewingAs: false } : null, settings: null };
  }
  if (!authConfigured()) return { viewer: null, settings: null };
  const supabase = await supabaseServer();
  const row = await signedInStaff(supabase);
  if (!row) return { viewer: null, settings: null };
  const actor = toAppUser(row);
  // Read now, side by side: the organization's settings (second step, file stores), who holds which
  // role (project roles from role types), and the person an administrator is viewing as.
  const settings = ahead(loadOrgSettings(row.organizationId));
  void roleHolders();
  const asId = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  const viewed = actor.admin && asId && asId !== actor.id ? ahead(db.select().from(s.staff).where(eq(s.staff.personId, asId)).limit(1)) : null;
  const twoStep = await twoStepState(supabase, settings, actor);
  if (twoStep) return { viewer: { user: actor, actor, actorStaffId: row.id, organizationId: row.organizationId, viewingAs: false, twoStep }, settings };
  if (viewed) {
    const [target] = await viewed;
    // Only someone in the administrator's own organization.
    if (target?.active && target.organizationId === row.organizationId) {
      const shown = toAppUser(target);
      // View as never unlocks names the signed-in person may not see.
      return { viewer: { user: { ...shown, pii: shown.pii && actor.pii }, actor, actorStaffId: row.id, organizationId: row.organizationId, viewingAs: true }, settings };
    }
  }
  return { viewer: { user: actor, actor, actorStaffId: row.id, organizationId: row.organizationId, viewingAs: false }, settings };
}

/** Everyone the app can name: the database staff list in live mode, the fictional cast in demo mode. */
export function people(): Promise<AppUser[]> {
  // Read once per read-only request (server/request-memo); a request that changes something reads it every time.
  return oncePerRequest(`people:${demoMode() ? "demo" : "live"}`, async () => {
    // Who reports to whom comes from the HR record when there is one (server/reporting-line).
    if (demoMode()) return withReportingLine(users);
    // The staff list and the reporting line, read side by side; applied as withReportingLine does.
    const [rows, line] = await Promise.all([db.select().from(s.staff).where(eq(s.staff.active, true)), supervisorsNow()]);
    return rows
      .filter((r) => r.personId && r.profile)
      .map(toAppUser)
      .map((p) => (line[p.id] && line[p.id] !== p.reportsTo ? { ...p, reportsTo: line[p.id] } : p));
  });
}

const deny = (status: 401 | 403 | 404, error: string) => NextResponse.json({ error }, { status });

/**
 * Signed-in check for a route. Pass `allow` to require a role; `write` refuses "View as"
 * sessions, which are read-only. Returns the viewer, or the response to send instead.
 */
/** The projects an organization funds, by its name as a donor on them (codes). */
export async function fundedBy(org: string): Promise<Set<string>> {
  const rows = await db.select({ code: s.projects.code }).from(s.donors).innerJoin(s.projects, eq(s.projects.id, s.donors.projectId)).where(eq(s.donors.name, org));
  return new Set(rows.map((r) => r.code).filter((c): c is string => !!c));
}

export async function requireViewer(req: Request, opts: { write?: boolean; allow?: (u: AppUser) => boolean; why?: string } = {}): Promise<Viewer | NextResponse> {
  // A read may reuse what it has already read in this request (server/request-memo); a change never does.
  if (req.method === "GET") requestOnlyReads();
  const { viewer: v, settings } = await resolveViewer(req);
  if (!v) return deny(401, "Sign in to continue.");
  if (v.twoStep) return deny(401, v.twoStep === "verify" ? "Enter the code from your authenticator app to continue." : "Your organization requires two-step sign-in: set it up to continue.");
  const path = new URL(req.url).pathname;
  const code = path.match(/^\/api\/projects\/([^/]+)/)?.[1];
  // What the checks below need is read side by side; the checks still run one by one, in this order.
  const decoded = code ? decodedOrNull(code) : null;
  const project = decoded ? ahead(projectRow(decoded)) : null;
  const funded = decoded && v.user.kind === "donor" ? ahead(fundedBy(v.user.org)) : null;
  // Evidence links in this request are checked against this person's organization's file stores,
  // from the settings already read at sign-in when there are some.
  setRequestFileStores(v.organizationId && settings ? storesFromSettings(await settings) : await fileStoresFor(v.user.id, v.organizationId));
  if (opts.write && v.viewingAs) return deny(403, `You are viewing as ${v.user.name}. View as is read-only.`);
  // View as never opens HR, pay or personal files beyond what the administrator may see themselves.
  if (v.viewingAs && /^\/api\/(hr|payroll|files|timesheets|leave|expenses|onboarding|offboarding)(\/|$)/.test(path)) {
    const holders = await roleHolders();
    if (!HR_ACCESS_ROLES.some((r) => holders[r]?.includes(v.actor.id))) return deny(403, "View as does not open HR records, pay or personal files.");
  }
  if (opts.allow && !opts.allow(v.user)) return deny(403, opts.why ?? "Your role does not allow this.");
  // Per-project access: a person listed on projects has their roles only there.
  if (code && !onProject(v.user, decodeURIComponent(code))) return deny(403, "You do not work on this project. An administrator can add it to your projects in Settings, People.");
  // A donor opens only the projects their organization funds; any other answers as if it were not there.
  if (code && v.user.kind === "donor" && !(await (funded ?? fundedBy(v.user.org))).has(decodeURIComponent(code))) return deny(404, NO_PROJECT(decodeURIComponent(code)));
  const row = code ? await (project ?? projectRow(decodeURIComponent(code))) : null;
  // The project must belong to the person's own organization. Another organization's project
  // answers exactly as a project that does not exist, so its code cannot be confirmed by guessing.
  if (code && v.organizationId && row?.organizationId && row.organizationId !== v.organizationId) return deny(404, NO_PROJECT(decodeURIComponent(code)));
  // A parked project is set aside while the app is built: it answers as if it were not there.
  if (code && row?.kind === "parked") return deny(404, NO_PROJECT(decodeURIComponent(code)));
  // The sample project is a finished example: everyone can open it, nobody can change it.
  if (code && opts.write && row?.kind === "sample") return deny(403, SAMPLE_READ_ONLY);
  return v;
}

function decodedOrNull(code: string): string | null {
  try {
    return decodeURIComponent(code);
  } catch {
    return null;
  }
}

/**
 * The project a path names (its organization and kind), or null when there is none. The same read
 * as server/field-store projectByCode, so a read-only request reads the project once for the
 * checks above and the route together. Read fresh otherwise: a project can be parked and brought back.
 */
async function projectRow(code: string): Promise<{ organizationId: string | null; kind: string } | null> {
  const { projectByCode } = await import("@/server/field-store");
  try {
    return await projectByCode(code);
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
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

/** Whether a project is parked (projects.kind "parked"). Not kept: a project can be parked and brought back. */
export async function isParkedProject(code: string): Promise<boolean> {
  const [p] = await db.select({ kind: s.projects.kind }).from(s.projects).where(eq(s.projects.code, code)).limit(1);
  return p?.kind === "parked";
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

/**
 * inOwnOrganization for several projects at once (a board across projects): the codes this person
 * may act on, each judged exactly as inOwnOrganization judges it, with the projects not known yet
 * read in one query instead of one each.
 */
export async function inOwnOrganizationOf(v: Viewer, codes: string[]): Promise<Set<string>> {
  if (!v.organizationId) return new Set(codes);
  const unknown = [...new Set(codes.filter((c) => !orgOfProject.has(c)))];
  if (unknown.length) {
    const rows = await db.select({ code: s.projects.code, org: s.projects.organizationId }).from(s.projects).where(inArray(s.projects.code, unknown));
    for (const r of rows) if (r.code && r.org) orgOfProject.set(r.code, r.org);
  }
  return new Set(
    codes.filter((c) => {
      const org = orgOfProject.get(c) ?? null;
      return !org || org === v.organizationId;
    }),
  );
}

export const isEmployee = (u: AppUser) => u.kind === "employee";
/** Sample project codes (C5) start with this; a project made in setup cannot (its letters are at most four). */
export const SAMPLE_PREFIX = "SAMPLE-";
/** Whether a person works on a project: everyone without a project list does; administrators always do. Everyone may open the sample. */
export const onProject = (u: AppUser, code: string) => !u.projects?.length || u.projects.includes(code) || !!u.admin || code.startsWith(SAMPLE_PREFIX);
export const isMelOwner = (u: AppUser) => u.project.includes("mel-owner");
