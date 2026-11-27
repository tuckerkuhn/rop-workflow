import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { paymentSchema, type SaveOutcome } from "@/lib/ledger/screens";
import { guard, handle, HttpError, readBody } from "@/server/guard";
import { hrBook } from "@/server/hr-store";
import { expenseAccountFor, LedgerError, postPayment } from "@/server/ledger";
import { moneyAccounts } from "@/server/ledger-setup";
import { asHttp, ledgerMay, ledgerProject, openPurchases, paymentsView, whoCanPost } from "@/server/ledger-view";
import { openOnLine, paymentGuard } from "@/lib/ledger/payment-guard";
import { realToday } from "@/lib/clock";
import { logAudit } from "@/server/audit";
import { loadProcurements, procurementIdsOfOrg } from "@/server/procurement-store";

type Ctx = { params: Promise<{ code: string }> };

/**
 * Record a payment. GET: the form's choices, drafts waiting for a second person and the latest
 * entries (staff on the project). POST: records one payment, posted to the books, or kept as a
 * draft when it is over the organization's limit for posting one's own payment. A payment for a
 * purchase is refused: it is paid from the purchase's own Pay step, which checks it
 * (lib/ledger/payment-guard).
 */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await guard(req, { allow: (u) => u.kind === "employee" });
    return NextResponse.json(await paymentsView(code, v.user));
  }, "ledger");
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await guard(req, { write: true, allow: (u) => u.kind === "employee" });
    const u = v.user;
    if (!(await ledgerMay(u)).record) throw new HttpError(403, "Payments are recorded by Finance and by the people named for bill entry. Give the receipt to Finance.");
    const f = await readBody(req, paymentSchema, "The payment is not complete. Check each field.");
    const project = await ledgerProject(code);
    const org = project.organizationId;

    const [line] = await db.select().from(s.budgetLines).where(eq(s.budgetLines.id, f.budgetLineId)).limit(1);
    if (!line || line.projectId !== project.id) throw new HttpError(400, "Choose a budget line of this project.");
    if (f.donorId) {
      const [d] = await db.select({ projectId: s.donors.projectId }).from(s.donors).where(eq(s.donors.id, f.donorId)).limit(1);
      if (!d || d.projectId !== project.id) throw new HttpError(400, "Choose a donor of this project.");
    }
    if (!(await moneyAccounts(org)).some((m) => m.ledgerAccountId === f.paidFrom)) throw new HttpError(400, "Choose the bank or cash account the money was paid from.");
    const [file] = await db.select({ hash: s.hrFiles.hash }).from(s.hrFiles).where(and(eq(s.hrFiles.book, hrBook()), eq(s.hrFiles.hash, f.receipt.hash))).limit(1);
    if (!file) throw new HttpError(400, "The receipt did not finish uploading. Attach it again.");
    // Not a way around a purchase's checks: a named purchase, an open one on the same line, a third-party receiver.
    const purchases = await loadProcurements(code);
    const open = openPurchases(purchases);
    // Any purchase of the organization: its numbers are one of a kind across it (code review of ISS-02).
    const everyPurchase = [...purchases, ...(await procurementIdsOfOrg(org)).filter((r) => r.projectId !== project.id)];
    const refusal = paymentGuard({ payee: f.payee, what: f.what, lineCode: line.code, date: f.date, notAPurchase: f.notAPurchase, thirdParty: f.thirdParty }, everyPurchase, open, realToday());
    if (refusal) throw new HttpError(refusal.status, refusal.error);
    if (f.thirdParty) {
      const [auth] = await db.select({ hash: s.hrFiles.hash }).from(s.hrFiles).where(and(eq(s.hrFiles.book, hrBook()), eq(s.hrFiles.hash, f.thirdParty.authorization.hash))).limit(1);
      if (!auth) throw new HttpError(400, "The written authorization did not finish uploading. Attach it again.");
    }
    const expense = await expenseAccountFor(org, line.kind);
    if (!expense) throw new HttpError(409, "The organization's chart of accounts has no account for this kind of spending yet.");

    const who = { organizationId: org, recordedBy: u.id, idempotencyKey: `payment:${u.id}:${f.idempotencyKey}`, sourceType: "payment", sourceId: f.receipt.hash };
    const input = {
      date: f.date,
      memo: `${f.payee}: ${f.what}${f.thirdParty ? ` (handed to ${f.thirdParty.receivedBy}; authorization on file; screened ${f.thirdParty.screenedOn})` : ""}`,
      paidFrom: f.paidFrom,
      currency: f.currency,
      fxRate: f.fxRate,
      projectId: project.id,
      expenses: [{ accountId: expense.id, amount: f.amount, donorId: f.donorId ?? null, projectId: project.id, budgetLineId: line.id, memo: f.what }],
    };
    try {
      let r;
      try {
        r = await postPayment(who, input);
      } catch (e) {
        // Over the limit for posting one's own payment: kept as a draft for someone else to post.
        if (!(e instanceof LedgerError) || e.code !== "needs_second_person") throw e;
        r = await postPayment({ ...who, asDraft: true }, input);
      }
      const draft = r.entry.status === "draft";
      // What the person declared to get past the guard is kept with the entry, for whoever posts or audits it.
      const sameLine = openOnLine(line.code, open).map((p) => p.id);
      // Written once per entry: also on a retry whose first try posted but did not get this far.
      const declared = r.replayed ? (await db.select({ id: s.auditLog.id }).from(s.auditLog).where(and(eq(s.auditLog.entityId, r.entry.id), eq(s.auditLog.action, "payment_declared"))).limit(1)).length > 0 : false;
      if (!declared && (f.thirdParty || sameLine.length))
        await logAudit(db, project.id, {
          entity: "journal_entry",
          entityId: r.entry.id,
          action: "payment_declared",
          by: u.id,
          detail: { notAPurchase: f.notAPurchase ?? null, openPurchasesOnLine: sameLine, thirdParty: f.thirdParty ? { receivedBy: f.thirdParty.receivedBy, authorization: f.thirdParty.authorization.hash, screenedOn: f.thirdParty.screenedOn } : null },
        });
      const out: SaveOutcome = { outcome: draft ? "draft" : "posted", entryId: r.entry.id, replayed: r.replayed, whoCanPost: draft ? await whoCanPost(code, u.id) : [] };
      return NextResponse.json(out);
    } catch (e) {
      throw asHttp(e);
    }
  }, "ledger");
}
