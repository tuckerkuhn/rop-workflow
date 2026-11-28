import { and, eq, inArray, like, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { paymentSchema, type SaveOutcome } from "@/lib/ledger/screens";
import { guard, handle, HttpError, readBody } from "@/server/guard";
import { hrBook } from "@/server/hr-store";
import { expenseAccountFor, LedgerError, ledgerSettings, postPayment } from "@/server/ledger";
import { moneyAccounts } from "@/server/ledger-setup";
import { asHttp, ledgerMay, ledgerProject, openPurchases, paymentsView, whoCanPost } from "@/server/ledger-view";
import { mentionsVia, openOnLine, payeeSupplies, paymentGuard } from "@/lib/ledger/payment-guard";
import { realToday } from "@/lib/clock";
import { logAudit } from "@/server/audit";
import { loadProcurements, procurementIdsOfOrg } from "@/server/procurement-store";
import { accountFlags } from "@/lib/payment-accounts";
import { loadAccounts } from "@/server/payment-accounts-store";

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
    const may = await ledgerMay(u);
    if (!may.record) throw new HttpError(403, "Payments are recorded by Finance and by the people named for bill entry. Give the receipt to Finance.");
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
    if (f.thirdParty && f.thirdParty.authorization.hash === f.receipt.hash) throw new HttpError(400, "The payee's written authorization is a document of its own, not the receipt. Attach it separately.");
    if (f.thirdParty) {
      const [auth] = await db.select({ hash: s.hrFiles.hash }).from(s.hrFiles).where(and(eq(s.hrFiles.book, hrBook()), eq(s.hrFiles.hash, f.thirdParty.authorization.hash))).limit(1);
      if (!auth) throw new HttpError(400, "The written authorization did not finish uploading. Attach it again.");
    }
    const expense = await expenseAccountFor(org, line.kind);
    if (!expense) throw new HttpError(409, "The organization's chart of accounts has no account for this kind of spending yet.");

    const who = { organizationId: org, recordedBy: u.id, idempotencyKey: `payment:${u.id}:${f.idempotencyKey}`, sourceType: "payment", sourceId: f.receipt.hash };
    // R2-17: one receipt is paid once. An earlier payment on the same receipt that was not reversed refuses this one.
    const onReceipt = await db.select({ id: s.journalEntries.id, key: s.journalEntries.idempotencyKey, date: s.journalEntries.entryDate }).from(s.journalEntries).where(and(eq(s.journalEntries.organizationId, org), eq(s.journalEntries.sourceType, "payment"), eq(s.journalEntries.sourceId, f.receipt.hash)));
    const earlier = onReceipt.filter((x) => x.key !== who.idempotencyKey);
    if (earlier.length) {
      const reversed = new Set((await db.select({ of: s.journalEntries.reversesId }).from(s.journalEntries).where(inArray(s.journalEntries.reversesId, earlier.map((x) => x.id)))).map((x) => x.of));
      const live = earlier.find((x) => !reversed.has(x.id));
      if (live) throw new HttpError(409, `This receipt is already on a payment of ${live.date}. One receipt is paid once: reverse that payment first if it was wrong.`);
    }
    // Who else must look first, whatever the amount (R2-06, R2-08, R2-17).
    const secondWhy: string[] = [];
    if (!may.post) secondWhy.push("you record payments and Finance posts them");
    const supplies = payeeSupplies(f.payee, openOnLine(line.code, open));
    if (mentionsVia(`${f.payee} ${f.what}`) && !f.thirdParty) secondWhy.push("it says the money went via someone or something: check who received it");
    if (supplies.length) secondWhy.push(`${f.payee} is the supplier of ${supplies.map((p) => p.id).join(", ")}, still open on this line`);
    const payeeMemo = `${f.payee.replace(/[\\%_]/g, "\\$&")}:%`;
    // Payments to one payee on one day are added up against the limit for posting one's own, so it is not split around (R2-17).
    const [day] = await db
      .select({ total: sql<string>`coalesce(sum(${s.journalLines.functionalDebit}), 0)` })
      .from(s.journalLines)
      .innerJoin(s.journalEntries, eq(s.journalLines.entryId, s.journalEntries.id))
      .where(and(eq(s.journalEntries.organizationId, org), eq(s.journalEntries.sourceType, "payment"), eq(s.journalEntries.recordedBy, u.id), eq(s.journalEntries.entryDate, f.date), like(s.journalEntries.memo, payeeMemo), ne(s.journalEntries.idempotencyKey, who.idempotencyKey)));
    const earlierToday = Number(day?.total ?? 0);
    const limit = Number((await ledgerSettings(org)).selfPostLimit);
    if (earlierToday > 0 && earlierToday + Number(f.amount) * Number(f.fxRate || 1) > limit) secondWhy.push(`with the ${earlierToday.toFixed(2)} you already paid ${f.payee} on ${f.date}, it passes the limit for posting your own payments`);
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
        r = await postPayment(secondWhy.length ? { ...who, asDraft: true } : who, input);
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
      // MF-06: paid in cash, or from an account not in the payment accounts register, is flagged.
      const from = (await moneyAccounts(org)).find((m) => m.ledgerAccountId === f.paidFrom);
      const warnings = [...(from ? accountFlags((await loadAccounts(org)).accounts[from.bankAccountId]) : []), ...(secondWhy.length ? [`Kept for a second person to post: ${secondWhy.join("; ")}.`] : [])];
      const out: SaveOutcome = { outcome: draft ? "draft" : "posted", entryId: r.entry.id, replayed: r.replayed, whoCanPost: draft ? await whoCanPost(code, u.id) : [], ...(warnings.length ? { warnings } : {}) };
      return NextResponse.json(out);
    } catch (e) {
      throw asHttp(e);
    }
  }, "ledger");
}
