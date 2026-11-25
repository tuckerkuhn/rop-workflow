import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { protectSubmission } from "@/server/kobo-protect";
import { isReviewed, REVIEWED_PURPOSES } from "@/lib/kobo-setup";
import { breakdownSchema, hasBreakdown } from "@/lib/kobo-setup";
import { activityOf } from "@/lib/qpr";
import type { ActivityLinkInput, KoboActivityLinks } from "@/lib/kobo-activities";
import type { AutoSyncSecret, FormPurpose, KoboBreakdown, KoboMapping, KoboState, MappingMethod, MappingOrigin, SyncCounts } from "@/lib/kobo-setup";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { HttpError } from "@/server/guard";
import { requestWrote } from "@/server/request-memo";
import { KoboError, checkServerUrl, formQuestions, formSubmissions, listForms, submissionRefs, type KoboSubmission } from "@/server/kobo-client";
import { MissingKeyError, decryptSecret, encryptSecret } from "@/server/secrets";

/**
 * A project's own KoboToolbox link: the account, the forms that belong to the project, and how
 * each indicator is counted from a form question. This is the only way Kobo data comes in.
 *
 * Each linked form has a purpose. Reviewed forms (readiness, training, visit, distribution): each
 * submission is stored with its purpose as `form` and waits in the review queue; it counts only once accepted. Data forms: stored
 * with no `form`, so they stay out of the review queue and count through mappings.
 */

async function projectRow(code: string) {
  const [p] = await db.select().from(s.projects).where(eq(s.projects.code, code)).limit(1);
  if (!p) throw new KoboError("This project is kept in the browser only; it cannot connect to KoboToolbox yet.");
  return p;
}

async function connectionOf(projectId: string) {
  const [c] = await db.select().from(s.koboConnections).where(eq(s.koboConnections.projectId, projectId)).limit(1);
  return c ?? null;
}

export async function credentials(code: string) {
  const project = await projectRow(code);
  const c = await connectionOf(project.id);
  if (!c) throw new KoboError("Connect KoboToolbox for this project first (Setup).");
  return { project, connection: c, server: c.serverUrl, token: decryptSecret(c.tokenEncrypted) };
}

const purposeOf = (v: string): FormPurpose => (isReviewed(v) ? v : "data");

/** The project's linked readiness forms, with the account to reach them. */
export async function readinessForms(code: string) {
  const c = await credentials(code);
  const forms = await db.select().from(s.koboForms).where(and(eq(s.koboForms.projectId, c.project.id), inArray(s.koboForms.purpose, [...REVIEWED_PURPOSES])));
  if (!forms.length) throw new KoboError("No field form that uses the farmer list is linked to this project. In Setup, choose the form and mark what it is for (readiness check, training attendance, farm visit or input distribution).");
  return { ...c, forms };
}

/**
 * Which questions give each indicator's women, men and young people (lib/kobo-setup KoboBreakdown).
 * Kept beside the mappings in project_state, by indicator code, with the form it was chosen on: a
 * breakdown chosen on another form than the indicator's mapping now uses is not read.
 */
export const BREAKDOWN_KEY = "kobo-breakdown";
type BreakdownDoc = Record<string, { assetUid: string; breakdown: KoboBreakdown }>;

export async function koboBreakdowns(projectId: string): Promise<BreakdownDoc> {
  const [row] = await db
    .select({ data: s.projectState.data })
    .from(s.projectState)
    .where(and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, BREAKDOWN_KEY)))
    .limit(1);
  const out: BreakdownDoc = {};
  for (const [code, v] of Object.entries((row?.data ?? {}) as Record<string, { assetUid?: unknown; breakdown?: unknown }>)) {
    const b = breakdownSchema.safeParse(v?.breakdown);
    if (typeof v?.assetUid === "string" && b.success) out[code] = { assetUid: v.assetUid, breakdown: b.data };
  }
  return out;
}

