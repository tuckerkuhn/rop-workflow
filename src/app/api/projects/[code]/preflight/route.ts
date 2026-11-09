import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { blockers, parseReport, periodOf } from "@/lib/preflight";
import { logAudit } from "@/server/audit";
import { requireViewer } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { handle } from "@/server/guard";
import { preflight } from "@/server/preflight";

/** Pre-flight for a report: ?report=qpr|annual|face&period=2026-Q4|2026|2026-11. Staff only. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: "Reports in preparation are for project staff." });
    if (v instanceof NextResponse) return v;
    const q = new URL(req.url).searchParams;
    const r = parseReport(q.get("report"), q.get("period"));
    if (!r) return NextResponse.json({ error: "Choose ?report=qpr&period=2026-Q4, annual&period=2026 or face&period=2026-11." }, { status: 400 });
    return NextResponse.json(await preflight(code, r));
  });
}

const body = z.object({ action: z.literal("exported"), report: z.string(), period: z.string() });

/** A report downloaded while something still blocks it: on the record, with what blocked it. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (x) => x.kind === "employee", why: "Reports in preparation are for project staff." });
    if (v instanceof NextResponse) return v;
    const a = body.safeParse(await req.json().catch(() => null));
    const r = a.success ? parseReport(a.data.report, a.data.period) : null;
    if (!r) return NextResponse.json({ error: "Unknown report." }, { status: 400 });
    const p = await preflight(code, r);
    const n = blockers(p);
    if (n) {
      const project = await projectByCode(code);
      await logAudit(db, project.id, { entity: "report", entityId: project.id, action: "report_exported_unchecked", by: v.actor.id, detail: { report: r.kind, period: periodOf(r), blockers: p.items.filter((i) => i.group === "blocks").map((i) => i.text) } });
    }
    return NextResponse.json({ blockers: n });
  });
}
