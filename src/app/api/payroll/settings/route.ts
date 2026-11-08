import { NextResponse } from "next/server";
import { z } from "zod";
import { seesAll } from "@/lib/hr";
import { runLayoutSchema } from "@/lib/payroll";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadHr } from "@/server/hr-store";
import { orgIdForPerson } from "@/server/org-settings-store";
import { loadPayrollSettings, saveRunLayout } from "@/server/payroll-settings";

/** The ADP RUN file layout. HR roles read it; payroll or the finance head changes it, with a reason. */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const { state } = await loadHr();
    if (!seesAll(v.user.id, state)) return NextResponse.json({ error: "Payroll settings are open to people holding an HR role." }, { status: 403 });
    const org = await orgIdForPerson(v.user.id);
    if (!org) return NextResponse.json({ error: "No organization." }, { status: 400 });
    const h = state.rules?.holders;
    return NextResponse.json({ ...(await loadPayrollSettings(org)), mayEdit: !!(h?.payroll.includes(v.user.id) || h?.cfo.includes(v.user.id)) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const { state } = await loadHr();
    const h = state.rules?.holders;
    if (!(h?.payroll.includes(v.user.id) || h?.cfo.includes(v.user.id))) return NextResponse.json({ error: "Payroll or the finance head sets the RUN file layout." }, { status: 403 });
    const parsed = z.object({ run: runLayoutSchema, reason: z.string().trim().min(5, "Say why, for example which template it matches.").max(500) }).safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const keys = parsed.data.run.columns.map((c) => c.key);
    if (new Set(keys).size !== keys.length) return NextResponse.json({ error: "A column is listed twice." }, { status: 400 });
    if (!keys.includes("amount") || !keys.includes("earningCode") || !(keys.includes("employeeId") || keys.includes("name"))) return NextResponse.json({ error: "The file needs the amount, the earning code and the employee ID or name." }, { status: 400 });
    const org = await orgIdForPerson(v.user.id);
    if (!org) return NextResponse.json({ error: "No organization." }, { status: 400 });
    await saveRunLayout(org, parsed.data.run, { id: v.user.id, name: v.user.name }, parsed.data.reason);
    return NextResponse.json({ ...(await loadPayrollSettings(org)), mayEdit: true });
  });
}
