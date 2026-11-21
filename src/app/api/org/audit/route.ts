import { and, desc, gte, inArray, isNull, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { isDay } from "@/lib/clock";
import { userById } from "@/lib/demo";
import { HR_ACCESS_ROLES } from "@/lib/hr";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadHr } from "@/server/hr-store";

/**
 * The Organization audit log: every recorded change to people, pay, suppliers, the
 * organization's rules, opportunities, proposals and each use of "View as", newest first. HR ledger entries show their kind and who they concern,
 * never their contents (pay, notes), which stay in the HR record behind its own access.
 *
 * Without dates it answers with the newest 800 entries. With ?from=2026-07-01&to=2026-09-30
 * (either or both, by calendar day in UTC) it answers with every entry in that period, up to
 * 5,000, so an auditor can take a whole quarter or year.
 */

const ENTITIES = ["staff", "supplier", "org_settings", "payroll_settings", "opportunity", "proposal", "session"] as const;
const AREA: Record<string, string> = { staff: "Access", supplier: "Suppliers", org_settings: "Rules", payroll_settings: "Payroll", opportunity: "Opportunities", proposal: "Proposals", session: "View as" };

/** A person's name where the id is one of ours; an outside contributor's id or a name stays as written. */
const nameOf = (id: string) => userById(id)?.name ?? id;

export type OrgAuditRow = { at: string; area: string; action: string; by: string | null; about: string | null; note: string | null; ref: string };

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const hr = await loadHr();
    const holders = hr.state.rules?.holders ?? {};
    const allowed = !!v.user.admin || HR_ACCESS_ROLES.some((r) => (holders as Record<string, string[]>)[r]?.includes(v.user.id));
    if (!allowed) return NextResponse.json({ error: "Only administrators and HR role holders see the organization audit log." }, { status: 403 });

    const q = new URL(req.url).searchParams;
    for (const k of ["from", "to"]) if (q.get(k) && !isDay(q.get(k))) return NextResponse.json({ error: `${q.get(k)} is not a date: write it as 2026-07-01.` }, { status: 400 });
    const from = q.get("from") || null;
    const to = q.get("to") || null;
    if (from && to && from > to) return NextResponse.json({ error: "The start date is after the end date." }, { status: 400 });
    const period = !!(from || to);
    const logged = await db
      .select()
      .from(s.auditLog)
      .where(and(isNull(s.auditLog.projectId), inArray(s.auditLog.entity, [...ENTITIES]), from ? gte(s.auditLog.at, new Date(`${from}T00:00:00Z`)) : undefined, to ? lte(s.auditLog.at, new Date(`${to}T23:59:59.999Z`)) : undefined))
      .orderBy(desc(s.auditLog.at))
      .limit((period ? 5000 : 500) + 1);
    // One more than asked for says whether the log had older entries left out.
    const cutLog = logged.length > (period ? 5000 : 500);
    if (cutLog) logged.pop();
    const rows: OrgAuditRow[] = logged.map((r) => {
      const d = (r.detail as Record<string, unknown> | null) ?? {};
      const changes = Array.isArray(d.changes) ? (d.changes as string[]).join("; ") : null;
      return {
        at: r.at.toISOString(),
        area: AREA[r.entity] ?? r.entity,
        action: r.action.replace(/_/g, " "),
        by: typeof d.by === "string" ? nameOf(d.by) : null,
        about: typeof d.person === "string" ? nameOf(d.person) : typeof d.name === "string" ? d.name : typeof d.supplier === "string" ? d.supplier : typeof d.proposal === "string" ? d.proposal : typeof d.opportunity === "string" ? d.opportunity : typeof d.as === "string" ? nameOf(d.as) : null,
        note: changes ?? (typeof d.reason === "string" ? d.reason : null),
        ref: `log-${r.sequence ?? r.at.getTime()}`,
      };
    });
    const inPeriod = (at: string) => (!from || at.slice(0, 10) >= from) && (!to || at.slice(0, 10) <= to);
    for (const e of period ? hr.entries.filter((x) => inPeriod(x.at)) : hr.entries.slice(-500))
      rows.push({ at: e.at, area: "HR record", action: e.kind.replace(/-/g, " "), by: e.actor, about: e.subject, note: null, ref: `hr-${e.n}` });
    rows.sort((a, b) => b.at.localeCompare(a.at));
    const cap = period ? 5000 : 800;
    const cutHr = !period && hr.entries.length > 500;
    return NextResponse.json({ rows: rows.slice(0, cap), more: rows.length > cap || cutLog || cutHr, from, to, intact: hr.integrity.ok });
  });
}