/**
 * Which workplan activities each form records (lib/kobo-activities), by form uid. Kept in
 * project_state like the breakdowns; links to forms no longer chosen are not read.
 */
export const ACTIVITIES_KEY = "kobo-activities";

export async function koboActivityLinks(projectId: string): Promise<KoboActivityLinks> {
  const [[row], forms] = await Promise.all([
    db
      .select({ data: s.projectState.data })
      .from(s.projectState)
      .where(and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, ACTIVITIES_KEY)))
      .limit(1),
    db.select({ uid: s.koboForms.assetUid }).from(s.koboForms).where(eq(s.koboForms.projectId, projectId)),
  ]);
  const chosen = new Set(forms.map((f) => f.uid));
  const out: KoboActivityLinks = {};
  for (const [uid, codes] of Object.entries((row?.data ?? {}) as Record<string, unknown>)) {
    const list = Array.isArray(codes) ? codes.filter((c): c is string => typeof c === "string" && c.length > 0) : [];
    if (chosen.has(uid) && list.length) out[uid] = list;
  }
  return out;
}

/**
 * Replaces which activities each form records. The codes must be activities of the project's
 * targets or workplan; a form left out, or given no activities, records none.
 */
export async function saveActivityLinks(code: string, links: ActivityLinkInput[], by: string) {
  const project = await projectRow(code);
  const [forms, inds, plan] = await Promise.all([
    db.select({ uid: s.koboForms.assetUid }).from(s.koboForms).where(eq(s.koboForms.projectId, project.id)),
    db.select({ code: s.indicators.code, donorCode: s.indicators.donorCode }).from(s.indicators).where(eq(s.indicators.projectId, project.id)),
    db.select({ code: s.workplanItems.code, activityCode: s.workplanItems.activityCode }).from(s.workplanItems).where(eq(s.workplanItems.projectId, project.id)),
  ]);
  const before = await koboActivityLinks(project.id);
  const chosen = new Set(forms.map((f) => f.uid));
  const known = new Set([...inds.map((i) => activityOf(i.donorCode, i.code)), ...plan.flatMap((w) => [w.code, w.activityCode ?? ""])].filter(Boolean));
  const doc: KoboActivityLinks = {};
  for (const l of links) {
    if (!chosen.has(l.form)) throw new KoboError("An activity link uses a form that is not chosen for this project.");
    const unknown = l.activities.find((a) => !known.has(a));
    if (unknown) throw new KoboError(`No activity ${unknown} in this project's targets or workplan.`);
    if (l.activities.length) doc[l.form] = [...new Set(l.activities)].sort();
  }
  // Only what changed is written down; saving the same links again changes nothing.
  const same = (x: string[] | undefined, y: string[] | undefined) => (x ?? []).join(" ") === (y ?? []).join(" ");
  const changed = [...new Set([...Object.keys(before), ...Object.keys(doc)])].filter((uid) => !same(before[uid], doc[uid]));
  if (!changed.length) return;
  const originOf = (uid: string) => links.find((l) => l.form === uid)?.origin ?? "manual";
  await db.transaction(async (tx) => {
    await tx
      .insert(s.projectState)
      .values({ projectId: project.id, key: ACTIVITIES_KEY, data: doc })
      .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data: doc, updatedAt: new Date() } });
    // Which form records which activities and whether a person chose them or used the suggestion.
    await logAudit(tx, project.id, { entity: "project", entityId: project.id, action: "kobo_activities_saved", by, detail: { links: changed.map((uid) => ({ form: uid, activities: doc[uid] ?? [], origin: doc[uid] ? originOf(uid) : "manual" })) } });
  });
  requestWrote();
}

/** The breakdown for an indicator's mapping, when one was chosen on the mapping's form. */
export const breakdownFor = (doc: BreakdownDoc, code: string, assetUid: string) => (doc[code]?.assetUid === assetUid ? doc[code].breakdown : null);

