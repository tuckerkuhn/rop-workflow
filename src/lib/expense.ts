import { z } from "zod";
import { conflictOf, type Entry, type HrState } from "@/lib/hr";

/**
 * Expense reports, as on the ROP expense report form: one report per person per month, a line per
 * expense with its GL account, funding source and receipt. Per diem follows the per diem
 * calculation form: the M&IE rate for the place (State Department rates abroad, GSA in the US),
 * 75% on the days of departure and return, 100% in between. Mileage at the standard rate.
 *
 * The supervisor approves, then Finance (the payroll role) checks receipts and codes. Accepted
 * reports are paid in the next payroll as non-taxable reimbursements, and charged to each line's
 * funding source. Every version is an entry in the HR ledger; receipts are kept by their SHA-256
 * fingerprint, so a swapped receipt shows.
 */

export const CATEGORIES = {
  perDiem: { label: "Per diem (meals and incidentals)", gl: "7050" },
  airfareIntl: { label: "International airfare", gl: "7010" },
  airfareUs: { label: "US airfare", gl: "7000" },
  parking: { label: "Parking and tolls", gl: "7070" },
  taxi: { label: "Taxi and local transport", gl: "7040" },
  mileage: { label: "Mileage (own car)", gl: null },
  lodging: { label: "Lodging", gl: null },
  meals: { label: "Staff meals (internal meetings)", gl: "6320" },
  entertainment: { label: "Business entertainment (third parties, donors)", gl: "6280" },
  supplies: { label: "Supplies", gl: "6180" },
  equipment: { label: "Office equipment", gl: "6080" },
  maintenance: { label: "Facility maintenance", gl: "6070" },
  subscriptions: { label: "Memberships and subscriptions", gl: null },
  other: { label: "Other", gl: null },
} as const;
export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

/** Standard mileage rate in USD per mile. Finance updates it when the IRS rate changes. */
export const MILEAGE_RATE = 0.7;
export const FIRST_LAST_DAY = 0.75;

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const receiptSchema = z.object({ hash, name: z.string().max(200), type: z.string().max(100), size: z.number().int().min(1).max(5_000_000) });
export type Receipt = z.infer<typeof receiptSchema>;

export const lineSchema = z
  .object({
    date: iso,
    category: z.enum(CATEGORY_KEYS as [Category, ...Category[]]),
    description: z.string().trim().min(2).max(300),
    source: z.string().regex(/^[A-Za-z0-9-]{2,40}$/),
    amount: z.number().min(0).max(1e8).optional(),
    miles: z.number().min(0).max(10000).optional(),
    perDiem: z.object({ place: z.string().trim().min(2).max(120), rate: z.number().min(0).max(2000), start: iso, end: iso }).optional(),
    receipts: z.array(receiptSchema).max(10),
    /** Why there is no receipt, when there is none. */
    noReceipt: z.string().trim().max(300).optional(),
  })
  .refine((l) => l.category !== "perDiem" || (!!l.perDiem && l.perDiem.end >= l.perDiem.start), "Per diem needs the place, rate and travel dates.")
  .refine((l) => l.category !== "mileage" || (l.miles ?? 0) > 0, "Mileage needs the miles driven.")
  .refine((l) => l.category === "perDiem" || l.category === "mileage" || (l.amount ?? 0) > 0, "Enter the amount.")
  .refine((l) => l.category === "perDiem" || l.category === "mileage" || l.receipts.length > 0 || (l.noReceipt ?? "").length >= 5, "Attach the receipt, or say why there is none.");
export type ExpenseLine = z.infer<typeof lineSchema>;

export const reportSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  currency: z.enum(["USD", "AFN"]),
  lines: z.array(lineSchema).min(1).max(100),
}).refine((r) => r.currency === "USD" || !r.lines.some((l) => l.category === "mileage"), "Mileage is paid at the US rate; claim fuel as a receipt instead.");
export type Report = z.infer<typeof reportSchema>;

export const exActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit"), report: reportSchema, certify: z.literal(true) }),
  z.object({ action: z.literal("approve"), report: z.number().int().positive() }),
  z.object({ action: z.literal("return"), report: z.number().int().positive(), note: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("withdraw"), report: z.number().int().positive() }),
]);
export type ExAction = z.infer<typeof exActionSchema>;

