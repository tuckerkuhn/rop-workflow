import { vouchesForFieldData } from "@/server/kobo-approval";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { proofCount, quarterOf, type Correction, type PhotoPlaces, type ResultInput, type ResultRecord, type UpdateInput, type UpdateRecord } from "@/lib/results";
import { canSeePII, type AppUser } from "@/lib/demo";
import type { z } from "zod";
import type { correctionSchema } from "@/lib/results";
import { logAudit } from "@/server/audit";

type CorrectionInput = z.infer<typeof correctionSchema>;
import { projectByCode } from "@/server/field-store";
import { people } from "@/server/auth";
import { oncePerRequest } from "@/server/request-memo";

/** Recorded results, kept as evidence records (source "manual", form "result"). */

const toRecord = (r: typeof s.evidence.$inferSelect): ResultRecord => {
  const p = r.payload as ResultInput;
  return {
    ...p,
    id: r.id,
    quarter: quarterOf(p.date),
    status: r.reviewStatus,
    by: r.completedBy ?? "",
    at: r.createdAt.toISOString(),
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    query: r.queryNote,
  };
};

export async function loadResults(code: string): Promise<ResultRecord[]> {
  // Read once per read-only request (server/request-memo): the report, the budget view and Home each ask.
  // Every caller gets its own list, so one sorting or filtering it in place cannot change another's.
  return [...(await oncePerRequest(`results:${code}`, () => readResults(code)))];
}

