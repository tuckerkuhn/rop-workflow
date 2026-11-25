import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { paymentBooksProblem, paymentEntry, postFields, purchaseLine } from "@/lib/books-posting";
import type { AppUser } from "@/lib/demo";
import { paidSoFar } from "@/lib/payments";
import type { Procurement } from "@/lib/procurement";
import { logAudit } from "@/server/audit";
import { people } from "@/server/auth";
import { booksView, keepPurchasePosting, loadPurchaseBooks, mayPostToBooks, paymentKey, payingAccounts, postingStates, postToBooks, PURCHASE_SOURCE } from "@/server/books-posting";
import { projectByCode } from "@/server/field-store";
import { guard, handle, HttpError, readBody } from "@/server/guard";
import { loadBudget } from "@/server/plan-store";
import { loadProcurements } from "@/server/procurement-store";

type Ctx = { params: Promise<{ code: string }> };

/**
 * A paid purchase and the books (decision AI, 25 Nov 2026). GET: for each paid instalment of the
 * project's purchases, the entry filled in from it and whether it is in the books. POST: Finance
 * posts one. A purchase counts as spent when it is recorded as paid, so only a payment record
 * (date and bank reference) can be posted. Nothing posts by itself.
 */

const PAID = "Paid; invoice marked paid";

/** Who recorded payment `n` as paid: the person on that line of the purchase's history, when it names one. */
function recorderOf(p: Procurement, n: number, all: AppUser[]): string | null {
  const done = p.timeline.filter((t) => t.what.startsWith(PAID));
  const by = done[n - 1]?.by;
  return by ? (all.find((x) => x.id === by || x.name === by)?.id ?? null) : null;
}

async function view(code: string, u: AppUser, only?: string) {
  const [items, book, post, budget, all] = await Promise.all([loadProcurements(code), loadPurchaseBooks(code), mayPostToBooks(u), loadBudget(code).catch(() => null), people()]);
  const lines = (budget?.lines ?? []).map((l) => ({ code: l.code, description: l.description }));
  const payments = [];
  for (const p of items) {
    if (only && p.id !== only) continue;
    for (const r of paidSoFar(p)) {
      const key = paymentKey(p.id, r.n);
      const line = purchaseLine(p);
      const known = lines.some((l) => l.code === line);
      const problem = paymentBooksProblem(p, r) ?? (lines.length && !known ? `Line ${line} is not in this project's budget, so there is nothing to charge it to.` : null);
      payments.push({ purchase: p.id, title: p.title, n: r.n, key, ...(await booksView({ code, entry: paymentEntry(p, r, code, lines.find((l) => l.code === line)?.description ?? ""), postings: book.postings[key], problem, recordedBy: recorderOf(p, r.n, all), me: u.id, post })) });
    }
  }
  return { me: u.id, post, lines, accounts: payments.length ? await payingAccounts(code).catch(() => []) : [], payments };
}
export type PurchaseBooksView = Awaited<ReturnType<typeof view>>;

export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await guard(req, { allow: (u) => u.kind === "employee" && u.procurementAccess !== "none" });
    return NextResponse.json(await view(code, v.user, new URL(req.url).searchParams.get("purchase") ?? undefined));
  });
}

const postSchema = z.object({ purchase: z.string().regex(/^[A-Z0-9-]{3,40}$/), n: z.number().int().min(1).max(60), ...postFields });

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await guard(req, { write: true, allow: (u) => u.kind === "employee" });
    const u = v.user;
    if (!(await mayPostToBooks(u))) throw new HttpError(403, "Finance posts a paid purchase to the books.");
    const a = await readBody(req, postSchema, "Give the day it was paid and the account it was paid from.");
    const p = (await loadProcurements(code)).find((x) => x.id === a.purchase);
    const r = p ? paidSoFar(p).find((x) => x.n === a.n) : undefined;
    if (!p || !r) throw new HttpError(404, "That payment is not recorded as paid on this project.");
    const problem = paymentBooksProblem(p, r);
    if (problem) throw new HttpError(409, problem);
    const key = paymentKey(p.id, r.n);
    const earlier = await postingStates((await loadPurchaseBooks(code)).postings[key]);
    const e = paymentEntry(p, r, code, "");
    // Another budget line only for a corrected entry, after the first was reversed.
    const line = a.budgetLine && earlier.some((x) => x.reversal?.posted) ? a.budgetLine : e.budgetLine;
    const project = await projectByCode(code);
    const { posting, replayed } = await postToBooks({
      project: code,
      budgetLine: line,
      payee: e.payee,
      what: e.what,
      amount: e.amount,
      currency: e.currency,
      usd: e.usd,
      date: a.date,
      paidFrom: a.paidFrom,
      recordedBy: recorderOf(p, r.n, await people()) ?? `purchase:${p.id}`,
      postedBy: u,
      source: { type: PURCHASE_SOURCE, id: `${code}:${key}`, key: `purchase:${project.id}:${key}` },
      earlier,
    });
    const kept = await keepPurchasePosting(code, key, posting);
    if (kept && !replayed) await logAudit(db, project.id, { entity: "procurement", entityId: project.id, action: "purchase_posted_to_books", by: u.id, detail: { purchase: p.id, payment: r.n, entry: posting.entryId, budgetLine: posting.budgetLine, amount: Number(posting.amount), currency: posting.currency, date: posting.date, paidFrom: posting.paidFrom, posting: posting.n } });
    return NextResponse.json(await view(code, u, p.id));
  });
}
