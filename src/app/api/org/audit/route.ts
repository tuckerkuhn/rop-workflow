import { and, desc, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { HR_ACCESS_ROLES } from "@/lib/hr";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadHr } from "@/server/hr-store";

/**
 * The Organization audit log: every recorded change to people, pay, suppliers and the
 * organization's rules, newest first. HR ledger entries show their kind and who they concern,
 * never their contents (pay, notes), which stay in the HR record behind its own access.
 */

const ENTITIES = ["staff", "supplier", "org_settings", "payroll_settings"] as const;
const AREA: Record<string, string> = { staff: "Access", supplier: "Suppliers", org_settings: "Rules", payroll_settings: "Payroll" };

export type OrgAuditRow = { at: string; area: string; action: string; by: string | null; about: string | null; note: string | null; ref: string };

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const hr = await loadHr();
    const holders = hr.state.rules?.holders ?? {};
    const allowed = !!v.user.admin || HR_ACCESS_ROLES.some((r) => (holders as Record<string, string[]>)[r]?.includes(v.user.id));
    if (!allowed) return NextResponse.json({ error: "Only administrators and HR role holders see the organization audit log." }, { status: 403 });

    const logged = await db
      .select()
      .from(s.auditLog)
      .where(and(isNull(s.auditLog.projectId), inArray(s.auditLog.entity, [...ENTITIES])))
      .orderBy(desc(s.auditLog.at))
      .limit(500);
    const rows: OrgAuditRow[] = logged.map((r) => {
      const d = (r.detail as Record<string, unknown> | null) ?? {};
      const changes = Array.isArray(d.changes) ? (d.changes as string[]).join("; ") : null;
      return {
        at: r.at.toISOString(),
        area: AREA[r.entity] ?? r.entity,
        action: r.action.replace(/_/g, " "),
        by: typeof d.by === "string" ? d.by : null,
        about: typeof d.person === "string" ? d.person : typeof d.name === "string" ? d.name : typeof d.supplier === "string" ? d.supplier : null,
        note: changes ?? (typeof d.reason === "string" ? d.reason : null),
        ref: `log-${r.sequence ?? r.at.getTime()}`,
      };
    });
    for (const e of hr.entries.slice(-500))
      rows.push({ at: e.at, area: "HR record", action: e.kind.replace(/-/g, " "), by: e.actor, about: e.subject, note: null, ref: `hr-${e.n}` });
    rows.sort((a, b) => b.at.localeCompare(a.at));
    return NextResponse.json({ rows: rows.slice(0, 800), intact: hr.integrity.ok });
  });
}
