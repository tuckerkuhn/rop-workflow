import { NextResponse } from "next/server";
import { z } from "zod";
import { isAppFormKind, type AppFormKind } from "@/lib/app-forms";
import { requireViewer } from "@/server/auth";
import { formFor, saveForm } from "@/server/app-forms";
import { mayOpenForms } from "@/lib/app-forms";
import { HttpError, handle, readBody } from "@/server/guard";

/**
 * The field forms filled in inside the app (server/app-forms).
 * GET ?kind=readiness: the form and the farmer list and package it looks things up in.
 * POST ?kind=readiness: saves one filled-in form. Checked again here, whatever the phone allowed.
 */

const kindOf = (req: Request): AppFormKind => {
  const k = new URL(req.url).searchParams.get("kind") ?? "";
  if (!isAppFormKind(k)) throw new HttpError(400, "There is no form of that kind. Choose distribution, readiness check, training attendance, farm visit or register a farmer.");
  return k;
};

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const v = await requireViewer(req, { allow: mayOpenForms, why: "Only field staff who may change Field activities fill in field forms." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await formFor(code, kindOf(req), v.user), { headers: { "Cache-Control": "private, no-store" } });
  });
}

const body = z.object({
  entryId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  answers: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,40}$/), z.string().max(4000)),
  photos: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,40}$/), z.string().max(2_000_000)).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: mayOpenForms, why: "Only field staff who may change Field activities fill in field forms." });
    if (v instanceof NextResponse) return v;
    const kind = kindOf(req);
    const b = await readBody(req, body, "The form could not be read. Reload it and try again.");
    return NextResponse.json(await saveForm(code, kind, b, v.user));
  });
}
