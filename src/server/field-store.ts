import { createHash } from "node:crypto";
import { CROP_PLAN_KEY, type CropPlan } from "@/lib/crops";
import { donorPhotoRule } from "@/server/photo-consent";
import { EMPTY_FRAMEWORK, FRAMEWORK_KEY, type Framework } from "@/lib/framework";
import { mirrorFarmer } from "@/server/farmer-mirror";
import { loadProjectState, loadProjectStateRaw, loadProjectStates, saveProjectState, type Reader } from "@/server/project-state";
import { DEMO_SETUP, FIELD_SETUP_KEY, type FieldSetup } from "@/lib/package";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { canSeePII, type AppUser } from "@/lib/demo";
import { hideName, namePattern, type Farmer, type FieldItem, type Stock } from "@/lib/field";
import { docNamesPerson } from "@/lib/doc-links";
import { HttpError } from "@/server/guard";
import { oncePerRequest, requestWrote } from "@/server/request-memo";

/**
 * Field activities state in Postgres. Each farmer or MEL finding is one `field_items` row.
 * Names never go into `field_items`: they live in `farmer_pii` and are added on the way out,
 * only for people whose role may see them.
 */

export function projectByCode(code: string) {
  // Asked for by nearly every read: once per read-only request (server/request-memo).
  return oncePerRequest(`project:${code}`, async () => {
    const [p] = await db.select().from(s.projects).where(eq(s.projects.code, code)).limit(1);
    if (!p) throw new HttpError(404, `There is no project ${code} here. Check the address, or choose the project again from Home.`);
    return p;
  });
}

/**
 * The donor's name as reports print it. One source: the donor entered in setup and Settings (the
 * `donors` table). `projects.donor` is an older column no screen writes; it is read only when a
 * project has no donor entered, or to say which of several donors a single-donor report is for.
 */
export async function donorNameOf(project: { id: string; donor: string | null }): Promise<string | null> {
  const rows = await db.select({ name: s.donors.name }).from(s.donors).where(eq(s.donors.projectId, project.id)).orderBy(asc(s.donors.createdAt));
  const names = [...new Set(rows.map((r) => r.name.trim()).filter(Boolean))];
  if (names.length === 1) return names[0];
  return project.donor ?? (names.length ? names.join(" and ") : null);
}

/**
 * The project's goal as reports and AI drafts read it. One reader: the wording a plan approver
 * gave on the results framework (it carries its source and who worded it); until then, the goal
 * entered in setup.
 */
export async function goalOf(project: { id: string; goal: string | null }): Promise<string | null> {
  const fw = await loadProjectState<Framework>(project.id, FRAMEWORK_KEY, EMPTY_FRAMEWORK);
  return fw.goal?.text?.trim() || project.goal;
}

/** The demo project: its package and season come with it (lib/package DEMO_SETUP). */
export const DEMO_FIELD_PROJECT = "A-2027";

/**
 * A project's input package and season. The demo project has one built in; any other project has
 * one once its manager sets it up in Field activities, and until then has no field workflow.
 */
export async function setupOf(project: { id: string; code: string | null; crop?: string | null }, q?: Reader): Promise<FieldSetup | null> {
  // A draft (pre-filled for a manager to confirm) does not switch Field activities on. The crop
  // plan decided at initiation (Set up → Crop) rides along, for planting and its checks: both
  // documents come in one read.
  const { [FIELD_SETUP_KEY]: stored, [CROP_PLAN_KEY]: plan } = await loadProjectStates<{ [FIELD_SETUP_KEY]: (FieldSetup & { draft?: boolean }) | null; [CROP_PLAN_KEY]: CropPlan | null }>(
    project.id,
    { [FIELD_SETUP_KEY]: null, [CROP_PLAN_KEY]: null },
    q,
  );
  const setup = stored?.items?.length && !stored.draft ? stored : project.code === DEMO_FIELD_PROJECT ? DEMO_SETUP : null;
  if (!setup) return null;
  // The crop is the project's, from its design: asked once, never again for the package.
  const crop = project.crop !== undefined ? project.crop : ((await (q ?? db).select({ crop: s.projects.crop }).from(s.projects).where(eq(s.projects.id, project.id)).limit(1))[0]?.crop ?? null);
  const { plan: _old, ...rest } = setup;
  void _old;
  return { ...rest, ...(crop ? { crop } : {}), ...(plan ? { plan } : {}) };
}
/** Codes of the projects with an input package (not a draft), so Field activities runs on them. */
export async function projectsWithField(): Promise<Set<string>> {
  // Only what decides it comes back, not each package: whether it has items, and whether it is a draft.
  const rows = await db
    .select({
      code: s.projects.code,
      items: sql<number>`case jsonb_typeof(${s.projectState.data} -> 'items') when 'array' then jsonb_array_length(${s.projectState.data} -> 'items') when 'string' then length(${s.projectState.data} ->> 'items') else 0 end`,
      draft: sql<boolean>`coalesce(${s.projectState.data} -> 'draft' not in ('false'::jsonb, 'null'::jsonb, '0'::jsonb, '""'::jsonb), false)`,
    })
    .from(s.projectState)
    .innerJoin(s.projects, eq(s.projects.id, s.projectState.projectId))
    .where(eq(s.projectState.key, FIELD_SETUP_KEY));
  return new Set(rows.filter((r) => r.code && Number(r.items) > 0 && !r.draft).map((r) => r.code!));
}

