/**
 * Receives KoboToolbox REST Service submissions (Project > Settings > REST Services).
 * Configure the service with Basic auth using KOBO_WEBHOOK_USER / KOBO_WEBHOOK_PASSWORD.
 *
 * Phase 1 behaviour: authenticate, validate the envelope, and store the raw
 * submission as an evidence record (idempotent on Kobo's _uuid). Mapping each
 * form to domain tables (readiness checks, distributions, ...) comes in Phase 2.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";

const submissionSchema = z
  .object({
    _uuid: z.string().min(1),
    _xform_id_string: z.string().optional(),
    _submitted_by: z.string().nullable().optional(),
    _submission_time: z.string().optional(),
    project_code: z.string().optional(), // hidden field in every ROP form
  })
  .passthrough();

function authorized(req: Request): boolean {
  const user = process.env.KOBO_WEBHOOK_USER;
  const pass = process.env.KOBO_WEBHOOK_PASSWORD;
  if (!user || !pass) return false;
  const expected = Buffer.from(`Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`);
  const actual = Buffer.from(req.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = submissionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid submission", issues: parsed.error.issues }, { status: 400 });
  }
  const sub = parsed.data;

  const projectId = process.env.DEFAULT_PROJECT_ID;
  if (!projectId) {
    return NextResponse.json({ error: "DEFAULT_PROJECT_ID not configured" }, { status: 500 });
  }

  await db
    .insert(schema.evidence)
    .values({
      projectId,
      source: "kobo",
      koboAssetUid: sub._xform_id_string,
      koboSubmissionUuid: sub._uuid,
      completedBy: sub._submitted_by ?? null,
      completedAt: sub._submission_time ? new Date(sub._submission_time) : null,
      payload: sub,
    })
    .onConflictDoNothing({ target: schema.evidence.koboSubmissionUuid });

  return NextResponse.json({ ok: true });
}