async function readResults(code: string): Promise<ResultRecord[]> {
  const project = await projectByCode(code);
  const rows = await db
    .select()
    .from(s.evidence)
    .where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.source, "manual"), eq(s.evidence.form, "result")));
  const names = new Map((await people()).map((u) => [u.id, u.name]));
  return rows
    .map(toRecord)
    .map((r) => ({ ...r, byName: names.get(r.by) ?? r.by, reviewedByName: r.reviewedBy ? (names.get(r.reviewedBy) ?? r.reviewedBy) : null }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Accepted results that no longer match KoboToolbox: the submission behind them was changed or
 * deleted after MEL accepted the figure. The sync notes each such change in the audit log, and
 * notes it again when the two agree once more; a result is listed while its latest note is a
 * change made after it was last accepted. MEL reopens it and the next sync brings the new figure
 * back to check. Until then the accepted figure stands and the report differs from its source.
 */
export async function koboMismatches(projectId: string): Promise<Set<string>> {
  const notes = await db
    .select({ id: s.auditLog.entityId, action: s.auditLog.action, at: s.auditLog.at })
    .from(s.auditLog)
    .where(and(eq(s.auditLog.projectId, projectId), inArray(s.auditLog.action, ["kobo_changed_after_acceptance", "kobo_matches_again"])))
    .orderBy(asc(s.auditLog.at), asc(s.auditLog.sequence));
  const latest = new Map(notes.map((n) => [n.id, n]));
  const changed = [...latest.values()].filter((n) => n.action === "kobo_changed_after_acceptance");
  if (!changed.length) return new Set();
  const rows = await db
    .select({ id: s.evidence.id, reviewedAt: s.evidence.reviewedAt })
    .from(s.evidence)
    .where(and(eq(s.evidence.projectId, projectId), eq(s.evidence.form, "result"), eq(s.evidence.reviewStatus, "accepted"), inArray(s.evidence.id, changed.map((n) => n.id))));
  const acceptedAt = new Map(rows.map((r) => [r.id, r.reviewedAt]));
  return new Set(changed.filter((n) => acceptedAt.has(n.id) && (!acceptedAt.get(n.id) || n.at > acceptedAt.get(n.id)!)).map((n) => n.id));
}

/** Many results at once, in one transaction: all are saved or none. */
export async function addResults(code: string, inputs: ResultInput[], by: string) {
  const project = await projectByCode(code);
  await db.transaction(async (tx) => {
    for (const input of inputs) await insertResult(tx, project, input, by);
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** One result, pending for MEL, inside a transaction the caller already has open. */
export async function insertResult(tx: Tx, project: Awaited<ReturnType<typeof projectByCode>>, input: ResultInput, by: string) {
  const [r] = await tx
    .insert(s.evidence)
    .values({
      organizationId: project.organizationId,
      projectId: project.id,
      source: "manual",
      form: "result",
      reviewStatus: "pending",
      completedBy: by,
      completedAt: new Date(`${input.date}T12:00:00Z`),
      location: [input.district, input.province].filter(Boolean).join(", ") || null,
      payload: input,
    })
    .returning();
  await logAudit(tx, project.id, { entity: "result", entityId: r.id, action: "result_recorded", by, detail: { indicator: input.indicator, value: input.value, date: input.date, proof: proofCount(input) } });
  return r;
}

export async function addResult(code: string, input: ResultInput, by: string) {
  const project = await projectByCode(code);
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(s.evidence)
      .values({
        organizationId: project.organizationId,
        projectId: project.id,
        source: "manual",
        form: "result",
        reviewStatus: "pending",
        completedBy: by,
        completedAt: new Date(`${input.date}T12:00:00Z`),
        location: [input.district, input.province].filter(Boolean).join(", ") || null,
        payload: input,
      })
      .returning();
    await logAudit(tx, project.id, { entity: "result", entityId: r.id, action: "result_recorded", by, detail: { indicator: input.indicator, value: input.value, date: input.date, proof: proofCount(input) } });
    return r;
  });
  return toRecord(row);
}

export async function reviewResult(code: string, id: string, status: "accepted" | "queried", by: string, note: string | null, extra?: Record<string, unknown>) {
  const project = await projectByCode(code);
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(s.evidence)
      .set({ reviewStatus: status, reviewedBy: by, reviewedAt: new Date(), queryNote: note, updatedAt: new Date() })
      // Only while still pending: two reviewers at once cannot both decide it.
      .where(and(eq(s.evidence.id, id), eq(s.evidence.projectId, project.id), eq(s.evidence.form, "result"), eq(s.evidence.reviewStatus, "pending")))
      .returning();
    if (r) {
      const p = r.payload as ResultInput;
      await logAudit(tx, project.id, { entity: "result", entityId: r.id, action: status === "accepted" ? "result_accepted" : "result_queried", by, detail: { indicator: p.indicator, value: p.value, date: p.date, note, ...(extra ?? {}) } });
    }
    return r;
  });
  return row ? toRecord(row) : null;
}

/**
 * MEL reopens an accepted result: it goes back to its recorder as queried, with MEL's reason,
 * and stops counting until it is accepted again. Only while still accepted.
 */
export async function reopenResult(code: string, id: string, by: string, note: string) {
  const project = await projectByCode(code);
  return db.transaction(async (tx) => {
    const [r] = await tx
      .update(s.evidence)
      .set({ reviewStatus: "queried", reviewedBy: by, reviewedAt: new Date(), queryNote: note, updatedAt: new Date() })
      .where(and(eq(s.evidence.id, id), eq(s.evidence.projectId, project.id), eq(s.evidence.form, "result"), eq(s.evidence.reviewStatus, "accepted")))
      .returning();
    if (!r) return null;
    const p = r.payload as ResultInput;
    await logAudit(tx, project.id, { entity: "result", entityId: r.id, action: "result_reopened", by, detail: { indicator: p.indicator, value: p.value, date: p.date, note } });
    return toRecord(r);
  });
}

/**
 * Adds proof to a recorded result. Files and links are appended (the same file or link once);
 * the figure, date and review status stay as they are.
 */
export async function addProof(code: string, id: string, add: { files: ResultInput["files"]; links: NonNullable<ResultInput["links"]>; captions?: ResultInput["captions"]; taken?: ResultInput["taken"]; by: string }) {
  const project = await projectByCode(code);
  const where = and(eq(s.evidence.id, id), eq(s.evidence.projectId, project.id), eq(s.evidence.form, "result"));
  const [row] = await db.select().from(s.evidence).where(where);
  if (!row) return null;
  const p = row.payload as ResultInput;
  const files = [...p.files, ...add.files.filter((f) => !p.files.some((x) => x.hash === f.hash))].slice(0, 20);
  const links = [...(p.links ?? []), ...add.links.filter((l) => !(p.links ?? []).some((x) => x.url === l.url))].slice(0, 20);
  const captions = { ...(p.captions ?? {}), ...(add.captions ?? {}) };
  const taken = { ...(p.taken ?? {}), ...(add.taken ?? {}) };
  const payload: ResultInput = { ...p, files, links, ...(Object.keys(captions).length ? { captions } : {}), ...(Object.keys(taken).length ? { taken } : {}) };
  const updated = await db.transaction(async (tx) => {
    const [r] = await tx.update(s.evidence).set({ payload, updatedAt: new Date() }).where(where).returning();
    await logAudit(tx, project.id, { entity: "result", entityId: r.id, action: "proof_added", by: add.by, detail: { indicator: p.indicator, date: p.date, files: add.files.map((f) => f.name), links: add.links } });
    return r;
  });
  return toRecord(updated);
}

/**
 * The recorder corrects a queried result: the new figures replace the old, the old ones, MEL's
 * question and the reply go into the record's history, and it goes back to MEL as pending.
 */
export async function correctResult(code: string, id: string, changes: CorrectionInput, reply: string, by: string): Promise<string | null> {
  const project = await projectByCode(code);
  const where = and(eq(s.evidence.id, id), eq(s.evidence.projectId, project.id), eq(s.evidence.form, "result"));
  const [row] = await db.select().from(s.evidence).where(where);
  if (!row) return "No such result.";
  if (row.reviewStatus !== "queried") return "Only a result MEL has queried can be corrected.";
  if (row.completedBy !== by) return "Only the person who recorded this result can correct it.";
  const p = row.payload as ResultInput & { history?: Correction[] };
  const keys = ["date", "value", "female", "male", "youth", "womenLed", "menLed", "province", "district", "note"] as const;
  const previous = Object.fromEntries(keys.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])) as Partial<ResultInput>;
  const next = { ...p, ...Object.fromEntries(keys.map((k) => [k, changes[k]])), history: [...(p.history ?? []), { at: new Date().toISOString(), by, query: row.queryNote, reply, previous }] };
  for (const k of keys) if (next[k] === undefined || next[k] === "") delete (next as Record<string, unknown>)[k];
  await db.transaction(async (tx) => {
    await tx
      .update(s.evidence)
      .set({ payload: next, reviewStatus: "pending", reviewedBy: null, reviewedAt: null, queryNote: null, completedAt: new Date(`${changes.date}T12:00:00Z`), location: [changes.district, changes.province].filter(Boolean).join(", ") || null, updatedAt: new Date() })
      .where(where);
    await logAudit(tx, project.id, { entity: "result", entityId: id, action: "result_corrected", by, detail: { indicator: p.indicator, query: row.queryNote, reply, before: { value: p.value, date: p.date }, after: { value: changes.value, date: changes.date } } });
  });
  return null;
}

