/**
 * Receives KoboToolbox REST Service submissions (Project > Settings > REST Services).
 * Configure the service with Basic auth using KOBO_WEBHOOK_USER / KOBO_WEBHOOK_PASSWORD.
 *
 * Uses the same intake as the manual sync: the submission is stored once (keyed on Kobo's
 * _uuid) against the project named in its hidden project_code, and waits in the review queue.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/server/guard";
import { ingest } from "@/server/kobo";

const submissionSchema = z
  .object({
    _uuid: z.string().min(1),
    _xform_id_string: z.string().optional(),
    _submitted_by: z.string().nullable().optional(),
    _submission_time: z.string().optional(),
    project_code: z.string().min(1), // hidden field in every ROP form
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
  return handle(async () => NextResponse.json({ ok: true, result: await ingest(parsed.data) }));
}
