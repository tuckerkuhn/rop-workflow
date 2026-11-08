import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { proofCount, quarterOf, type Correction, type ResultInput, type ResultRecord, type UpdateInput, type UpdateRecord } from "@/lib/results";
import type { z } from "zod";
import type { correctionSchema } from "@/lib/results";
import { logAudit } from "@/server/audit";

type CorrectionInput = z.infer<typeof correctionSchema>;
import { projectByCode } from "@/server/field-store";

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
  const project = await projectByCode(code);
  const rows = await db
    .select()
    .from(s.evidence)
    .where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.source, "manual"), eq(s.evidence.form, "result")));
  return rows.map(toRecord).sort((a, b) => b.date.localeCompare(a.date));
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

export async function reviewResult(code: string, id: string, status: "accepted" | "queried", by: string, note: string | null) {
  const project = await projectByCode(code);
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(s.evidence)
      .set({ reviewStatus: status, reviewedBy: by, reviewedAt: new Date(), queryNote: note, updatedAt: new Date() })
      .where(and(eq(s.evidence.id, id), eq(s.evidence.projectId, project.id), eq(s.evidence.form, "result")))
      .returning();
    if (r) {
      const p = r.payload as ResultInput;
      await logAudit(tx, project.id, { entity: "result", entityId: r.id, action: status === "accepted" ? "result_accepted" : "result_queried", by, detail: { indicator: p.indicator, value: p.value, date: p.date, note } });
    }
    return r;
  });
  return row ? toRecord(row) : null;
}

/**
 * Adds proof to a recorded result. Files and links are appended (the same file or link once);
 * the figure, date and review status stay as they are.
 */
export async function addProof(code: string, id: string, add: { files: ResultInput["files"]; links: NonNullable<ResultInput["links"]>; captions?: ResultInput["captions"]; by: string }) {
  const project = await projectByCode(code);
  const where = and(eq(s.evidence.id, id), eq(s.evidence.projectId, project.id), eq(s.evidence.form, "result"));
  const [row] = await db.select().from(s.evidence).where(where);
  if (!row) return null;
  const p = row.payload as ResultInput;
  const files = [...p.files, ...add.files.filter((f) => !p.files.some((x) => x.hash === f.hash))].slice(0, 20);
  const links = [...(p.links ?? []), ...add.links.filter((l) => !(p.links ?? []).some((x) => x.url === l.url))].slice(0, 20);
  const captions = { ...(p.captions ?? {}), ...(add.captions ?? {}) };
  const payload: ResultInput = { ...p, files, links, ...(Object.keys(captions).length ? { captions } : {}) };
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
  const keys = ["date", "value", "female", "male", "womenLed", "menLed", "province", "district", "note"] as const;
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
      const p = r.payload as UpdateInput;
      return { ...p, id: r.id, quarter: quarterOf(p.date), by: r.completedBy ?? "", at: r.createdAt.toISOString() };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
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
        payload: input,
      })
      .returning({ id: s.evidence.id });
    await logAudit(tx, project.id, { entity: "update", entityId: r.id, action: "update_added", by, detail: { activity: input.activity, date: input.date } });
  });
}
