import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { BILL_CATEGORIES, billActionSchema, billFlags, type Bill } from "@/lib/bills";
import { AFN_PER_USD } from "@/lib/demo";
import { isSharePointUrl } from "@/lib/procurement";
import { NON_CONTRACT } from "@/lib/timesheet";
import type { AppUser } from "@/lib/demo";
import { requireViewer } from "@/server/auth";
import { loadBills, saveBills } from "@/server/bills-store";
import { handle } from "@/server/guard";
import { hrBook, loadHr } from "@/server/hr-store";
import { loadPolicy } from "@/server/policy-store";
import { donorById } from "@/lib/donors";
import { ROP, effective } from "@/lib/policy";

type Ctx = { params: Promise<{ code: string }> };

/**
 * Bills paid directly, outside procurement. Anyone on staff records a bill with its document;
 * programme management approves it (not the person who recorded it); Finance prepares the
 * voucher. Who holds which role comes from the authority table.
 */

async function rolesOf(u: AppUser) {
  const holders = (await loadHr()).state.rules?.holders;
  const has = (t: "management" | "ceo" | "finance" | "bills") => !!holders?.[t]?.includes(u.id);
  return {
    // Recording bills is given, not assumed: Finance, and the people named for bill entry.
    record: has("finance") || has("bills") || u.procurement.includes("finance"),
    approve: has("management") || has("ceo") || u.procurement.includes("approver"),
    voucher: has("finance") || u.procurement.includes("finance"),
  };
}

const today = () => new Date().toISOString().slice(0, 10);

async function view(code: string, u: AppUser) {
  const book = await loadBills(code);
  const roles = await rolesOf(u);
  const setting = await loadPolicy(code).catch(() => null);
  const rules = effective(ROP, setting?.donor ? donorById(setting.donor) : null, setting?.decisions ?? {}).values;
  const micro = typeof rules.microMaxUsd === "number" ? rules.microMaxUsd : 500;
  const projects = await db.select({ code: s.projects.code, name: s.projects.name }).from(s.projects);
  return {
    me: u.id,
    ...roles,
    sources: [{ id: NON_CONTRACT, label: "General and admin (non-contract)" }, ...projects.filter((p) => p.code).map((p) => ({ id: p.code!, label: p.name }))],
    items: [...book.items].reverse().map((b) => ({ ...b, flags: billFlags(b, book.items, micro), canApprove: roles.approve && b.status === "waiting" && b.raised.by !== u.id, canVoucher: roles.voucher && b.status === "approved" })),
  };
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
      const id = `BL-${String(book.next).padStart(3, "0")}`;
      const usd = Math.round((a.currency === "AFN" ? a.amount / AFN_PER_USD : a.amount) * 100) / 100;
      const bill: Bill = {
        id,
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
        raised: sign,
        status: "waiting",
        timeline: [{ date: sign.at, who: u.name, what: `Recorded (${BILL_CATEGORIES[a.category].label}, GL ${BILL_CATEGORIES[a.category].gl})` }],
      };
      await saveBills(code, { items: [...book.items, bill], next: book.next + 1 });
      return NextResponse.json(await view(code, u));
    }
    const b = book.items.find((x) => x.id === a.id);
    if (!b) return fail("No such bill.", 404);
    const roles = await rolesOf(u);
    if (a.action === "approve" || a.action === "return") {
      if (!roles.approve) return fail("Programme management approves bills.");
      if (b.raised.by === u.id) return fail("You recorded this bill, so someone else approves it.");
      if (b.status !== "waiting") return fail("This bill is not waiting for approval.", 409);
      if (a.action === "approve") Object.assign(b, { status: "approved", approval: sign, timeline: [...b.timeline, { date: sign.at, who: u.name, what: "Approved for payment" }] });
      else Object.assign(b, { status: "returned", returned: { ...sign, note: a.note }, timeline: [...b.timeline, { date: sign.at, who: u.name, what: `Sent back: ${a.note}` }] });
    } else {
      if (!roles.voucher) return fail("Finance prepares the voucher.");
      if (b.status !== "approved") return fail("The bill must be approved before the voucher.", 409);
      if (a.sharepointUrl && !isSharePointUrl(a.sharepointUrl)) return fail("That is not a SharePoint link.", 400);
      const complete = !!a.number && !!a.month && isSharePointUrl(a.sharepointUrl) && !!a.netsuiteRef.trim();
      Object.assign(b, {
        voucher: { number: a.number, month: a.month, sharepointUrl: a.sharepointUrl, netsuiteRef: a.netsuiteRef, ...sign },
        status: complete ? "filed" : "approved",
        timeline: [...b.timeline, { date: sign.at, who: u.name, what: complete ? `Voucher ${a.number} filed in SharePoint and posted in NetSuite (${a.netsuiteRef})` : `Voucher ${a.number} started` }],
      });
    }
    await saveBills(code, book);
    return NextResponse.json(await view(code, u));
  });
}
