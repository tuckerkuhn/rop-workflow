import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { seesAll } from "@/lib/hr";
import { foldExpenses, nextFor } from "@/lib/expense";
import { foldOnboarding } from "@/lib/onboarding";
import { foldLeave } from "@/lib/leave";
import { onProject, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadFile } from "@/server/hr-files";
import { loadHr } from "@/server/hr-store";
import type { Story } from "@/lib/stories";
import { mayApproveStory } from "@/server/stories-store";

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
            (r.report.lines.some((l) => l.receipts.some((x) => x.hash === hash)) || r.report.paperClaim?.hash === hash) &&
            (r.person === me || hr.people[r.person]?.current.supervisor === me || r.signatures.some((s) => s.by === me) || !!nextFor(r, hr)?.people.includes(me)),
        );
        // A bill paid directly: programme management, finance and the executive head, who approve and pay it.
        if (!ok && (["management", "finance", "ceo", "cfo"] as const).some((t) => hr.rules?.holders[t]?.includes(me))) {
          const [row] = await db
            .select({ key: s.projectState.key })
            .from(s.projectState)
            .where(and(eq(s.projectState.key, "bills"), sql`${s.projectState.data}::text like ${`%${hash}%`}`))
            .limit(1);
          ok = !!row;
        }
        // Proof of a project result (attendance sheet, photos, verification report): staff who see field records.
        if (!ok && v.user.fieldAccess !== "none") {
          // Only on a project this person works on.
          const rows = await db
            .select({ code: s.projects.code })
            .from(s.evidence)
            .innerJoin(s.projects, eq(s.projects.id, s.evidence.projectId))
            .where(and(inArray(s.evidence.form, ["result", "update"]), sql`${s.evidence.payload}::text like ${`%${hash}%`}`))
            .limit(5);
          ok = rows.some((r) => !!r.code && onProject(v.user, r.code));
        }
        // A success story's photo: staff on that project. Its signed consent form (a name and a
        // signature): only the story's author, MEL and programme leads.
        if (!ok) {
          const found = await db
            .select({ code: s.projects.code, data: s.projectState.data })
            .from(s.projectState)
            .innerJoin(s.projects, eq(s.projects.id, s.projectState.projectId))
            .where(and(eq(s.projectState.key, "stories"), sql`${s.projectState.data}::text like ${`%${hash}%`}`))
            .limit(5);
          for (const row of found) {
            if (!row.code || !onProject(v.user, row.code)) continue;
            const stories = ((row.data as { stories?: Story[] }).stories ?? []);
            const asForm = stories.find((st) => st.consent?.form === hash);
            if (asForm) ok ||= asForm.by === me || mayApproveStory(v.user);
            else ok ||= stories.some((st) => st.photos.some((ph) => ph.hash === hash));
          }
        }
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
