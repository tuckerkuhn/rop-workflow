import { NextResponse } from "next/server";
import { db } from "@/db";
import type { AppUser } from "@/lib/demo";
import { facePatchSchema } from "@/lib/face";
import { logAudit } from "@/server/audit";
import { requireViewer } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { handle } from "@/server/guard";
import { blockers } from "@/lib/preflight";
import { preflight } from "@/server/preflight";
import { holdsRole } from "@/server/hr-store";
import { faceView, faceWorkbook, loadFace, saveFace } from "@/server/face-store";

/** UNDP's FACE form for a month (?month=2026-08; &download=1 for Excel). Finance, the CFO, programme leads and administrators. */

async function mayFace(u: AppUser) {
  if (u.kind !== "employee") return false;
  if (u.admin || u.project.some((r) => ["finance-import", "report-release", "plan-approver"].includes(r))) return true;
  return (await holdsRole(u.id, "finance")) || (await holdsRole(u.id, "cfo"));
}

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    if (!(await mayFace(v.user))) return NextResponse.json({ error: "The FACE form is for Finance, the CFO and programme leads." }, { status: 403 });
    const q = new URL(req.url).searchParams;
    const month = q.get("month") ?? "";
    if (!/^\d{4}-\d{2}$/.test(month)) {
      const latest = (await faceView(code, new Date().toISOString().slice(0, 7))).months[0];
      if (!latest) return NextResponse.json({ error: "Import Finance's budget against actual workbook first (Quarterly report, Project information)." }, { status: 400 });
      return NextResponse.json(await faceView(code, latest));
    }
    const view = await faceView(code, month);
    if (q.get("download") === "1") {
      // Marked as a draft while pre-flight still lists blockers (the page asks first and records it).
      const draft = blockers(await preflight(code, { kind: "face", month }));
      const buf = await faceWorkbook(view, draft);
      return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="FACE ${view.project.name.replace(/[^\w ()-]/g, "")} ${month}${draft ? " DRAFT not checked" : ""}.xlsx"` } });
    }
    return NextResponse.json(view);
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    if (!(await mayFace(v.user))) return NextResponse.json({ error: "The FACE form is for Finance, the CFO and programme leads." }, { status: 403 });
    const parsed = facePatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
    const a = parsed.data;
    const st = await loadFace(code);
    if (a.action === "header") st.header = a.header;
    else st.months[a.month] = { authorised: a.authorised, request: a.request, requestPeriod: a.requestPeriod, authorisedPeriod: a.authorisedPeriod, savedBy: v.user.id, savedAt: new Date().toISOString() };
    await saveFace(code, st);
    const project = await projectByCode(code);
    await logAudit(db, project.id, { entity: "face", entityId: project.id, action: a.action === "header" ? "face_header_saved" : "face_month_saved", by: v.user.id, detail: a.action === "month" ? { month: a.month } : {} });
    return NextResponse.json(await faceView(code, a.action === "month" ? a.month : (await faceView(code, new Date().toISOString().slice(0, 7))).months[0] ?? new Date().toISOString().slice(0, 7)));
  });
}
