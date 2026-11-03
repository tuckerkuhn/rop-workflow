import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { KoboMapping, KoboState, MappingMethod, SyncCounts } from "@/lib/kobo-setup";
import { KoboError, checkServerUrl, formQuestions, formSubmissions, listForms } from "@/server/kobo-client";
import { MissingKeyError, decryptSecret, encryptSecret } from "@/server/secrets";

/**
 * A project's own KoboToolbox link: the account, the forms that belong to the project, and how
 * each indicator is counted from a form question. Synced submissions go into `evidence` with no
 * `form`, so they stay out of the readiness review queue and count only through mappings.
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

async function credentials(code: string) {
  const project = await projectRow(code);
  const c = await connectionOf(project.id);
  if (!c) throw new KoboError("Connect KoboToolbox first.");
  return { project, connection: c, server: c.serverUrl, token: decryptSecret(c.tokenEncrypted) };
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
    connection: c && { serverUrl: c.serverUrl, tokenHint: c.tokenHint, countOnly: c.countOnly === "approved" ? "approved" : "all", lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null },
    forms: forms.map((f) => ({ uid: f.assetUid, name: f.name })),
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

export async function liveForms(code: string) {
  const c = await credentials(code);
  return listForms(c.server, c.token);
}

export async function liveQuestions(code: string, uid: string) {
  const c = await credentials(code);
  return formQuestions(c.server, c.token, uid);
}

/** Replaces the project's forms. Mappings to forms no longer chosen are removed. */
export async function saveForms(code: string, forms: { uid: string; name: string }[]) {
  const { project } = await credentials(code);
  const uids = forms.map((f) => f.uid);
  await db.transaction(async (tx) => {
    const mine = eq(s.koboForms.projectId, project.id);
    await tx.delete(s.koboForms).where(uids.length ? and(mine, notInArray(s.koboForms.assetUid, uids)) : mine);
    for (const f of forms)
      await tx
        .insert(s.koboForms)
        .values({ projectId: project.id, assetUid: f.uid, name: f.name })
        .onConflictDoUpdate({ target: [s.koboForms.projectId, s.koboForms.assetUid], set: { name: f.name, updatedAt: new Date() } });
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

/** Pulls every submission on the chosen forms. Safe to repeat: known submissions are refreshed, not added twice. */
export async function sync(code: string): Promise<SyncCounts> {
  const c = await credentials(code);
  const forms = await db.select().from(s.koboForms).where(eq(s.koboForms.projectId, c.project.id));
  const counts: SyncCounts = { fetched: 0, added: 0, already: 0, forms: forms.length };
  for (const f of forms) {
    const subs = (await formSubmissions(c.server, c.token, f.assetUid)).filter((x) => typeof x._uuid === "string");
    counts.fetched += subs.length;
    const known = new Set(
      subs.length
        ? (await db.select({ uuid: s.evidence.koboSubmissionUuid }).from(s.evidence).where(and(eq(s.evidence.projectId, c.project.id), inArray(s.evidence.koboSubmissionUuid, subs.map((x) => x._uuid as string))))).map((r) => r.uuid)
        : [],
    );
    for (const sub of subs) {
      const uuid = sub._uuid as string;
      const completedAt = typeof sub._submission_time === "string" ? new Date(sub._submission_time) : null;
      if (known.has(uuid)) {
        // Refresh, so approvals made in KoboToolbox since the last sync count.
        await db.update(s.evidence).set({ payload: sub, updatedAt: new Date() }).where(and(eq(s.evidence.koboSubmissionUuid, uuid), eq(s.evidence.projectId, c.project.id)));
        counts.already += 1;
      } else {
        await db
          .insert(s.evidence)
          .values({ organizationId: c.project.organizationId, projectId: c.project.id, source: "kobo", koboAssetUid: f.assetUid, koboSubmissionUuid: uuid, completedAt, payload: sub, reviewStatus: "accepted" })
          .onConflictDoNothing({ target: [s.evidence.projectId, s.evidence.koboSubmissionUuid] });
        counts.added += 1;
      }
    }
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
  const evidence = await db
    .select({ asset: s.evidence.koboAssetUid, at: s.evidence.completedAt, payload: s.evidence.payload })
    .from(s.evidence)
    .where(and(eq(s.evidence.projectId, projectId), inArray(s.evidence.koboAssetUid, [...new Set(rows.map((r) => r.m.assetUid))])));
  return new Map(
    rows.map(({ code, m }) => {
      const mine = evidence.filter((e) => e.asset === m.assetUid);
      const approved = (p: Record<string, unknown>) => (p._validation_status as { uid?: string } | undefined)?.uid === "validation_status_approved";
      const counted = mine.filter((e) => !approvedOnly || approved(e.payload as Record<string, unknown>));
      return [
        code,
        {
          mapping: { method: m.method as MappingMethod, question: m.question, value: m.value },
          counted: counted.map((e) => ({ date: (e.at?.toISOString() ?? "").slice(0, 10), payload: (e.payload ?? {}) as Record<string, unknown> })),
          waiting: mine.length - counted.length,
        },
      ];
    }),
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
