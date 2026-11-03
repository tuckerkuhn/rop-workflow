import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AutoSyncSecret, FormPurpose, KoboMapping, KoboState, MappingMethod, SyncCounts } from "@/lib/kobo-setup";
import { KoboError, checkServerUrl, formQuestions, formSubmissions, listForms, submissionRefs, type KoboSubmission } from "@/server/kobo-client";
import { MissingKeyError, decryptSecret, encryptSecret } from "@/server/secrets";

/**
 * A project's own KoboToolbox link: the account, the forms that belong to the project, and how
 * each indicator is counted from a form question. This is the only way Kobo data comes in.
 *
 * Each linked form has a purpose. Readiness forms: each submission is stored with form
 * "readiness" and waits in the review queue; it counts only once accepted. Data forms: stored
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

const purposeOf = (v: string): FormPurpose => (v === "readiness" ? "readiness" : "data");

/** The project's linked readiness forms, with the account to reach them. */
export async function readinessForms(code: string) {
  const c = await credentials(code);
  const forms = await db.select().from(s.koboForms).where(and(eq(s.koboForms.projectId, c.project.id), eq(s.koboForms.purpose, "readiness")));
  if (!forms.length) throw new KoboError("No readiness form is linked to this project. In Setup, choose the form and mark it as the readiness check.");
  return { ...c, forms };
}

export async function koboState(code: string): Promise<KoboState> {
  const [project] = await db.select().from(s.projects).where(eq(s.projects.code, code)).limit(1);
  if (!project) return { connection: null, forms: [], mappings: [] };
  const c = await connectionOf(project.id);
  const forms = await db.select().from(s.koboForms).where(eq(s.koboForms.projectId, project.id));
  const mappings = await db
    .select({ code: s.indicators.code, m: s.koboMappings })
    .from(s.koboMappings)
    .innerJoin(s.indicators, eq(s.indicators.id, s.koboMappings.indicatorId))
    .where(eq(s.indicators.projectId, project.id));
  return {
    connection: c && { serverUrl: c.serverUrl, tokenHint: c.tokenHint, countOnly: c.countOnly === "approved" ? "approved" : "all", lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null, autoSyncSince: c.hookSecretHash ? (c.hookEnabledAt?.toISOString() ?? null) : null },
    forms: forms.map((f) => ({ uid: f.assetUid, name: f.name, purpose: purposeOf(f.purpose) })),
    mappings: mappings.map(({ code, m }) => ({ indicatorCode: code, assetUid: m.assetUid, question: m.question, method: m.method as MappingMethod, value: m.value })),
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

/** Forgets the account, the chosen forms and the mappings. Submissions already synced stay as records. */
export async function disconnect(code: string) {
  const project = await projectRow(code);
  const ids = (await db.select({ id: s.indicators.id }).from(s.indicators).where(eq(s.indicators.projectId, project.id))).map((r) => r.id);
  if (ids.length) await db.delete(s.koboMappings).where(inArray(s.koboMappings.indicatorId, ids));
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
  });
}

/** Replaces every mapping on the project. Each indicator has at most one. */
export async function saveMappings(code: string, mappings: KoboMapping[]) {
  const project = await projectRow(code);
  const inds = await db.select().from(s.indicators).where(eq(s.indicators.projectId, project.id));
  const forms = new Set((await db.select().from(s.koboForms).where(eq(s.koboForms.projectId, project.id))).map((f) => f.assetUid));
  for (const m of mappings) {
    if (!inds.some((i) => i.code === m.indicatorCode)) throw new KoboError(`No indicator ${m.indicatorCode} on this project.`);
    if (!forms.has(m.assetUid)) throw new KoboError("A mapping uses a form that is not chosen for this project.");
    if (m.method === "count_answer" && !m.value) throw new KoboError(`Say which answer counts for ${m.indicatorCode}.`);
  }
  await db.transaction(async (tx) => {
    if (inds.length) await tx.delete(s.koboMappings).where(inArray(s.koboMappings.indicatorId, inds.map((i) => i.id)));
    if (mappings.length)
      await tx.insert(s.koboMappings).values(
        mappings.map((m) => ({ indicatorId: inds.find((i) => i.code === m.indicatorCode)!.id, assetUid: m.assetUid, question: m.question, method: m.method, value: m.method === "count_answer" ? m.value : null })),
      );
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
export async function sync(code: string): Promise<SyncCounts> {
  const c = await credentials(code);
  const forms = await db.select().from(s.koboForms).where(eq(s.koboForms.projectId, c.project.id));
  const counts: SyncCounts = { fetched: 0, added: 0, already: 0, updated: 0, removed: 0, forms: forms.length };
  for (const f of forms) {
    const readiness = f.purpose === "readiness";
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
        ? { form: "readiness", reviewStatus: "pending" as const, farmerCode: str(x.farmer), completedBy: str(x._submitted_by), location: str(x.location) }
        : { form: null, reviewStatus: "accepted" as const };

    await db.transaction(async (tx) => {
      // Stored before this form was marked readiness: never reviewed, so they go to the queue.
      if (readiness) await tx.update(s.evidence).set({ form: "readiness", reviewStatus: "pending", updatedAt: now }).where(and(mine, isNull(s.evidence.form)));

      const rows = fresh.flatMap((n) => {
        const x = full.get(n);
        return x ? [{ organizationId: c.project.organizationId, projectId: c.project.id, source: "kobo" as const, koboAssetUid: f.assetUid, koboSubmissionId: n, koboSubmissionUuid: x._uuid!, completedAt: completedAt(x), payload: x, ...kind(x) }] : [];
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
          await tx.insert(s.auditLog).values({ projectId: c.project.id, entity: "evidence", entityId: e.row.id, action: "edited_in_kobo_after_review", detail: { review: e.row.review, payload: x } });
        } else {
          await tx.update(s.evidence).set({ koboSubmissionId: e.num, koboSubmissionUuid: x._uuid!, completedAt: completedAt(x), payload: x, ...(readiness ? { farmerCode: str(x.farmer), completedBy: str(x._submitted_by), location: str(x.location) } : {}), koboRemovedAt: null, updatedAt: now }).where(eq(s.evidence.id, e.row.id));
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
