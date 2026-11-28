import { acct, storeNames } from "@/lib/file-store";
import { loadBudget } from "@/server/plan-store";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { billBooksProblem, billEntry, billLineProblem, BILL_CATEGORIES, billActionSchema, billFlags, redoneAs, type Bill } from "@/lib/bills";
import { BILL_SOURCE, GENERAL_ADMIN_NAME, booksView, mayPostToBooks, payingAccounts, postingStates, postToBooks } from "@/server/books-posting";
import { AFN_PER_USD } from "@/lib/demo";
import { isSharePointUrl } from "@/lib/procurement";
import { NON_CONTRACT } from "@/lib/timesheet";
import type { AppUser } from "@/lib/demo";
import { requireViewer } from "@/server/auth";
import { billRoles, changeBills, loadBills } from "@/server/bills-store";
import { handle } from "@/server/guard";
import { hrBook } from "@/server/hr-store";
import { projectRules } from "@/server/policy-store";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { selfApproval, soloFor, type SoloState } from "@/server/solo";
import { perUsd } from "@/lib/fx";

type Ctx = { params: Promise<{ code: string }> };

/**
 * Bills paid directly, outside procurement. Anyone on staff records a bill with its document;
 * programme management approves it (not the person who recorded it); Finance prepares the
 * voucher. Who holds which role comes from the authority table.
 */

const rolesOf = billRoles;

const today = () => new Date().toISOString().slice(0, 10);

/** Solo mode never covers a large bill: above the large threshold a second person approves. */
const largeAbove = (rules: Record<string, unknown>) => (typeof rules.largeAboveUsd === "number" ? rules.largeAboveUsd : 25000);
const mayApproveOwn = (solo: SoloState, b: Bill, rules: Record<string, unknown>) => solo.on && !solo.blocked && b.usd <= largeAbove(rules);

/** Budget lines by project code, for the projects that have a budget loaded. */
async function linesBySource(codes: string[]) {
  const out: Record<string, { code: string; description: string }[]> = {};
  for (const c of codes) {
    const b = await loadBudget(c).catch(() => null);
    if (b?.lines.length) out[c] = b.lines.map((l) => ({ code: l.code, description: l.description }));
  }
  return out;
}

async function view(code: string, u: AppUser) {
  const book = await loadBills(code);
  const roles = await rolesOf(u);
  const rules = await projectRules(code)
    .then((r) => r.values)
    .catch(() => ({}) as Record<string, unknown>);
  const micro = typeof rules.microMaxUsd === "number" ? rules.microMaxUsd : 500;
  const solo = await soloFor(code).catch((): SoloState => ({ on: false, blocked: null }));
  const projects = await db.select({ code: s.projects.code, name: s.projects.name }).from(s.projects);
  const lines = await linesBySource(projects.map((p) => p.code).filter((c): c is string => !!c));
  // The books: Finance posts a filed bill with one press. What each bill's entry would say, the
  // entry that stands and any that were reversed. Read only for bills that can go to the books.
  const post = await mayPostToBooks(u);
  const books: Record<string, Awaited<ReturnType<typeof booksOf>>> = {};
  const accounts: Record<string, Awaited<ReturnType<typeof payingAccounts>>> = {};
  for (const b of book.items) {
    if (b.status !== "filed" && !b.postings?.length) continue;
    // A general and admin bill is paid from the accounts of the organization this page's project belongs to.
    if (!billBooksProblem(b, NON_CONTRACT)) accounts[b.source] ??= await payingAccounts(b.source === NON_CONTRACT ? code : b.source).catch(() => []);
    books[b.id] = await booksOf(code, b, lines, post, u.id);
  }
  return {
    me: u.id,
    // Each project's budget lines, so a bill is charged to a line chosen from the list.
    lines,
    ...roles,
    post,
    /** The bank and cash accounts each project's organization pays from, for the posting. */
    accounts,
    sources: [{ id: NON_CONTRACT, label: "General and admin (non-contract)" }, ...projects.filter((p) => p.code).map((p) => ({ id: p.code!, label: p.name }))],
    // A bill sent back: who may correct it and record it again, and the bill that replaced it once they have.
    items: [...book.items].reverse().map((b) => ({ ...b, flags: billFlags(b, book.items, micro), redoneAs: redoneAs(b, book.items), canRedo: roles.record && b.status === "returned" && !redoneAs(b, book.items), canApprove: roles.approve && b.status === "waiting" && b.raised.by !== u.id, canSelfApprove: roles.approve && b.status === "waiting" && b.raised.by === u.id && mayApproveOwn(solo, b, rules), canVoucher: roles.voucher && b.status === "approved", books: books[b.id] ?? null })),
  };
}

