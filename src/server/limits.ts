import { randomUUID } from "node:crypto";
import { and, gte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";

/**
 * Limits and error records for running the app day to day.
 * - AI runs: every run is already in the audit trail, so the limit counts those rows: per
 *   person per hour, and for the whole organization per day (a cost ceiling).
 * - Server errors: written to the audit trail (entity "system") for administrators to see.
 */

/** The audit row written as each AI run starts; the limits count these. */
export const AI_STARTED = "ai_run_started";
export const AI_ACTIONS = ["assistant_asked", "opportunity_briefed", "qpr_ai_drafted", "review_ai_drafted", "ai_drafted", "ai_checked", "lens_review_run"];
export const AI_PER_PERSON_HOUR = Number(process.env.AI_PER_PERSON_HOUR || 20);
export const AI_PER_DAY = Number(process.env.AI_PER_DAY || 300);

/**
 * Null when the person may run AI now (and the run is counted from this moment); otherwise the
 * response to send. Runs are counted when they start, not when they succeed, so requests sent
 * together cannot all slip under the limit, and failed runs count too.
 */
export async function aiAllowed(personId: string): Promise<NextResponse | null> {
  const hour = new Date(Date.now() - 3600_000);
  const day = new Date(Date.now() - 86400_000);
  const started = and(sql`${s.auditLog.action} = ${AI_STARTED}`, gte(s.auditLog.at, hour), sql`${s.auditLog.detail}->>'by' = ${personId}`);
  const [mine] = await db.select({ n: sql<number>`count(*)::int` }).from(s.auditLog).where(started);
  if ((mine?.n ?? 0) >= AI_PER_PERSON_HOUR) return NextResponse.json({ error: `You have run AI ${mine.n} times in the last hour, the limit. Try again later.` }, { status: 429 });
  const [all] = await db.select({ n: sql<number>`count(*)::int` }).from(s.auditLog).where(and(sql`${s.auditLog.action} = ${AI_STARTED}`, gte(s.auditLog.at, day)));
  if ((all?.n ?? 0) >= AI_PER_DAY) return NextResponse.json({ error: `The organization has used its ${AI_PER_DAY} AI runs for the last 24 hours. An administrator can raise the limit.` }, { status: 429 });
  await db.insert(s.auditLog).values({ projectId: null, entity: "system", entityId: randomUUID(), action: AI_STARTED, detail: { by: personId } });
  return null;
}

/** Records a server error; never throws (the database may be the thing that failed). */
export async function recordError(where: string, e: unknown) {
  try {
    const msg = e instanceof Error ? e.message : String(e);
    await db.insert(s.auditLog).values({ projectId: null, entity: "system", entityId: randomUUID(), action: "server_error", detail: { where, message: msg.slice(0, 500), stack: e instanceof Error ? (e.stack ?? "").split("\n").slice(0, 4).join(" | ").slice(0, 600) : null } });
  } catch {
    // Nothing more to do: the console log stays in the host's logs.
  }
}

/** Recent server errors and AI use, for the administrators' health page. */
export async function health() {
  const day = new Date(Date.now() - 86400_000);
  const week = new Date(Date.now() - 7 * 86400_000);
  const errors = await db
    .select({ at: s.auditLog.at, detail: s.auditLog.detail })
    .from(s.auditLog)
    .where(and(sql`${s.auditLog.action} = 'server_error'`, gte(s.auditLog.at, week)))
    .orderBy(sql`${s.auditLog.at} desc`)
    .limit(50);
  const [ai] = await db.select({ n: sql<number>`count(*)::int` }).from(s.auditLog).where(and(sql`${s.auditLog.action} = ${AI_STARTED}`, gte(s.auditLog.at, day)));
  return {
    errors: errors.map((r) => ({ at: r.at.toISOString(), ...(r.detail as { where: string; message: string; stack: string | null }) })),
    errorsToday: (await db.select({ n: sql<number>`count(*)::int` }).from(s.auditLog).where(and(sql`${s.auditLog.action} = 'server_error'`, gte(s.auditLog.at, day))))[0]?.n ?? 0,
    ai: { lastDay: ai?.n ?? 0, perDay: AI_PER_DAY, perPersonHour: AI_PER_PERSON_HOUR },
    email: { configured: !!process.env.RESEND_API_KEY && !!process.env.CRON_SECRET },
    monitoring: { sentry: false },
    storage: await storage(),
  };
}

/**
 * Database size against the plan's limit (DB_LIMIT_MB, default 500 MB for Supabase's free plan).
 * Proof files live in the database, where it guarantees they are never altered; when the database
 * nears its limit, a warning shows here well before uploads would fail.
 */
async function storage() {
  const [r] = (await db.execute(sql`select pg_database_size(current_database())::bigint as db, coalesce((select sum(size) from hr_files), 0)::bigint as files, (select count(*) from hr_files)::int as n`)) as unknown as { db: string | number; files: string | number; n: number }[];
  const mb = (v: string | number) => Math.round((Number(v) / 1_048_576) * 10) / 10;
  const limit = Number(process.env.DB_LIMIT_MB) || 500;
  const used = mb(r?.db ?? 0);
  return { usedMb: used, filesMb: mb(r?.files ?? 0), files: r?.n ?? 0, limitMb: limit, level: used > limit * 0.85 ? "critical" : used > limit * 0.6 ? "warning" : "good" };
}