export const setupFor = async (code: string) => setupOf(await projectByCode(code));

export async function saveSetup(code: string, setup: FieldSetup) {
  const project = await projectByCode(code);
  // The crop plan belongs to the project design, not the package: never stored here.
  const { plan: _plan, ...rest } = setup;
  void _plan;
  await saveProjectState(project.id, FIELD_SETUP_KEY, rest);
}

/** Copy of an item safe to store: no name. */
function stripPII(item: FieldItem): FieldItem {
  return item.kind === "farmer" ? { ...item, name: "" } : item;
}

/** Farmers' names by farmer number, only for people allowed to see participants' names; empty for anyone else. */
export async function farmerNames(projectId: string, user?: AppUser | null): Promise<Map<string, string>> {
  if (!canSeePII(user)) return new Map<string, string>();
  return namesOf(projectId);
}

/** One farmer's name by farmer number, only for someone allowed to see participants' names; null for anyone else. */
export async function farmerNameOf(projectId: string, farmerCode: string, user?: AppUser | null): Promise<string | null> {
  if (!canSeePII(user)) return null;
  const [r] = await db
    .select({ name: s.farmerPii.fullName })
    .from(s.farmerPii)
    .innerJoin(s.farmers, eq(s.farmers.id, s.farmerPii.farmerId))
    .where(and(eq(s.farmers.projectId, projectId), eq(s.farmers.code, farmerCode)))
    .limit(1);
  return r?.name || null;
}

/** Every farmer's name: only for checks on the server, never sent to someone who may not see names. */
async function namesOf(projectId: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const pii = await db
    .select({ code: s.farmers.code, name: s.farmerPii.fullName })
    .from(s.farmerPii)
    .innerJoin(s.farmers, eq(s.farmers.id, s.farmerPii.farmerId))
    .where(eq(s.farmers.projectId, projectId));
  pii.forEach((r) => names.set(r.code, r.name));
  return names;
}

/** Fields that are never free text: left as they are when names are hidden. */
const NOT_TEXT = new Set(["id", "rev", "src", "url", "kind", "orgId", "step", "status", "date", "by", "who", "activity", "at"]);

/** Every piece of free text in a record with the farmer's name replaced by their number, as on screen (lib/field maskName). */
function masked(v: unknown, name: string, id: string): unknown {
  if (typeof v === "string") return hideName(v, name, id);
  if (Array.isArray(v)) return v.map((x) => masked(x, name, id));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, NOT_TEXT.has(k) ? x : masked(x, name, id)]));
  return v;
}

/**
 * A farmer's record for someone who may not see names: the name typed into any note, story,
 * survey comment or history line shows as the farmer's number, and story links whose address
 * names them are left out.
 */
function withoutName(f: Farmer, name: string): Farmer {
  if (!name) return f;
  const out = masked(f, name, f.id) as Farmer;
  return { ...out, stories: out.stories.map((s) => (s.docs?.length ? { ...s, docs: s.docs.filter((d) => !docNamesPerson(d.url, name)) } : s)) };
}

/** What a list entry is known by (a story's id, a link's address), so entries pair up even when some were hidden or reordered. */
const keyOf = (x: unknown) => (x && typeof x === "object" ? ((x as { id?: unknown; url?: unknown }).id ?? (x as { url?: unknown }).url) : undefined);

/** A stored text cut into plain stretches and the name's mentions: how each shows (`shown`) and what is stored (`real`). */
function pieces(text: string, name: string, id: string): { shown: string; real: string }[] {
  const re = namePattern(name);
  const out: { shown: string; real: string }[] = [];
  let last = 0;
  for (const m of re ? text.matchAll(re) : []) {
    const start = m.index + m[1].length;
    if (start > last) out.push({ shown: text.slice(last, start), real: text.slice(last, start) });
    out.push({ shown: `Farmer ${id}`, real: m[2] });
    last = start + m[2].length;
  }
  if (last < text.length) out.push({ shown: text.slice(last), real: text.slice(last) });
  return out;
}