export async function koboState(code: string): Promise<KoboState> {
  // The project as the rest of the request reads it (kept once per read-only request); none here is an empty link.
  const project = await projectByCode(code).catch((e) => {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  });
  if (!project) return { connection: null, forms: [], mappings: [] };
  const [c, forms, mappings, breakdowns, activities] = await Promise.all([
    connectionOf(project.id),
    db.select().from(s.koboForms).where(eq(s.koboForms.projectId, project.id)),
    db
      .select({ code: s.indicators.code, m: s.koboMappings })
      .from(s.koboMappings)
      .innerJoin(s.indicators, eq(s.indicators.id, s.koboMappings.indicatorId))
      .where(eq(s.indicators.projectId, project.id)),
    koboBreakdowns(project.id),
    koboActivityLinks(project.id),
  ]);
  return {
    connection: c && { serverUrl: c.serverUrl, tokenHint: c.tokenHint, countOnly: c.countOnly === "approved" ? "approved" : "all", lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null, autoSyncSince: c.hookSecretHash ? (c.hookEnabledAt?.toISOString() ?? null) : null },
    forms: forms.map((f) => ({ uid: f.assetUid, name: f.name, purpose: purposeOf(f.purpose) })),
    mappings: mappings.map(({ code, m }) => ({ indicatorCode: code, assetUid: m.assetUid, question: m.question, method: m.method as MappingMethod, value: m.value, origin: (m.origin ?? "manual") as MappingOrigin, breakdown: breakdownFor(breakdowns, code, m.assetUid) })),
    activities,
  };
}

/** Saves the account after checking it works. A new token replaces the old; without one the saved token stays. */
export async function connect(code: string, input: { serverUrl: string; token?: string; countOnly: "all" | "approved" }, by: string) {
  const project = await projectRow(code);
  const server = await checkServerUrl(input.serverUrl);
  const existing = await connectionOf(project.id);
  if (!input.token && !existing) throw new KoboError("Paste the API token.");
  const token = input.token ?? decryptSecret(existing!.tokenEncrypted);
  await listForms(server, token);
  const values = { serverUrl: server, tokenEncrypted: encryptSecret(token), tokenHint: token.slice(-4), countOnly: input.countOnly, connectedBy: by, updatedAt: new Date() };
  if (existing) await db.update(s.koboConnections).set(values).where(eq(s.koboConnections.id, existing.id));
  else await db.insert(s.koboConnections).values({ ...values, projectId: project.id });
}

/** Forgets the account, the chosen forms, the mappings and the activity links. Submissions already synced stay as records. */
export async function disconnect(code: string) {
  const project = await projectRow(code);
  const ids = (await db.select({ id: s.indicators.id }).from(s.indicators).where(eq(s.indicators.projectId, project.id))).map((r) => r.id);
  if (ids.length) await db.delete(s.koboMappings).where(inArray(s.koboMappings.indicatorId, ids));
  await db.delete(s.projectState).where(and(eq(s.projectState.projectId, project.id), inArray(s.projectState.key, [BREAKDOWN_KEY, ACTIVITIES_KEY])));
  await db.delete(s.koboForms).where(eq(s.koboForms.projectId, project.id));
  await db.delete(s.koboConnections).where(eq(s.koboConnections.projectId, project.id));
}

/* ---------- automatic sync ---------- */

const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest();

/**
 * Turns on automatic sync, or replaces its password. Each link gets its own random password;
 * only its hash is kept, so the old one stops working at once and this one is never shown again.
 */
export async function enableAutoSync(code: string): Promise<AutoSyncSecret> {
  const { connection } = await credentials(code);
  const password = randomBytes(32).toString("base64url");
  await db.update(s.koboConnections).set({ hookSecretHash: sha256(password).toString("hex"), hookEnabledAt: new Date(), updatedAt: new Date() }).where(eq(s.koboConnections.id, connection.id));
  return { path: `/api/projects/${encodeURIComponent(code)}/kobo/hook`, username: code, password };
}

