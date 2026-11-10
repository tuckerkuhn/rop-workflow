import { NextResponse } from "next/server";
import type { z } from "zod";
import type { AppUser } from "@/lib/demo";
import type { AuditEvent } from "@/server/audit";
import type { Viewer } from "@/server/auth";

/**
 * The one guard for API routes. A route does four things, in this order, and each has one helper
 * here so none is written twice:
 *
 *   handle(...)      wraps the route: every failure becomes a plain message, never a stack trace.
 *   guard(req, ...)  who is asking, that they belong to the project's organization and work on
 *                    the project, and that their role allows it (server/auth requireViewer).
 *   readBody(...)    the input, checked against a Zod schema before anything reads it.
 *   audit(...)       one audit_log row for the change, naming who made it.
 *
 * Older routes call `requireViewer` and `logAudit` directly; they do the same checks. New routes
 * use the helpers here.
 */

/** A refusal with its HTTP status and a message a person can act on. Thrown anywhere under `handle`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** What a person sees when something failed that they could not have caused. */
export const UNEXPECTED = "Something went wrong on our side, and it has been recorded. Nothing you entered on this screen is lost: try again in a minute. If it keeps happening, tell an administrator (Settings, Health shows the details).";

/** True for messages written for people (thrown on purpose by the app), false for a driver's or the runtime's. */
function written(e: unknown): e is Error {
  if (!(e instanceof Error) || e.constructor !== Error) return false;
  return !/^Failed query|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo|password authentication|relation .* does not exist|Unexpected token|is not a function|Cannot read prop|undefined/i.test(e.message);
}

/** Turns failures into a readable JSON error. Refusals keep their status; anything unexpected is recorded for Settings → Health. */
export async function handle(fn: () => Promise<Response>, where = "api"): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : String(e);
    const setup = msg.startsWith("DATABASE_URL") || /ENOTFOUND|ECONNREFUSED|password authentication|getaddrinfo|relation .* does not exist/i.test(msg);
    console.error(e);
    // Kept for the administrators' health page (Settings → Health).
    await (await import("@/server/limits")).recordError(where, e);
    // A setup fault names its cause for whoever is installing; otherwise the app's own message, or a plain one.
    const error = setup ? (msg.startsWith("DATABASE_URL") ? msg : "The app cannot reach its database. Check DATABASE_URL in .env.local and that the migration has run.") : written(e) ? msg : UNEXPECTED;
    return NextResponse.json({ error }, { status: 500 });
  }
}

/**
 * Who is asking, their organization, their project and their role, or a refusal. Use inside
 * `handle`: `const v = await guard(req, { write: true, allow: isMelOwner })`.
 */
export async function guard(req: Request, opts: { write?: boolean; allow?: (u: AppUser) => boolean; why?: string } = {}): Promise<Viewer> {
  const v = await (await import("@/server/auth")).requireViewer(req, opts);
  if (v instanceof NextResponse) {
    const body = (await v.json().catch(() => null)) as { error?: string } | null;
    throw new HttpError(v.status, body?.error ?? "You cannot do this.");
  }
  return v;
}

/**
 * The request's JSON body, checked. Anything that does not fit is refused with status 400 and
 * `message` (or the schema's own message when none is given), so a route never reads unchecked input.
 */
export async function readBody<T extends z.ZodType>(req: Request, schema: T, message?: string): Promise<z.output<T>> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, message ?? parsed.error.issues[0]?.message ?? "That is not complete. Check what you entered and try again.");
  return parsed.data;
}

/** One audit_log row for a change on a project, by its code. `e.by` is the person who made it. */
export async function audit(code: string, e: AuditEvent) {
  const [{ db }, { projectByCode }, { logAudit }] = await Promise.all([import("@/db"), import("@/server/field-store"), import("@/server/audit")]);
  await logAudit(db, (await projectByCode(code)).id, e);
}