/**
 * A text edited by someone who saw it with the name hidden: what they left as it was (before and
 * after their edit) keeps the name exactly as stored; what they typed is taken as typed. A mention
 * inside the part they changed stays as the farmer's number: never guessed back into a name.
 */
function restored(sent: string, was: string, name: string, id: string): string {
  const ps = pieces(was, name, id);
  const shown = ps.map((x) => x.shown).join("");
  if (sent === shown) return was;
  let p = 0;
  while (p < sent.length && p < shown.length && sent[p] === shown[p]) p++;
  let q = 0;
  while (q < sent.length - p && q < shown.length - p && sent[sent.length - 1 - q] === shown[shown.length - 1 - q]) q++;
  let head = "";
  let a = 0;
  for (const x of ps) {
    if (a + x.shown.length <= p) {
      head += x.real;
      a += x.shown.length;
      continue;
    }
    if (x.shown === x.real) {
      head += x.shown.slice(0, p - a);
      a = p;
    }
    break;
  }
  let tail = "";
  let b = 0;
  for (const x of [...ps].reverse()) {
    if (b + x.shown.length <= q) {
      tail = x.real + tail;
      b += x.shown.length;
      continue;
    }
    if (x.shown === x.real) {
      tail = x.shown.slice(x.shown.length - (q - b)) + tail;
      b = q;
    }
    break;
  }
  return head + sent.slice(a, sent.length - b) + tail;
}

/**
 * Text sent back by someone who may not see names, put back together with the record as stored:
 * unchanged text keeps the name, edited text keeps it wherever they left the words alone (restored).
 */
function unmasked(sent: unknown, was: unknown, name: string, id: string): unknown {
  if (typeof sent === "string") return typeof was === "string" ? restored(sent, was, name, id) : sent;
  if (Array.isArray(sent)) {
    const old = Array.isArray(was) ? was : [];
    return sent.map((x, k) => {
      const key = keyOf(x);
      if (key !== undefined) return unmasked(x, old.find((o) => keyOf(o) === key), name, id);
      // Entries known by nothing: the stored one that shows exactly like it, else the one in its place.
      const same = old.find((o) => keyOf(o) === undefined && JSON.stringify(masked(o, name, id)) === JSON.stringify(x));
      return unmasked(x, same ?? old[k], name, id);
    });
  }
  if (sent && typeof sent === "object") {
    const w = was && typeof was === "object" ? (was as Record<string, unknown>) : {};
    return Object.fromEntries(Object.entries(sent).map(([k, x]) => [k, NOT_TEXT.has(k) ? x : unmasked(x, w[k], name, id)]));
  }
  return sent;
}

/**
 * What a save by someone who may not see names must keep: the name in text they saw masked and
 * did not change, the story links left out of their page (they could not remove what they
 * never saw) and where each photo was taken, which their page was never sent (withoutPlaces).
 */
export async function keepHidden(code: string, user: AppUser, items: FieldItem[], stored: Map<string, FieldItem>): Promise<FieldItem[]> {
  if (canSeePII(user)) return items;
  const names = await namesOf((await projectByCode(code)).id);
  return items.map((sent) => {
    if (sent.kind !== "farmer") return sent;
    const was = stored.get(sent.id);
    // The place of each photo comes from the record as stored, never from their page (withPlaces).
    const i = withPlaces(sent, was?.kind === "farmer" ? was : undefined);
    const name = names.get(i.id);
    if (was?.kind !== "farmer" || !name) return i;
    const back = unmasked(i, was, name, i.id) as Farmer;
    return {
      ...back,
      name: "",
      stories: back.stories.map((s) => {
        const hidden = (was.stories.find((x) => x.id === s.id)?.docs ?? []).filter((d) => docNamesPerson(d.url, name) && !s.docs?.some((x) => x.url === d.url));
        return hidden.length ? { ...s, docs: [...(s.docs ?? []), ...hidden] } : s;
      }),
    };
  });
}

/**
 * A farmer's photos for someone who may not see participant names: where a photo was taken is
 * left out, since a plot's place shows where a named person lives. `hasPlace` says one is kept.
 */
function withoutPlaces(f: Farmer): Farmer {
  return { ...f, photos: (f.photos ?? []).map(({ gps, ...rest }) => (gps ? { ...rest, hasPlace: true } : rest)) };
}

