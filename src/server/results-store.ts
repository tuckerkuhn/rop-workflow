import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { quarterOf, type ResultInput, type ResultRecord } from "@/lib/results";
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
  const [row] = await db
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
  return toRecord(row);
}

export async function reviewResult(code: string, id: string, status: "accepted" | "queried", by: string, note: string | null) {
  const project = await projectByCode(code);
  const [row] = await db
    .update(s.evidence)
    .set({ reviewStatus: status, reviewedBy: by, reviewedAt: new Date(), queryNote: note, updatedAt: new Date() })
    .where(and(eq(s.evidence.id, id), eq(s.evidence.projectId, project.id), eq(s.evidence.form, "result")))
    .returning();
  return row ? toRecord(row) : null;
}
