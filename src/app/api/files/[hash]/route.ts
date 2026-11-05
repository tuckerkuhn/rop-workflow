import { NextResponse } from "next/server";
import { seesAll } from "@/lib/hr";
import { foldExpenses, nextFor } from "@/lib/expense";
import { foldOnboarding } from "@/lib/onboarding";
import { foldLeave } from "@/lib/leave";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadFile } from "@/server/hr-files";
import { loadHr } from "@/server/hr-store";

/**
 * A receipt, for the person who uploaded it, anyone holding an HR role, the person whose report
 * it is on, and whoever signs that report.
 */
export async function GET(req: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    if (!/^[0-9a-f]{64}$/.test(hash)) return NextResponse.json({ error: "No such file." }, { status: 404 });
    const f = await loadFile(hash);
    if (!f) return NextResponse.json({ error: "No such file." }, { status: 404 });
    const me = v.user.id;
    let ok = f.uploadedBy === me;
    if (!ok) {
      const { state: hr, entries } = await loadHr();
      if (seesAll(me, hr)) ok = true;
      else {
        const { reports } = foldExpenses(entries, hr);
        const { onboarding, policies } = foldOnboarding(entries, hr);
        // Policies are for everyone; a contract or ID only for the person (HR already passed above).
        if (policies.some((p) => p.file.hash === hash)) ok = true;
        // A sick-leave certificate: the person and their supervisor.
        const { requests } = foldLeave(entries, hr);
        if (requests.some((r) => r.certificate?.hash === hash && (r.person === me || hr.people[r.person]?.current.supervisor === me))) ok = true;
        const mine = onboarding.find((o) => o.person === me);
        if (mine && (mine.contract.hash === hash || Object.values(mine.done).some((d) => d.value.kind === "upload" && d.value.file.hash === hash))) ok = true;
        ok ||= reports.some(
          (r) =>
            r.report.lines.some((l) => l.receipts.some((x) => x.hash === hash)) &&
            (r.person === me || hr.people[r.person]?.current.supervisor === me || r.signatures.some((s) => s.by === me) || !!nextFor(r, hr)?.people.includes(me)),
        );
      }
    }
    if (!ok) return NextResponse.json({ error: "You cannot open this file." }, { status: 403 });
    return new NextResponse(new Uint8Array(f.data), {
      headers: {
        "Content-Type": f.type,
        "Content-Disposition": `inline; filename="${f.name.replace(/[^\w.\- ]/g, "_")}"`,
        "X-Content-Type-Options": "nosniff",
        // Only images and PDFs are ever stored; images also get a sandbox (it would block the PDF viewer).
        ...(f.type.startsWith("image/") ? { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" } : {}),
        "Cache-Control": "private, max-age=3600",
      },
    });
  });
}