/** A bill and the books: the entry filled in from it, the entry that stands and those reversed. */
function booksOf(code: string, b: Bill, lines: Record<string, { code: string; description: string }[]>, post: boolean, me: string) {
  const general = b.source === NON_CONTRACT ? { project: code, name: GENERAL_ADMIN_NAME } : undefined;
  return booksView({ code, entry: billEntry(b, lines[b.source]?.find((l) => l.code === b.budgetLine)?.description ?? "", general), postings: b.postings, problem: billBooksProblem(b, NON_CONTRACT), recordedBy: b.raised.by, me, post });
}
export type BillsView = Awaited<ReturnType<typeof view>>;

export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await view(code, v.user));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const parsed = billActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That bill is not complete." }, { status: 400 });
    const a = parsed.data;
    const u = v.user;
    const sign = { by: u.id, name: u.name, at: today() };
    const book = await loadBills(code);
    const fail = (error: string, status = 403) => NextResponse.json({ error }, { status });
    if (a.action === "raise") {
      if (!(await rolesOf(u)).record) return fail("Only Finance, and people named for bill entry in the authority table, record bills.");
      const [f] = await db.select({ hash: s.hrFiles.hash }).from(s.hrFiles).where(and(eq(s.hrFiles.book, hrBook()), eq(s.hrFiles.hash, a.file.hash))).limit(1);
      if (!f) return fail("The bill did not finish uploading. Attach it again.", 400);
      const lineWhy = billLineProblem(a.source, a.budgetLine || null, await linesBySource(a.source === NON_CONTRACT ? [] : [a.source]), NON_CONTRACT);
      if (lineWhy) return fail(lineWhy, 400);
      if (a.replaces) {
        const old = book.items.find((x) => x.id === a.replaces);
        if (!old || old.status !== "returned") return fail("Only a bill that was sent back is recorded again in its place.", 400);
        if (redoneAs(old, book.items)) return fail(`${old.id} was already recorded again.`, 400);
      }

      // At the month's rate (lib/fx, MF-11).
      const usd = Math.round((a.currency === "USD" ? a.amount : a.amount / (perUsd(a.currency, a.invoiceDate) ?? AFN_PER_USD)) * 100) / 100;
      const bill: Bill = {
        id: "",
        payee: a.payee,
        invoiceNumber: a.invoiceNumber,
        invoiceDate: a.invoiceDate,
        description: a.description,
        category: a.category,
        amount: a.amount,
        currency: a.currency,
        usd,
        source: a.source,
        budgetLine: a.budgetLine || null,
        contractRef: a.contractRef || null,
        file: a.file,
        ...(a.replaces ? { replaces: a.replaces } : {}),
        raised: sign,
        status: "waiting",
        timeline: [{ date: sign.at, who: u.name, what: `Recorded (${BILL_CATEGORIES[a.category].label}, GL ${BILL_CATEGORIES[a.category].gl})` }],
      };
      // The number and the "recorded again" check are taken with the book locked: two bills recorded
      // at once get two numbers, and a sent-back bill is recorded again once.
      const refused = await changeBills(code, (cur) => {
        if (a.replaces && redoneAs(cur.items.find((x) => x.id === a.replaces)!, cur.items)) return `${a.replaces} was already recorded again.`;

        bill.id = `BL-${String(cur.next).padStart(3, "0")}`;
        cur.items.push(bill);
        cur.next += 1;
        return null;
      });
      if (refused) return fail(refused, 409);
      await logAudit(db, (await projectByCode(code)).id, { entity: "bill", entityId: bill.id, action: "bill_recorded", by: u.id, detail: { bill: bill.id, usd: bill.usd, amount: bill.amount, currency: bill.currency, category: bill.category, budgetLine: bill.budgetLine, file: bill.file.hash } });
      return NextResponse.json(await view(code, u));
    }
    const b = book.items.find((x) => x.id === a.id);
    if (!b) return fail("No such bill.", 404);
    if (a.action === "post") {
      // Finance posts the filed bill to the books. Every part of the entry comes from the bill;
      // Finance gives the day it was paid and the account it was paid from.
      if (!(await mayPostToBooks(u))) return fail("Finance posts a bill to the books.");
      const problem = billBooksProblem(b, NON_CONTRACT);
      if (problem) return fail(problem, 409);
      const earlier = await postingStates(b.postings);
      // Another budget line only for a corrected entry, after the first was reversed.
      const general = b.source === NON_CONTRACT;
      const line = general ? "" : a.budgetLine && earlier.some((p) => p.reversal?.posted) ? a.budgetLine : b.budgetLine!;
      const e = billEntry(b, "");
      const { posting, replayed } = await postToBooks({
        project: general ? code : b.source,
        general,
        budgetLine: line,
        payee: e.payee,
        what: e.what,
        amount: b.amount,
        currency: b.currency,
        usd: b.usd,
        date: a.date,
        paidFrom: a.paidFrom,
        recordedBy: b.raised.by,
        postedBy: u,
        source: { type: BILL_SOURCE, id: `${code}:${b.id}`, key: `bill:${(await projectByCode(code)).id}:${b.id}` },
        earlier,
      });
      // Read again before saving: the bill may have changed while the entry was written.
      let added = false;
      await changeBills(code, (fresh) => {
        const mine = fresh.items.find((x) => x.id === b.id);
        if (!mine || (mine.postings ?? []).some((p) => p.entryId === posting.entryId)) return "already kept";
        mine.postings = [...(mine.postings ?? []), posting];
        mine.timeline = [...mine.timeline, { date: sign.at, who: u.name, what: `${posting.n > 1 ? "Corrected entry posted" : "Posted"} to the books (${posting.budgetLine ? `line ${posting.budgetLine}` : "general and admin"}, ${posting.date})` }];
        added = true;
        return null;
      });
      if (added) {
        if (!replayed) await logAudit(db, (await projectByCode(code)).id, { entity: "bill", entityId: b.id, action: "bill_posted_to_books", by: u.id, detail: { bill: b.id, entry: posting.entryId, budgetLine: posting.budgetLine, amount: Number(posting.amount), currency: posting.currency, date: posting.date, paidFrom: posting.paidFrom, recordedBy: b.raised.by, posting: posting.n } });
      }
      return NextResponse.json(await view(code, u));
    }
    const roles = await rolesOf(u);
    // The status the checks below were made on: the save refuses if it changed meanwhile.
    const before = b.status;
    let voucherFiled: boolean | null = null;
    if (a.action === "approve" || a.action === "return") {
      if (!roles.approve) return fail("Programme management approves bills.");
      // Solo mode (server/solo.ts): a small team's approver may approve a bill they recorded, confirming it, up to the large threshold.
      let self: { selfApproved: true; soloNote?: string } | null = null;
      if (b.raised.by === u.id) {
        const refusal = "You recorded this bill, so someone else approves it.";
        if (a.action !== "approve") return fail(refusal);
        const rules = (await projectRules(code)).values;
        if (b.usd > largeAbove(rules)) return fail(`${refusal} Above $${largeAbove(rules).toLocaleString("en-US")}, a second person always approves.`);
        const ok = selfApproval(await soloFor(code), a.self, refusal);
        if (!ok.ok) return fail(ok.why);
        self = ok.detail;
      }
      if (b.status !== "waiting") return fail("This bill is not waiting for approval.", 409);
      if (a.action === "approve") Object.assign(b, { status: "approved", approval: { ...sign, ...(self ?? {}) }, timeline: [...b.timeline, { date: sign.at, who: u.name, what: self ? "Approved for payment by the person who recorded it (solo mode)" : "Approved for payment" }] });
      else Object.assign(b, { status: "returned", returned: { ...sign, note: a.note }, timeline: [...b.timeline, { date: sign.at, who: u.name, what: `Sent back: ${a.note}` }] });
    } else {
      if (!roles.voucher) return fail("Finance prepares the voucher.");
      if (b.status !== "approved") return fail("The bill must be approved before the voucher.", 409);
      if (a.sharepointUrl && !isSharePointUrl(a.sharepointUrl)) return fail(`That is not a link to ${storeNames()}.`, 400);
      const complete = !!a.number && !!a.month && isSharePointUrl(a.sharepointUrl) && !!a.netsuiteRef.trim();
      voucherFiled = complete;
      Object.assign(b, {
        voucher: { number: a.number, month: a.month, sharepointUrl: a.sharepointUrl, netsuiteRef: a.netsuiteRef, ...sign },
        status: complete ? "filed" : "approved",
        timeline: [...b.timeline, { date: sign.at, who: u.name, what: complete ? `Voucher ${a.number} filed in ${storeNames()} and posted in ${acct()} (${a.netsuiteRef})` : `Voucher ${a.number} started` }],
      });
    }
    // Saved with the book locked, on the bill as it is now: a change made meanwhile by someone else stays.
    const raced = await changeBills(code, (cur) => {
      const now = cur.items.find((x) => x.id === b.id);
      if (!now || now.status !== before) return "This bill was changed by someone else meanwhile. Reload and look again.";
      Object.assign(now, b);
      return null;
    });
    if (raced) return fail(raced, 409);
    if (a.action === "approve" || a.action === "return") {
      const project = await projectByCode(code);
      await logAudit(db, project.id, { entity: "bill", entityId: b.id, action: a.action === "approve" ? "bill_approved" : "bill_returned", by: u.id, detail: { bill: b.id, usd: b.usd, recordedBy: b.raised.by, ...(a.action === "approve" && b.approval?.selfApproved ? { selfApproved: true, ...(b.approval.soloNote ? { soloNote: b.approval.soloNote } : {}) } : {}) } });
    }
    if (a.action === "voucher") await logAudit(db, (await projectByCode(code)).id, { entity: "bill", entityId: b.id, action: voucherFiled ? "bill_voucher_filed" : "bill_voucher_started", by: u.id, detail: { bill: b.id, usd: b.usd, voucher: a.number, month: a.month, netsuiteRef: a.netsuiteRef } });
    return NextResponse.json(await view(code, u));
  });
}
