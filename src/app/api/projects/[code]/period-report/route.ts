import { NextResponse } from "next/server";
import { db } from "@/db";
import type { AppUser } from "@/lib/demo";
import { periodKey, periodLabel, type Period } from "@/lib/period-report";
import { requireViewer } from "@/server/auth";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { handle } from "@/server/guard";
import { periodCopy, periodReport, releasePeriod } from "@/server/period-report-store";
import { preflight } from "@/server/preflight";

type Ctx = { params: Promise<{ code: string }> };

/**
 * The annual report (?kind=annual&year=2026) or the final report (?kind=final). Staff only. The
 * person who releases reports releases it to the donor, as a quarterly report is released
 * (api/projects/[code]/qpr): from then on the page shows the frozen copy the donor received.
 */

/** The same rule as the quarterly report's. */
const mayRelease = (u: AppUser) => u.kind === "employee" && u.project.includes("report-release");

function periodOf(req: Request): Period | null {
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind");
  const year = Number(q.get("year"));
  if (kind === "final") return { kind: "final" };
  if (kind === "annual" && Number.isInteger(year) && year >= 2000 && year <= 2100) return { kind: "annual", year };
  return null;
}
const NO_PERIOD = () => NextResponse.json({ error: "Choose ?kind=annual&year=2026 or ?kind=final." }, { status: 400 });

/** Once released, the frozen copy and who released it; before that, the report as it stands. */
async function view(code: string, p: Period, u: AppUser) {
  const copy = await periodCopy(code, p);
  const base = copy ? copy.data : await periodReport(code, p);
  return { ...base, released: copy ? { by: copy.by, at: copy.at } : null, mayRelease: mayRelease(u) && !copy };
}
export type PeriodView = Awaited<ReturnType<typeof view>>;

export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: "Reports in preparation are for project staff." });
    if (v instanceof NextResponse) return v;
    const p = periodOf(req);
    if (!p) return NO_PERIOD();
    return NextResponse.json(await view(code, p, v.user));
  });
}

/** { action: "release" }: marks the report final and releases it to the donor. There is no undoing it. */
export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const p = periodOf(req);
    if (!p) return NO_PERIOD();
    const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
    if (body?.action !== "release") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    const u = v.user;
    if (!mayRelease(u)) return NextResponse.json({ error: "Only the person who releases reports can mark it final." }, { status: 403 });
    if (await periodCopy(code, p)) return NextResponse.json({ error: "This report has been released and can no longer be changed." }, { status: 409 });
    // The annual report has a report check (server/preflight), as the quarterly one does; the final report has none.
    if (p.kind === "annual") {
      const blocks = (await preflight(code, { kind: "annual", year: p.year })).items.filter((i) => i.group === "blocks");
      if (blocks.length) return NextResponse.json({ error: `The report check lists what blocks the report; fix these first: ${blocks.map((c) => c.text).join("; ")}.` }, { status: 409 });
    }
    const copy = await releasePeriod(code, p, u.id, new Date().toISOString());
    if (!copy) return NextResponse.json({ error: "This report has been released and can no longer be changed." }, { status: 409 });
    const project = await projectByCode(code);
    await logAudit(db, project.id, { entity: "period", entityId: project.id, action: "period_released", by: u.id, detail: { report: periodLabel(p), key: periodKey(p) } });
    return NextResponse.json(await view(code, p, u));
  });
}
