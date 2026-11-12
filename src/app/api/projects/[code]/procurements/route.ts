import { NextResponse } from "next/server";
import { z } from "zod";
import type { Procurement } from "@/lib/procurement";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadProcurements, saveProcurements } from "@/server/procurement-store";
import { db } from "@/db";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { DEMO_PROJECT, applyProcurementContext, describeProcurementSave, loadProcurementContext, validateProcurementSave } from "@/server/procurement-guard";
import { loadPlan } from "@/server/procurement-plan-store";
import { loadGrantBook } from "@/server/grants-store";
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
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "That procurement could not be saved: the record is incomplete." }, { status: 400 });
    const items = parsed.data.items as unknown as Procurement[];
    // The server decides what is allowed (the same rules as the screen), then records each save.
    // Everything is loaded first; the checks then run with no await in between, so another
    // request cannot swap in its own project's rules while these run.
    const storedList = await loadProcurements(code);
    const stored = new Map(storedList.map((p) => [p.id, p]));
    const merged = [...storedList.filter((p) => !items.some((x) => x.id === p.id)), ...items];
    const [ctx, calendar] = await Promise.all([
      loadProcurementContext(code, await orgIdForPerson(v.user.id), merged),
      // A real project's requests must charge its procurement calendar; the demo keeps its sample lines.
      code === DEMO_PROJECT ? Promise.resolve(undefined) : loadPlan(code),
    ]);
    // Someone else saved since this copy was loaded: refuse, and the screen reloads the latest.
    const stale = items.find((x) => stored.has(x.id) && (stored.get(x.id)!.rev ?? 0) !== (x.rev ?? 0));
    if (stale) return NextResponse.json({ error: `${stale.id} was changed by someone else just now. The latest copy is loaded; make your change again.`, stale: true }, { status: 409 });
    applyProcurementContext(ctx);
    for (const next of items) {
      const why = validateProcurementSave(stored.get(next.id), next, v.user, calendar, ctx.register, merged);
      if (why) return NextResponse.json({ error: `${next.id}: ${why}` }, { status: 409 });
    }
    // A request made for an in-kind grant keeps that grant; the grant must be this project's, open and in kind.
    const withGrant = items.filter((x) => (x.grant ?? null) !== (stored.get(x.id)?.grant ?? null));
    if (withGrant.length) {
      const grants = (await loadGrantBook(code)).items;
      for (const x of withGrant) {
        if (stored.has(x.id)) return NextResponse.json({ error: `${x.id}: the grant a request is for is fixed when the request is made.` }, { status: 409 });
        const g = grants.find((y) => y.id === x.grant);
        if (!g || g.type !== "inKind" || g.status !== "open") return NextResponse.json({ error: `${x.id}: ${x.grant} is not an open in-kind grant on this project.` }, { status: 409 });
      }
    }
    const saved = items.map((x) => ({ ...x, rev: (stored.get(x.id)?.rev ?? 0) + 1 }));
    await saveProcurements(code, saved);
    const project = await projectByCode(code);
    for (const next of items) await logAudit(db, project.id, { entity: "procurement", entityId: project.id, action: "procurement_saved", by: v.user.id, detail: describeProcurementSave(stored.get(next.id), next) });
    return NextResponse.json({ ok: true, revs: Object.fromEntries(saved.map((x) => [x.id, x.rev])) });
  });
}