/* ---------------- Amounts ---------------- */

const r2 = (n: number) => Math.round(n * 100) / 100;
const dayCount = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;

/** Per diem: 75% of the rate on the first and last day, 100% on the days between; one day is 75%. */
export function perDiemOf(p: { rate: number; start: string; end: string }) {
  const n = dayCount(p.start, p.end);
  if (n <= 0) return { days: 0, full: 0, partial: 0, amount: 0 };
  const partial = n === 1 ? 1 : 2;
  const full = n - partial;
  return { days: n, full, partial, amount: r2(p.rate * full + p.rate * FIRST_LAST_DAY * partial) };
}

export function amountOf(l: ExpenseLine) {
  if (l.category === "perDiem" && l.perDiem) return perDiemOf(l.perDiem).amount;
  if (l.category === "mileage") return r2((l.miles ?? 0) * MILEAGE_RATE);
  return r2(l.amount ?? 0);
}

export function summary(r: Report) {
  const byCategory: Partial<Record<Category, number>> = {};
  const bySource: Record<string, number> = {};
  let total = 0;
  for (const l of r.lines) {
    const a = amountOf(l);
    total = r2(total + a);
    byCategory[l.category] = r2((byCategory[l.category] ?? 0) + a);
    bySource[l.source] = r2((bySource[l.source] ?? 0) + a);
  }
  return { total, byCategory, bySource };
}

/** What a checker should look at twice. */
export function flags(r: Report): string[] {
  const out: string[] = [];
  r.lines.forEach((l, i) => {
    const n = `Line ${i + 1}`;
    if (!l.date.startsWith(r.month) && !(l.perDiem && (l.perDiem.start.startsWith(r.month) || l.perDiem.end.startsWith(r.month)))) out.push(`${n}: dated outside ${r.month}.`);
    if (l.noReceipt && !l.receipts.length && l.category !== "perDiem" && l.category !== "mileage") out.push(`${n}: no receipt (${l.noReceipt}).`);
    if (l.category === "entertainment") out.push(`${n}: business entertainment is often not allowed on donor funds; check the source.`);
    if (l.category === "perDiem" && l.perDiem && l.perDiem.rate > 300) out.push(`${n}: per diem rate ${l.perDiem.rate} is high; check the State Department table.`);
  });
  const seen = new Map<string, number>();
  r.lines.forEach((l, i) => {
    for (const rc of l.receipts) {
      if (seen.has(rc.hash)) out.push(`Line ${i + 1}: the same receipt is attached to line ${seen.get(rc.hash)! + 1}.`);
      else seen.set(rc.hash, i);
    }
  });
  return out;
}

/* ---------------- Folding reports out of the ledger ---------------- */

export type ExStatus = "pending" | "approved" | "accepted" | "returned" | "withdrawn";
export type Step = "supervisor" | "finance";
export type ExpenseReport = {
  n: number;
  person: string;
  report: Report;
  by: string;
  at: string;
  version: number;
  previous: number[];
  status: ExStatus;
  signatures: { step: Step; by: string; at: string; n: number }[];
  returned?: { by: string; at: string; note: string };
  total: number;
};
export type ExIgnored = { n: number; kind: string; actor: string; why: string };

const conflict = (u: string, r: Pick<ExpenseReport, "person" | "by">, hr: HrState, signed: string[]) =>
  signed.includes(u) ? "already signed this report" : conflictOf(u, { subject: r.person, by: r.by, signatures: [], type: "expense" }, hr);