export async function disableAutoSync(code: string) {
  const project = await projectRow(code);
  await db.update(s.koboConnections).set({ hookSecretHash: null, hookEnabledAt: null, updatedAt: new Date() }).where(eq(s.koboConnections.projectId, project.id));
}

/**
 * Checks a KoboToolbox REST Service call against this project's own password (HTTP Basic auth;
 * the username is not checked). False for unknown projects, links without automatic sync and
 * wrong passwords alike, so callers cannot tell which.
 */
export async function hookAllowed(code: string, authorization: string | null) {
  const m = /^Basic\s+(.+)$/i.exec(authorization ?? "");
  const decoded = m ? Buffer.from(m[1], "base64").toString("utf8") : "";
  const password = decoded.includes(":") ? decoded.slice(decoded.indexOf(":") + 1) : "";
  const [row] = await db
    .select({ hash: s.koboConnections.hookSecretHash })
    .from(s.koboConnections)
    .innerJoin(s.projects, eq(s.projects.id, s.koboConnections.projectId))
    .where(eq(s.projects.code, code))
    .limit(1);
  // Always hash and compare, so a missing link takes as long as a wrong password.
  const expected = row?.hash ? Buffer.from(row.hash, "hex") : sha256("no automatic sync");
  return timingSafeEqual(sha256(password), expected) && !!row?.hash && password.length > 0;
}

/** True when the submission is on one of the project's forms, or does not say which form it is on. */
export async function isProjectForm(code: string, assetUid: string | undefined) {
  if (!assetUid) return true;
  const project = await projectRow(code);
  const [f] = await db.select({ id: s.koboForms.id }).from(s.koboForms).where(and(eq(s.koboForms.projectId, project.id), eq(s.koboForms.assetUid, assetUid))).limit(1);
  return !!f;
}

export async function liveForms(code: string) {
  const c = await credentials(code);
  return listForms(c.server, c.token);
}

export async function liveQuestions(code: string, uid: string) {
  const c = await credentials(code);
  return formQuestions(c.server, c.token, uid);
}

/**
 * Replaces the project's forms. Mappings to forms no longer chosen are removed. Run a sync after:
 * submissions already stored from a form now marked readiness are moved to the review queue then.
 */
export async function saveForms(code: string, forms: { uid: string; name: string; purpose: FormPurpose }[]) {
  const { project } = await credentials(code);
  const uids = forms.map((f) => f.uid);
  await db.transaction(async (tx) => {
    const mine = eq(s.koboForms.projectId, project.id);
    await tx.delete(s.koboForms).where(uids.length ? and(mine, notInArray(s.koboForms.assetUid, uids)) : mine);
    for (const f of forms)
      await tx
        .insert(s.koboForms)
        .values({ projectId: project.id, assetUid: f.uid, name: f.name, purpose: f.purpose })
        .onConflictDoUpdate({ target: [s.koboForms.projectId, s.koboForms.assetUid], set: { name: f.name, purpose: f.purpose, updatedAt: new Date() } });
    const ids = (await tx.select({ id: s.indicators.id }).from(s.indicators).where(eq(s.indicators.projectId, project.id))).map((r) => r.id);
    if (ids.length) {
      const inProject = inArray(s.koboMappings.indicatorId, ids);
      await tx.delete(s.koboMappings).where(uids.length ? and(inProject, notInArray(s.koboMappings.assetUid, uids)) : inProject);
    }
    // Activity links of forms no longer chosen go too, so choosing the form again starts afresh.
    const [links] = await tx.select({ data: s.projectState.data }).from(s.projectState).where(and(eq(s.projectState.projectId, project.id), eq(s.projectState.key, ACTIVITIES_KEY))).limit(1);
    if (links) {
      const kept = Object.fromEntries(Object.entries(links.data as KoboActivityLinks).filter(([uid]) => uids.includes(uid)));
      await tx.update(s.projectState).set({ data: kept, updatedAt: new Date() }).where(and(eq(s.projectState.projectId, project.id), eq(s.projectState.key, ACTIVITIES_KEY)));
    }
  });
}

