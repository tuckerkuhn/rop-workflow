import { NextResponse } from "next/server";
import { z } from "zod";
import type { Procurement } from "@/lib/procurement";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadProcurements, saveProcurements } from "@/server/procurement-store";
import { db } from "@/db";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { DEMO_PROJECT, describeProcurementSave, prepareProcurementRules, validateProcurementSave } from "@/server/procurement-guard";
import { loadPlan } from "@/server/procurement-plan-store";
import { orgIdForPerson } from "@/server/org-settings-store";

/** The project's procurements. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.procurementAccess !== "none" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json({ items: await loadProcurements(code) });
  });
}

const bodySchema = z.object({
  items: z.array(z.object({ id: z.string().regex(/^[A-Z0-9-]{3,40}$/), step: z.string().min(1), title: z.string() }).passthrough()).max(200),
});

/** Saves the procurements that changed. */
export async function PUT(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.procurementAccess === "edit", why: "You can view Procurement but not change it." });
    if (v instanceof NextResponse) return v;
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "That procurement could not be saved: the record is incomplete." }, { status: 400 });
    const items = parsed.data.items as unknown as Procurement[];
    // The server decides what is allowed (the same rules as the screen), then records each save.
    const stored = new Map((await loadProcurements(code)).map((p) => [p.id, p]));
    const register = await prepareProcurementRules(code, await orgIdForPerson(v.user.id));
    // A real project's requests must charge its procurement calendar; the demo keeps its sample lines.
    const calendar = code === DEMO_PROJECT ? undefined : await loadPlan(code);
    for (const next of items) {
      const why = validateProcurementSave(stored.get(next.id), next, v.user, calendar, register);
      if (why) return NextResponse.json({ error: `${next.id}: ${why}` }, { status: 409 });
    }
    await saveProcurements(code, items);
    const project = await projectByCode(code);
    for (const next of items) await logAudit(db, project.id, { entity: "procurement", entityId: project.id, action: "procurement_saved", by: v.user.id, detail: describeProcurementSave(stored.get(next.id), next) });
    return NextResponse.json({ ok: true });
  });
}