/** Who signs the next step: the supervisor (else HR), then Finance (the payroll role, else the CFO). */
export function nextFor(r: ExpenseReport, hr: HrState): { step: Step; people: string[]; via: string } | null {
  if (r.status !== "pending" && r.status !== "approved") return null;
  const signed = r.signatures.map((s) => s.by);
  const ok = (ids: string[]) => ids.filter((u) => !conflict(u, r, hr, signed));
  if (r.status === "pending") {
    const sup = hr.people[r.person]?.current.supervisor;
    if (typeof sup === "string" && ok([sup]).length) return { step: "supervisor", people: [sup], via: "supervisor" };
    return { step: "supervisor", people: ok(hr.rules?.holders.hr ?? []), via: "HR (the supervisor has a conflict)" };
  }
  const fin = ok(hr.rules?.holders.payroll ?? []);
  if (fin.length) return { step: "finance", people: fin, via: "Finance" };
  return { step: "finance", people: ok(hr.rules?.holders.cfo ?? []), via: "the CFO (Finance has a conflict)" };
}
export const whyNot = (u: string, r: ExpenseReport, hr: HrState) => conflict(u, r, hr, r.signatures.map((s) => s.by));

export function foldExpenses(entries: Entry[], hr: HrState): { reports: ExpenseReport[]; ignored: ExIgnored[] } {
  const byKey = new Map<string, ExpenseReport>();
  const byN = new Map<number, ExpenseReport>();
  const ignored: ExIgnored[] = [];
  for (const e of [...entries].sort((a, b) => a.n - b.n)) {
    if (e.kind === "expense") {
      const d = reportSchema.safeParse(e.data);
      if (!d.success || !e.subject) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "unreadable" });
        continue;
      }
      if (e.actor !== e.subject) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "only the person submits their expense report" });
        continue;
      }
      const key = `${e.subject}|${d.data.month}`;
      const prev = byKey.get(key);
      if (prev && (prev.status === "approved" || prev.status === "accepted")) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "already approved; anything more goes in next month's report" });
        continue;
      }
      const r: ExpenseReport = { n: e.n, person: e.subject, report: d.data, by: e.actor, at: e.at, version: (prev?.version ?? 0) + 1, previous: prev ? [...prev.previous, prev.n] : [], status: "pending", signatures: [], total: summary(d.data).total };
      byKey.set(key, r);
      byN.set(e.n, r);
    } else if (e.kind === "ex-approve" || e.kind === "ex-return" || e.kind === "ex-withdraw") {
      const data = e.data as { report?: number; note?: string };
      const r = typeof data?.report === "number" ? byN.get(data.report) : undefined;
      if (!r || byKey.get(`${r.person}|${r.report.month}`) !== r) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "not the current version" });
        continue;
      }
      if (e.kind === "ex-withdraw") {
        if (r.by !== e.actor || r.status !== "pending") ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "only the person withdraws a report not yet signed" });
        else r.status = "withdrawn";
        continue;
      }
      const next = nextFor(r, hr);
      if (!next || !next.people.includes(e.actor)) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: next ? (whyNot(e.actor, r, hr) ?? "not the person who signs this step") : "not waiting for a signature" });
        continue;
      }
      if (e.kind === "ex-return") {
        if (!(typeof data.note === "string" && data.note.trim().length >= 3)) {
          ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "sent back without a reason" });
          continue;
        }
        r.status = "returned";
        r.returned = { by: e.actor, at: e.at, note: data.note };
      } else {
        r.signatures.push({ step: next.step, by: e.actor, at: e.at, n: e.n });
        r.status = next.step === "supervisor" ? "approved" : "accepted";
      }
    }
  }
  return { reports: [...byKey.values()], ignored };
}

/** Accepted reports not yet in a payroll that is approved or waiting, per person. */
export function unpaid(reports: ExpenseReport[], paidIn: Set<number>) {
  return reports.filter((r) => r.status === "accepted" && !paidIn.has(r.n));
}

/** Reports grouped per person, as payroll takes them. */
export function toPayroll(reports: ExpenseReport[]): Record<string, { total: number; bySource: Record<string, number>; reports: number[] }> {
  const out: Record<string, { total: number; bySource: Record<string, number>; reports: number[] }> = {};
  for (const r of reports) {
    const s = summary(r.report);
    const o = (out[r.person] ??= { total: 0, bySource: {}, reports: [] });
    o.total = r2(o.total + s.total);
    for (const [k, v] of Object.entries(s.bySource)) o.bySource[k] = r2((o.bySource[k] ?? 0) + v);
    o.reports.push(r.n);
  }
  return out;
}