/** Replaces every mapping on the project. Each indicator has at most one. */
export async function saveMappings(code: string, mappings: KoboMapping[], by: string) {
  const project = await projectRow(code);
  const inds = await db.select().from(s.indicators).where(eq(s.indicators.projectId, project.id));
  const linked = await db.select().from(s.koboForms).where(eq(s.koboForms.projectId, project.id));
  const forms = new Set(linked.map((f) => f.assetUid));
  const distribution = new Set(linked.filter((f) => f.purpose === "distribution").map((f) => f.assetUid));
  for (const m of mappings) {
    if (distribution.has(m.assetUid)) throw new KoboError(`An input distribution form is not mapped to a target here. Choose the target in Field activities, Input package: every distribution the project manager approves counts toward it.`);
    if (!inds.some((i) => i.code === m.indicatorCode)) throw new KoboError(`No target ${m.indicatorCode} on this project.`);
    if (!forms.has(m.assetUid)) throw new KoboError("A mapping uses a form that is not chosen for this project.");
    if (m.method === "count_answer" && !m.value) throw new KoboError(`Say which answer counts for ${m.indicatorCode}.`);
    const b = m.breakdown;
    if (b?.shape === "person" && b.sex && (!b.female || !b.male || b.female === b.male)) throw new KoboError(`Say which answer means a woman and which means a man for ${m.indicatorCode}.`);
  }
  const breakdowns: BreakdownDoc = Object.fromEntries(mappings.filter((m) => hasBreakdown(m.breakdown)).map((m) => [m.indicatorCode, { assetUid: m.assetUid, breakdown: m.breakdown! }]));
  await db.transaction(async (tx) => {
    if (inds.length) await tx.delete(s.koboMappings).where(inArray(s.koboMappings.indicatorId, inds.map((i) => i.id)));
    if (mappings.length)
      await tx.insert(s.koboMappings).values(
        mappings.map((m) => ({ indicatorId: inds.find((i) => i.code === m.indicatorCode)!.id, assetUid: m.assetUid, question: m.question, method: m.method, value: m.method === "count_answer" ? m.value : null, origin: m.origin ?? "manual" })),
      );
    await tx
      .insert(s.projectState)
      .values({ projectId: project.id, key: BREAKDOWN_KEY, data: breakdowns })
      .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data: breakdowns, updatedAt: new Date() } });
    // Which question counts toward which indicator, and whether a person chose it or accepted a suggestion.
    await logAudit(tx, project.id, { entity: "project", entityId: project.id, action: "kobo_mappings_saved", by, detail: { mappings: mappings.map((m) => ({ indicator: m.indicatorCode, form: m.assetUid, question: m.question, method: m.method, value: m.value, origin: m.origin ?? "manual", ...(breakdowns[m.indicatorCode] ? { breakdown: breakdowns[m.indicatorCode].breakdown } : {}) })) } });
  });
}

const CHUNK = 200;
const chunks = <T,>(xs: T[], n = CHUNK) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const statusOf = (v: unknown) => ((v as { uid?: string } | null | undefined)?.uid ?? null) || null;

/**
 * Brings the project's copy of each chosen form up to date with KoboToolbox. Safe to repeat.
 *
 * Full submissions are downloaded only when new or edited. Every sync also reads a short list of
 * all submissions (number, ID, approval status), so approvals, edits and deletions made in
 * KoboToolbox are never missed. Every answer of every submission is still stored, unchanged.
 *
 * Submissions whose hidden project_code names another project are left out, so a form reused by
 * several projects gives each only its own. Readiness submissions go to the review queue; once a
 * reviewer has decided one, later edits in KoboToolbox are written to the audit log instead of
 * changing what was decided.
 */
