import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { reverseSchema, type SaveOutcome } from "@/lib/ledger/screens";
import { guard, handle, HttpError, readBody } from "@/server/guard";
import { LedgerError, reverse } from "@/server/ledger";
import { reverseExpenditure } from "@/server/expenditure-store";
import { asHttp, ledgerMay, ledgerProject, whoCanPost } from "@/server/ledger-view";

type Ctx = { params: Promise<{ code: string; id: string }> };

/**
 * Reverse a posted entry, with the reason: the same lines swapped, dated today, pointing to the
 * original. The people who record payments may reverse; over the limit it waits as a draft for a
 * second person, like a payment.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { code, id } = await params;
  return handle(async () => {
    const v = await guard(req, { write: true, allow: (u) => u.kind === "employee" });
    const u = v.user;
    if (!(await ledgerMay(u)).record) throw new HttpError(403, "Entries are reversed by Finance and by the people who record payments.");
    const f = await readBody(req, reverseSchema);
    const project = await ledgerProject(code);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "That entry was not found.");
    const [e] = await db.select({ projectId: s.journalEntries.projectId }).from(s.journalEntries).where(eq(s.journalEntries.id, id)).limit(1);
    if (!e || e.projectId !== project.id) throw new HttpError(404, "That entry was not found on this project.");
    const who = { organizationId: project.organizationId, recordedBy: u.id, idempotencyKey: `reverse:${u.id}:${f.idempotencyKey}`, entryId: id, date: f.date ?? new Date().toISOString().slice(0, 10), memo: `Reversed: ${f.reason}` };
    // An entry made from an expenditure (a bill or a purchase posted to the books) is reversed with
    // its expenditure, so the old spent column and the expenditures table follow the books.
    const spent = { organizationId: who.organizationId, entryId: id, by: u.id, date: who.date, memo: who.memo };
    try {
      let r;
      try {
        r = (await reverseExpenditure(spent)) ?? (await reverse(who));
      } catch (err) {
        if (!(err instanceof LedgerError) || err.code !== "needs_second_person") throw err;
        r = (await reverseExpenditure({ ...spent, asDraft: true })) ?? (await reverse({ ...who, asDraft: true }));
      }
      const draft = r.entry.status === "draft";
      const out: SaveOutcome = { outcome: draft ? "draft" : "posted", entryId: r.entry.id, replayed: r.replayed, whoCanPost: draft ? await whoCanPost(code, u.id) : [] };
      return NextResponse.json(out);
    } catch (err) {
      throw asHttp(err);
    }
  }, "ledger");
}
