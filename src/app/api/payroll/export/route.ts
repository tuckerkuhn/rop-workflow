import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { seesAll } from "@/lib/hr";
import { bankFile, registerFile, runFile, type Line } from "@/lib/payroll";
import { NON_CONTRACT } from "@/lib/timesheet";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadHr } from "@/server/hr-store";

/** Files from an approved payroll only: nothing goes to ADP or the bank before both signatures. */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const { state } = await loadHr();
    if (!seesAll(v.user.id, state)) return NextResponse.json({ error: "Payroll is open to people holding an HR role." }, { status: 403 });
    const q = new URL(req.url).searchParams;
    const run = state.proposals.find((p) => p.id === Number(q.get("run")) && p.type === "payroll");
    if (!run || run.type !== "payroll") return NextResponse.json({ error: "No such payroll." }, { status: 404 });
    if (run.status !== "approved") return NextResponse.json({ error: "Files are available once the payroll is approved." }, { status: 409 });
    const lines = run.lines as unknown as Line[];
    const file = q.get("file");
    const projects = await db.select({ code: s.projects.code, name: s.projects.name }).from(s.projects);
    const label = (id: string) => (id === NON_CONTRACT ? "Non-contract" : (projects.find((p) => p.code === id)?.name ?? id));
    const tag = `${run.month}-${run.group === "Home Office" ? "HO" : "AF"}${run.supplemental ? "-supplemental" : ""}`;
    const [body, name] =
      file === "run" && run.group === "Home Office"
        ? [runFile(lines), `ADP-RUN-import-${tag}.csv`]
        : file === "bank" && run.group === "Afghanistan"
          ? [bankFile(lines, run.month), `bank-transfers-${tag}.csv`]
          : [registerFile(lines, label), `payroll-register-${tag}.csv`];
    return new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  });
}