export async function sync(code: string, origin?: string): Promise<SyncCounts> {
  const c = await credentials(code);
  const forms = await db.select().from(s.koboForms).where(eq(s.koboForms.projectId, c.project.id));
  const counts: SyncCounts = { fetched: 0, added: 0, already: 0, updated: 0, removed: 0, forms: forms.length };
  // Questions indicators count from: their personal answers become fingerprints, not removed (kobo-protect).
  const counted = new Set((await db.select({ q: s.koboMappings.question }).from(s.koboMappings).innerJoin(s.indicators, eq(s.indicators.id, s.koboMappings.indicatorId)).where(eq(s.indicators.projectId, c.project.id))).map((r) => r.q));
  const keep = (x: KoboSubmission) => protectSubmission(x, c.project.id, counted);
  for (const f of forms) {
    // Readiness and distribution forms are reviewed one by one before they count (MEL accepts a
    // readiness check; the project manager approves a distribution). "readiness" below means that.
    const readiness = isReviewed(f.purpose);
    const ours = (x: object) => {
      const pc = (x as { project_code?: unknown }).project_code;
      return pc === undefined || pc === null || pc === "" || pc === code;
    };
    const refs = (await submissionRefs(c.server, c.token, f.assetUid)).filter((r) => Number.isInteger(r._id) && typeof r._uuid === "string" && ours(r));
    counts.fetched += refs.length;
    const mine = and(eq(s.evidence.projectId, c.project.id), eq(s.evidence.koboAssetUid, f.assetUid), eq(s.evidence.source, "kobo"));
    const local = await db
      .select({ id: s.evidence.id, num: s.evidence.koboSubmissionId, uuid: s.evidence.koboSubmissionUuid, removedAt: s.evidence.koboRemovedAt, review: s.evidence.reviewStatus, status: sql<string | null>`${s.evidence.payload} -> '_validation_status' ->> 'uid'` })
      .from(s.evidence)
      .where(mine);
    const byNum = new Map(local.filter((l) => l.num !== null).map((l) => [l.num!, l]));
    const byUuid = new Map(local.map((l) => [l.uuid, l]));
    const lastNum = Math.max(0, ...byNum.keys());

    const fresh: number[] = []; // not stored yet
    const edited: { row: (typeof local)[number]; num: number }[] = []; // same number, new _uuid
    // Same submission, only the approval status changed, or a record synced before submission
    // numbers were kept (the number is filled in; not reported as a change).
    const touch: { id: string; num: number; status: unknown; changed: boolean }[] = [];
    const back: string[] = []; // deleted earlier, present again
    for (const r of refs) {
      const row = byNum.get(r._id) ?? byUuid.get(r._uuid!);
      if (!row) fresh.push(r._id);
      else if (row.uuid !== r._uuid) edited.push({ row, num: r._id });
      else {
        const changed = statusOf(r._validation_status) !== row.status;
        if (changed || row.num === null) touch.push({ id: row.id, num: r._id, status: r._validation_status ?? {}, changed });
        if (row.removedAt) back.push(row.id);
      }
    }
    const seen = new Set(refs.map((r) => r._id));
    const seenUuid = new Set(refs.map((r) => r._uuid));
    const gone = local.filter((l) => !l.removedAt && !(l.num !== null ? seen.has(l.num) : seenUuid.has(l.uuid ?? undefined))).map((l) => l.id);

    // Download whole submissions only where needed: new ones past the last stored number in one
    // paged request, anything else (edits, gaps) by number.
    const above = fresh.filter((n) => n > lastNum);
    const byNumber = [...fresh.filter((n) => n <= lastNum), ...edited.map((e) => e.num)];
    const subs = [
      ...(above.length ? await formSubmissions(c.server, c.token, f.assetUid, { _id: { $gt: lastNum } }) : []),
      ...(await Promise.all(chunks(byNumber).map((ids) => formSubmissions(c.server, c.token, f.assetUid, { _id: { $in: ids } })))).flat(),
    ].filter((x) => Number.isInteger(x._id) && typeof x._uuid === "string" && ours(x));
    const full = new Map(subs.map((x) => [x._id as number, x]));
    const completedAt = (x: KoboSubmission) => (typeof x._submission_time === "string" ? new Date(x._submission_time) : null);
    const now = new Date();

    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    // Readiness checks carry who, which farmer and where, as the review queue shows them.
    const kind = (x: KoboSubmission) =>
      readiness
        ? { form: f.purpose, reviewStatus: "pending" as const, farmerCode: str(x.farmer), completedBy: str(x._submitted_by), location: str(x.location) }
        : { form: null, reviewStatus: "accepted" as const, completedBy: str(x._submitted_by) };

    await db.transaction(async (tx) => {
      // Stored before this form was marked readiness: never reviewed, so they go to the queue.
      if (readiness) await tx.update(s.evidence).set({ form: f.purpose, reviewStatus: "pending", updatedAt: now }).where(and(mine, isNull(s.evidence.form)));

      const rows = fresh.flatMap((n) => {
        const x = full.get(n);
        return x ? [{ organizationId: c.project.organizationId, projectId: c.project.id, source: "kobo" as const, koboAssetUid: f.assetUid, koboSubmissionId: n, koboSubmissionUuid: x._uuid!, completedAt: completedAt(x), payload: keep(x), ...kind(x) }] : [];
      });
      for (const part of chunks(rows, 500))
        await tx
          .insert(s.evidence)
          .values(part)
          .onConflictDoUpdate({ target: [s.evidence.projectId, s.evidence.koboSubmissionUuid], set: { payload: sql`excluded.payload`, koboSubmissionId: sql`excluded.kobo_submission_id`, koboRemovedAt: null, updatedAt: now } });
      counts.added += rows.length;

      for (const e of edited) {
        const x = full.get(e.num);
        if (!x) continue;
        if (readiness && e.row.review !== "pending") {
          // Already decided (and, if accepted, applied to the farmer): keep what was decided and
          // record the edit for the audit trail.
          await tx.update(s.evidence).set({ koboSubmissionId: e.num, koboSubmissionUuid: x._uuid!, koboRemovedAt: null, updatedAt: now }).where(eq(s.evidence.id, e.row.id));
          // The edit is recorded, not the answers: a copy here could keep personal data the submission no longer holds.
          await tx.insert(s.auditLog).values({ projectId: c.project.id, entity: "evidence", entityId: e.row.id, action: "edited_in_kobo_after_review", detail: { review: e.row.review, submission: e.num } });
        } else {
          await tx.update(s.evidence).set({ koboSubmissionId: e.num, koboSubmissionUuid: x._uuid!, completedAt: completedAt(x), payload: keep(x), ...(readiness ? { farmerCode: str(x.farmer), completedBy: str(x._submitted_by), location: str(x.location) } : {}), koboRemovedAt: null, updatedAt: now }).where(eq(s.evidence.id, e.row.id));
        }
        counts.updated += 1;
      }

      // Only the status inside the stored submission changes; everything else stays as received.
      for (const part of chunks(touch, 500)) {
        const values = sql.join(part.map((r) => sql`(${r.id}::uuid, ${JSON.stringify(r.status)}::jsonb, ${r.num}::integer)`), sql`, `);
        await tx.execute(sql`
          update ${s.evidence} as e
          set payload = jsonb_set(coalesce(e.payload, '{}'::jsonb), '{_validation_status}', v.status),
              kobo_submission_id = v.num, updated_at = ${now.toISOString()}::timestamptz
          from (values ${values}) as v(id, status, num)
          where e.id = v.id`);
      }
      counts.updated += touch.filter((r) => r.changed).length;

      for (const ids of chunks(back)) await tx.update(s.evidence).set({ koboRemovedAt: null, updatedAt: now }).where(inArray(s.evidence.id, ids));
      for (const ids of chunks(gone)) await tx.update(s.evidence).set({ koboRemovedAt: now, updatedAt: now }).where(inArray(s.evidence.id, ids));
      counts.removed += gone.length;
    });
    counts.already += refs.length - fresh.length - edited.length;
  }
  await db.update(s.koboConnections).set({ lastSyncedAt: new Date() }).where(eq(s.koboConnections.id, c.connection.id));
  // Anything kept for this request (server/request-memo) is older than the records just written.
  requestWrote();
  // New distributions: checks, flags and the email to the project manager.
  if (forms.some((f) => f.purpose === "distribution")) {
    const { processPending } = await import("@/server/distribution");
    await processPending(code, origin);
  }
  return counts;
}

