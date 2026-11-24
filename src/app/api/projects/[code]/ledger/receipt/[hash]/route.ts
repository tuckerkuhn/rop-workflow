import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { guard, handle, HttpError } from "@/server/guard";
import { loadFile } from "@/server/hr-files";
import { ledgerMay, ledgerProject } from "@/server/ledger-view";

type Ctx = { params: Promise<{ code: string; hash: string }> };

/**
 * The receipt behind a payment recorded on this project, for staff on the project: the same people
 * who can read the entry. A draft's receipt only for Finance and the person who recorded it.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { code, hash } = await params;
  return handle(async () => {
    const v = await guard(req, { allow: (u) => u.kind === "employee" });
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new HttpError(404, "No such file.");
    const project = await ledgerProject(code);
    const rows = await db
      .select({ status: s.journalEntries.status, recordedBy: s.journalEntries.recordedBy })
      .from(s.journalEntries)
      .where(and(eq(s.journalEntries.projectId, project.id), eq(s.journalEntries.sourceType, "payment"), eq(s.journalEntries.sourceId, hash)));
    const may = await ledgerMay(v.user);
    if (!rows.some((r) => r.status === "posted" || may.post || r.recordedBy === v.user.id)) throw new HttpError(404, "No such file.");
    const f = await loadFile(hash);
    if (!f) throw new HttpError(404, "No such file.");
    return new NextResponse(new Uint8Array(f.data), {
      headers: {
        "Content-Type": f.type,
        "Content-Disposition": `inline; filename="${f.name.replace(/[^\w.\- ]/g, "_")}"`,
        "X-Content-Type-Options": "nosniff",
        ...(f.type.startsWith("image/") ? { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" } : {}),
        "Cache-Control": "private, max-age=3600",
      },
    });
  }, "ledger");
}