/* ---------- activity updates (form "update"): narrative and photos, never counted ---------- */

export async function loadUpdates(code: string): Promise<UpdateRecord[]> {
  const project = await projectByCode(code);
  const rows = await db
    .select()
    .from(s.evidence)
    .where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.source, "manual"), eq(s.evidence.form, "update")));
  return rows
    .map((r) => {
      // Where the photos were taken stays behind: every screen, report and copy reads updates here,
      // and none of them may pass a point on by accident. See updatePlaces.
      const { places: _kept, ...p } = r.payload as UpdateInput;
      void _kept;
      return { ...p, id: r.id, quarter: quarterOf(p.date), by: r.completedBy ?? "", at: r.createdAt.toISOString() };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Where the photos on each update were taken, by update id and file fingerprint. Only for a person
 * who may see participant names, and for the one person the project names to approve KoboCollect
 * data (the Director of MEL), who vouches for field data (server/kobo-approval
 * vouchesForFieldData). A point can be where a farmer lives. Anyone else gets nothing.
 */
export async function updatePlaces(code: string, viewer: AppUser | null | undefined): Promise<Map<string, PhotoPlaces>> {
  const out = new Map<string, PhotoPlaces>();
  if (!canSeePII(viewer) && !(await vouchesForFieldData(code, viewer))) return out;
  const project = await projectByCode(code);
  const rows = await db
    .select({ id: s.evidence.id, payload: s.evidence.payload })
    .from(s.evidence)
    .where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.source, "manual"), eq(s.evidence.form, "update")));
  for (const r of rows) {
    const p = r.payload as UpdateInput;
    const places = placesOn(p.files, p.places);
    if (places) out.set(r.id, places);
  }
  return out;
}

