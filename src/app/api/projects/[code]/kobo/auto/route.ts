import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { requireViewer } from "@/server/auth";
import { audit, handle } from "@/server/guard";
import { disableAutoSync, enableAutoSync, readable } from "@/server/kobo-link";

type Ctx = { params: Promise<{ code: string }> };
const WHY = "Only the project manager and plan approvers can change automatic sync.";

/** Turns on automatic sync, or replaces its password. The answer holds the password; it is not shown again. */
export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: WHY });
    if (v instanceof NextResponse) return v;
    return readable(async () => {
      const secret = await enableAutoSync(code);
      // The password itself is never logged.
      await audit(code, { entity: "kobo", entityId: crypto.randomUUID(), action: "kobo_auto_sync_on", by: v.user.id });
      return NextResponse.json(secret, { headers: { "Cache-Control": "no-store" } });
    });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: WHY });
    if (v instanceof NextResponse) return v;
    return readable(async () => {
      await disableAutoSync(code);
      await audit(code, { entity: "kobo", entityId: crypto.randomUUID(), action: "kobo_auto_sync_off", by: v.user.id });
      return NextResponse.json({ ok: true });
    });
  });
}
