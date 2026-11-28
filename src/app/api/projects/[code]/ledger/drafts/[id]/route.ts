import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { draftActionSchema } from "@/lib/ledger/screens";
import { guard, handle, HttpError, readBody } from "@/server/guard";
import { deleteDraft } from "@/server/ledger";
import { postExpenditureDraft } from "@/server/expenditure-store";
import { asHttp, ledgerMay, ledgerProject } from "@/server/ledger-view";

type Ctx = { params: Promise<{ code: string; id: string }> };

/**
 * A draft waiting for a second person. { action: "post" }: Finance posts it (never the person who
 * recorded it when it is over the limit; server/ledger refuses that). { action: "delete" }: Finance
 * or the person who recorded it removes it. A posted entry is never deleted: it is reversed.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { code, id } = await params;
  return handle(async () => {
    const v = await guard(req, { write: true, allow: (u) => u.kind === "employee" });
    const { action } = await readBody(req, draftActionSchema);
    const project = await ledgerProject(code);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "That draft was not found.");
    const [e] = await db.select().from(s.journalEntries).where(eq(s.journalEntries.id, id)).limit(1);
    if (!e || e.projectId !== project.id) throw new HttpError(404, "That draft was not found on this project.");
    const may = await ledgerMay(v.user);
    try {
      if (action === "post") {
        if (!may.post) throw new HttpError(403, "Finance posts drafts to the books.");
        // A payment kept as a draft is waiting for a second person, whatever the reason it was held
        // (over the limit, the payee supplies an open purchase, the day's total; code review of R2-06/R2-17).
        if (e.sourceType === "payment" && e.recordedBy === v.user.id) throw new HttpError(403, "You recorded this payment, so someone else in Finance posts it.");
        // A reversal of a bill's or a purchase's entry also takes the amount off the old spent column.
        const r = await postExpenditureDraft(id, v.user.id);
        return NextResponse.json({ outcome: "posted", entryId: r.entry.id });
      }
      if (!may.post && e.recordedBy !== v.user.id) throw new HttpError(403, "Only Finance or the person who recorded it can delete a draft.");
      await deleteDraft(id, v.user.id);
      return NextResponse.json({ outcome: "deleted", entryId: id });
    } catch (err) {
      throw asHttp(err);
    }
  }, "ledger");
}