/**
 * The photos sent back by someone whose page never held a photo's place (withoutPlaces), with
 * each place put back from the record as stored. A photo they took off is gone and one they
 * added keeps the place it came with. A place sent for a photo already stored is not taken:
 * they were never shown it, so they cannot have corrected it.
 */
function withPlaces(sent: Farmer, was: Farmer | undefined): Farmer {
  const kept = new Map((was?.photos ?? []).map((p) => [p.id, p]));
  return {
    ...sent,
    photos: (sent.photos ?? []).map((p) => {
      const old = kept.get(p.id);
      if (!old) return p;
      const { gps: _gps, ...rest } = p;
      void _gps;
      return old.gps ? { ...rest, gps: old.gps } : rest;
    }),
  };
}

/**
 * A farmer's record for someone outside Roots of Peace (a donor's account). The signed goods
 * received note has the farmer's name and signature on it, so its picture is not sent: the entry
 * stays, to show that a note is on file. No photo carries where it was taken. Every other photo
 * is sent only when it is cleared for donors by the rule a report's photos pass
 * (server/photo-consent `donorPhotoRule`): checked for people who can be recognised and cleared by
 * what it shows or by recorded consent. A photo not cleared is not sent at all, not even its
 * caption, which staff typed (decision AB, 25 Nov 2026). An account like
 * this cannot save a farmer, so nothing left out here can be lost by a save.
 */
function forOutside(f: Farmer, cleared: (src: string) => boolean): Farmer {
  return {
    ...f,
    photos: f.photos
      // The signed note's entry stays with no picture. Any other photo goes only when it is cleared for donors.
      .filter((p) => p.signedNote || (p.src !== undefined && cleared(p.src)))
      .map((p) => {
        const { gps: _gps, hasPlace: _hasPlace, src, ...rest } = p;
        void _gps;
        void _hasPlace;
        return p.signedNote || src === undefined ? rest : { ...rest, src };
      }),
  };
}

/**
 * The fingerprint of a farmer photo's picture, as the photo library keeps it for a file: the
 * picture's own bytes. A photo with no picture of its own has none.
 */
export function photoFingerprint(src: string): string | null {
  const m = /^data:[^;,]+;base64,(.+)$/.exec(src);
  return m ? createHash("sha256").update(Buffer.from(m[1], "base64")).digest("hex") : null;
}

/**
 * The project's field records. With `user`, names are added only for people allowed to see them,
 * and for anyone else the name is hidden in free text and in story links (withoutName) and no photo
 * carries where it was taken (withoutPlaces). Without `user`, the records as stored (no names), for
 * the server's own use.
 */
export async function loadField(code: string, user?: AppUser) {
  const project = await projectByCode(code);
  // None of these depends on another: they go together.
  const [rows, stock, names, hiddenFrom, setup] = await Promise.all([
    db.select().from(s.fieldItems).where(eq(s.fieldItems.projectId, project.id)),
    loadProjectStateRaw(project.id, "stock"),
    farmerNames(project.id, user),
    user && !canSeePII(user) ? namesOf(project.id) : null,
    setupOf(project),
  ]);

  const outside = !!user && user.kind !== "employee";
  // The consent rule is read only for an account outside the organization: it decides which farmer photos go.
  const rule = outside ? await donorPhotoRule(project.id) : null;
  const cleared = (src: string) => {
    const hash = photoFingerprint(src);
    return !!hash && !!rule?.(hash).ok;
  };
  const items = rows
    .map((r) => ({ ...(r.data as FieldItem), rev: r.updatedAt.toISOString() }) as FieldItem)
    .map((i): FieldItem => (i.kind === "farmer" ? (hiddenFrom ? withoutPlaces(withoutName({ ...i, name: "" }, hiddenFrom.get(i.id) ?? "")) : { ...i, name: names.get(i.id) ?? "" }) : i))
    .map((i): FieldItem => (outside && i.kind === "farmer" ? forOutside(i, cleared) : i))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { items, stock: (stock as Stock | null) ?? null, setup };
}

/** What is stored for an item: no name (farmer_pii holds it), no version stamp and no `hasPlace` mark, which is made for a reader (withoutPlaces). */
const storable = (raw: FieldItem): FieldItem => {
  const { rev: _rev, ...item } = stripPII(raw);
  void _rev;
  if (item.kind === "farmer" && item.photos?.some((p) => "hasPlace" in p))
    return {
      ...item,
      photos: item.photos.map((p) => {
        const { hasPlace: _mark, ...rest } = p;
        void _mark;
        return rest;
      }),
    } as FieldItem;
  return item as FieldItem;
};