/* ---------- indicator values from mappings ---------- */

const answer = (p: Record<string, unknown>, q: string) => {
  const v = p[q];
  return v === null || v === undefined ? "" : String(v).trim();
};

type Mapped = { method: MappingMethod; question: string; value: string | null };
type Row = { date: string; payload: Record<string, unknown> };

/** One indicator's value from submissions: count, distinct answers or a sum. */
export function mappedValue(m: Mapped, rows: Row[]) {
  const hits = rows.filter((r) => {
    const a = answer(r.payload, m.question);
    if (!a) return false;
    // Multiple-choice answers come as space-separated choice names.
    if (m.method === "count_answer") return a.split(/\s+/).includes(m.value ?? "");
    if (m.method === "sum") return Number.isFinite(Number(a));
    return true;
  });
  const value =
    m.method === "sum" ? hits.reduce((t, r) => t + Number(answer(r.payload, m.question)), 0) : m.method === "count_unique" ? new Set(hits.map((r) => answer(r.payload, m.question))).size : hits.length;
  return { value, dates: hits.map((r) => r.date) };
}

/** Mappings with the submissions they read from, for the project's Progress. */
export async function mappedInputs(projectId: string) {
  const rows = await db
    .select({ code: s.indicators.code, m: s.koboMappings })
    .from(s.koboMappings)
    .innerJoin(s.indicators, eq(s.indicators.id, s.koboMappings.indicatorId))
    .where(eq(s.indicators.projectId, projectId));
  if (!rows.length) return new Map<string, { mapping: Mapped; counted: Row[]; waiting: number }>();
  const c = await connectionOf(projectId);
  const approvedOnly = c?.countOnly === "approved";
  // One query per mapping, reading just that question's answer (as stored JSON, so the counting
  // rules see exactly what they would in the whole submission) and the approval status.
  return new Map(
    await Promise.all(
      rows.map(async ({ code, m }) => {
        const mine = await db
          .select({ at: s.evidence.completedAt, answer: sql<unknown>`${s.evidence.payload} -> ${m.question}`, status: sql<string | null>`${s.evidence.payload} -> '_validation_status' ->> 'uid'`, form: s.evidence.form, review: s.evidence.reviewStatus })
          .from(s.evidence)
          .where(and(eq(s.evidence.projectId, projectId), eq(s.evidence.koboAssetUid, m.assetUid), isNull(s.evidence.koboRemovedAt)));
        // Readiness records count only once accepted in the review queue; until then they wait.
        const counted = mine.filter((e) => (e.form === null || e.review === "accepted") && (!approvedOnly || e.status === "validation_status_approved"));
        return [
          code,
          {
            mapping: { method: m.method as MappingMethod, question: m.question, value: m.value },
            counted: counted.map((e) => ({ date: (e.at?.toISOString() ?? "").slice(0, 10), payload: { [m.question]: e.answer } as Record<string, unknown> })),
            waiting: mine.length - counted.length,
          },
        ] as const;
      }),
    ),
  );
}

/** Kobo and setup problems the person can fix go back as a readable 400; anything else is a server error. */
export async function readable(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof KoboError || e instanceof MissingKeyError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