/** The places of the photos that are on the item, and of no other file. */
const placesOn = (files: UpdateInput["files"], ...from: (PhotoPlaces | undefined)[]): PhotoPlaces | null => {
  const out: PhotoPlaces = {};
  for (const f of files) {
    const at = from.map((m) => m?.[f.hash]).find(Boolean);
    if (at) out[f.hash] = at;
  }
  return Object.keys(out).length ? out : null;
};
const withPlaces = (input: UpdateInput, places: PhotoPlaces | null): UpdateInput => {
  const { places: _sent, ...rest } = input;
  void _sent;
  return places ? { ...rest, places } : rest;
};

/** One activity update, or null. */
export async function updateById(code: string, id: string) {
  return (await loadUpdates(code)).find((u) => u.id === id) ?? null;
}

/**
 * Replaces an update's text and photos. The caller checks that its week has not been sent.
 * A photo that stays on the item keeps the place stored for it: the person editing may not be
 * allowed to see places, so their screen never held them and cannot send them back. A photo added
 * in this edit brings the place its own phone read.
 */
export async function editUpdate(code: string, id: string, input: UpdateInput, by: string) {
  const project = await projectByCode(code);
  const where = and(eq(s.evidence.id, id), eq(s.evidence.projectId, project.id), eq(s.evidence.form, "update"));
  return db.transaction(async (tx) => {
    const [old] = await tx.select({ payload: s.evidence.payload }).from(s.evidence).where(where).for("update");
    if (!old) return false;
    const payload = withPlaces(input, placesOn(input.files, (old.payload as UpdateInput).places, input.places));
    const [r] = await tx.update(s.evidence).set({ payload, completedAt: new Date(`${input.date}T12:00:00Z`), updatedAt: new Date() }).where(where).returning({ id: s.evidence.id });
    if (r) await logAudit(tx, project.id, { entity: "update", entityId: r.id, action: "update_edited", by, detail: { activity: input.activity, date: input.date } });
    return !!r;
  });
}

/** Removes an update that was never sent. */
export async function removeUpdate(code: string, id: string, by: string) {
  const project = await projectByCode(code);
  const where = and(eq(s.evidence.id, id), eq(s.evidence.projectId, project.id), eq(s.evidence.form, "update"));
  return db.transaction(async (tx) => {
    const [r] = await tx.delete(s.evidence).where(where).returning({ id: s.evidence.id, payload: s.evidence.payload });
    if (r) await logAudit(tx, project.id, { entity: "update", entityId: r.id, action: "update_removed", by, detail: { activity: (r.payload as UpdateInput).activity, date: (r.payload as UpdateInput).date } });
    return !!r;
  });
}

export async function addUpdate(code: string, input: UpdateInput, by: string) {
  const project = await projectByCode(code);
  await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(s.evidence)
      .values({
        organizationId: project.organizationId,
        projectId: project.id,
        source: "manual",
        form: "update",
        // Updates change no figure, so there is nothing for MEL to accept.
        reviewStatus: "accepted",
        completedBy: by,
        completedAt: new Date(`${input.date}T12:00:00Z`),
        payload: withPlaces(input, placesOn(input.files, input.places)),
      })
      .returning({ id: s.evidence.id });
    await logAudit(tx, project.id, { entity: "update", entityId: r.id, action: "update_added", by, detail: { activity: input.activity, date: input.date } });
  });
}