/**
 * Saves items edited in the browser, each only if it is still the version the browser read (`rev`).
 * A record changed since (a Kobo record accepted, a distribution approved, someone else's save) is
 * refused whole, so a stale page never writes over newer work. All or nothing; returns the new
 * versions.
 */
export async function saveEdited(code: string, items: FieldItem[]): Promise<Record<string, string>> {
  const project = await projectByCode(code);
  const revs: Record<string, string> = {};
  await db.transaction(async (tx) => {
    for (const raw of items) {
      const item = storable(raw);
      const now = new Date();
      const where = and(eq(s.fieldItems.projectId, project.id), eq(s.fieldItems.itemKey, item.id));
      const [updated] = raw.rev
        ? await tx
            .update(s.fieldItems)
            .set({ data: item, kind: item.kind, updatedAt: now })
            .where(and(where, sql`date_trunc('milliseconds', ${s.fieldItems.updatedAt}) = ${raw.rev}::timestamptz`))
            .returning({ at: s.fieldItems.updatedAt })
        : await tx
            .insert(s.fieldItems)
            .values({ organizationId: project.organizationId, projectId: project.id, itemKey: item.id, kind: item.kind, data: item, updatedAt: now })
            .onConflictDoNothing()
            .returning({ at: s.fieldItems.updatedAt });
      if (!updated) throw new HttpError(409, `${item.kind === "farmer" ? `Farmer ${item.id}` : `Finding ${item.id}`} was changed by someone else since you opened this page, so your change was not saved. The page now shows the latest; make your change again.`);
      await mirrorFarmer(tx, project.id, item);
      revs[item.id] = updated.at.toISOString();
    }
  });
  requestWrote();
  return revs;
}

/** Insert or replace the given items, whatever version is stored (seeding, imports, tests). */
export async function saveItems(code: string, items: FieldItem[]) {
  if (!items.length) return;
  const project = await projectByCode(code);
  for (const raw of items) {
    const item = storable(raw);
    await db
      .insert(s.fieldItems)
      .values({ organizationId: project.organizationId, projectId: project.id, itemKey: item.id, kind: item.kind, data: item })
      .onConflictDoUpdate({ target: [s.fieldItems.projectId, s.fieldItems.itemKey], set: { data: item, kind: item.kind, updatedAt: new Date() } });
    await mirrorFarmer(db, project.id, item);
  }
  requestWrote();
}

export async function saveStock(code: string, stock: Stock) {
  const project = await projectByCode(code);
  await db
    .insert(s.projectState)
    .values({ projectId: project.id, key: "stock", data: stock })
    .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data: stock, updatedAt: new Date() } });
  requestWrote();
}

/** Farmer code → current step, for the data checker. */
export async function roster(projectId: string) {
  const rows = await db
    .select({ key: s.fieldItems.itemKey, data: s.fieldItems.data })
    .from(s.fieldItems)
    .where(and(eq(s.fieldItems.projectId, projectId), eq(s.fieldItems.kind, "farmer")));
  return Object.fromEntries(rows.map((r) => [r.key, (r.data as FieldItem).step]));
}

/** Farmers for the Kobo farmer list: ID, village and household-head initials. Never names. */
export async function farmerListRows(code: string) {
  const project = await projectByCode(code);
  const farmers = await db.select().from(s.farmers).where(eq(s.farmers.projectId, project.id));
  const active = await db
    .select({ key: s.fieldItems.itemKey, data: s.fieldItems.data })
    .from(s.fieldItems)
    .where(and(eq(s.fieldItems.projectId, project.id), inArray(s.fieldItems.itemKey, farmers.map((f) => f.code).concat("__none__"))));
  const removed = new Set(active.filter((r) => (r.data as FieldItem).step === "removed").map((r) => r.key));
  const hectares = new Map(active.filter((r) => (r.data as FieldItem).kind === "farmer").map((r) => [r.key, (r.data as { hectares?: number }).hectares ?? null]));
  // The village comes from the working record (server/farmer-mirror): it is the one kept up to date.
  const village = new Map(active.map((r) => [r.key, (r.data as { community?: string }).community || null]));
  return farmers
    .filter((f) => !removed.has(f.code) && f.status !== "removed")
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((f) => ({ name: f.code, label: [f.code, village.get(f.code) ?? f.village, f.householdHeadInitials].filter(Boolean).join(" · "), hectares: hectares.get(f.code) ?? null }));
}
