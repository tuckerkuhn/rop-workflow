import { NextResponse } from "next/server";
import { describeAudit } from "@/lib/audit";
import { userById } from "@/lib/demo";
import { auditTrail, mayViewAudit } from "@/server/audit";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";

type Ctx = { params: Promise<{ code: string }> };

/**
 * The project's audit trail for a period (?from=2026-07-01&to=2026-09-30, default the last 90
 * days), as JSON for the screen or ?format=csv for the export. For the people who sign things
 * off or review them: plan approvers, report release, monthly review, MEL and admins.
 */

const day = /^\d{4}-\d{2}-\d{2}$/;
const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: mayViewAudit, why: "The audit trail is for plan approvers, MEL and admins." });
    if (v instanceof NextResponse) return v;
    const q = new URL(req.url).searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const to = day.test(q.get("to") ?? "") ? q.get("to")! : today;
    const from = day.test(q.get("from") ?? "") ? q.get("from")! : new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    if (from > to) return NextResponse.json({ error: "The start date is after the end date." }, { status: 400 });
    const rows = (await auditTrail(code, from, to)).map((r) => ({ ...r, who: r.by ? (userById(r.by)?.name ?? r.by) : "System", what: describeAudit(r.entity, r.action, r.detail) }));
    if (q.get("format") !== "csv") return NextResponse.json({ code, from, to, rows });
    const lines = [
      ["When (UTC)", "Who", "What", "Action", "Record", "Record ID", "Details"],
      ...rows.map((r) => [r.at.replace("T", " ").slice(0, 19), r.who, r.what, r.action, r.entity, r.entityId, JSON.stringify(r.detail)]),
    ];
    const body = lines.map((l) => l.map(csvCell).join(",")).join("\r\n");
    return new NextResponse(`﻿${body}\r\n`, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-${code}-${from}-to-${to}.csv"` },
    });
  });
}
