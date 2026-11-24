import { orderUsd } from "@/lib/payments";
import { DONE, ROUTES, blockingIssues, levelFor, ownerOf, requesterOf, roleLabel, stepById, valueOf, vendbillOf, type Procurement } from "@/lib/procurement";
import { toCsv } from "@/lib/field-data";

/**
 * The procurement register: one row per purchase, built from the procurement records themselves.
 * It is the report a donor or auditor asks for ("no reports are generated from the system"): who
 * asked, who approved, how the supplier was chosen, the order, goods received, payment and the
 * filed documents. A monthly report is the same register narrowed to purchases with activity in
 * that month. Nothing is typed twice and nothing is stored: it is read fresh each time.
 */

export type RegisterRow = {
  id: string;
  title: string;
  budgetLine: string;
  funding: string;
  requested: string;
  requestedBy: string;
  approved: string;
  level: string;
  route: string;
  quotes: number;
  supplier: string;
  ordered: string;
  received: string;
  valueUsd: number;
  payments: number;
  lastPaid: string;
  vouchers: string;
  documents: number;
  status: string;
  closed: boolean;
  openIssues: number;
  lastActivity: string;
};

const signed = (sigs: Procurement["signatures"] | undefined, doc: string, as?: RegExp) =>
  (sigs?.[doc] ?? []).filter((s) => !as || as.test(s.as)).map((s) => s.date).filter(Boolean).sort();

const first = (dates: string[]) => dates[0] ?? "";
const last = (dates: string[]) => dates[dates.length - 1] ?? "";

/** The days a purchase moved: its timeline, signatures and payments. */
function datesOf(p: Procurement): string[] {
  const out: string[] = [];
  for (const e of p.timeline ?? []) if (e.date) out.push(e.date.slice(0, 10));
  for (const list of Object.values(p.signatures ?? {})) for (const s of list) if (s.date) out.push(s.date.slice(0, 10));
  for (const pay of p.payments ?? []) if (pay.paid?.date) out.push(pay.paid.date.slice(0, 10));
  return out.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
}

export function registerRow(p: Procurement): RegisterRow {
  const dates = datesOf(p);
  const chosen = p.bids?.find((b) => b.id === p.selectedBid);
  const received = [...signed(p.signatures, "Goods received note"), ...(p.payments ?? []).flatMap((x) => signed(x.signatures, "Goods received note"))].sort();
  const paidDates = (p.payments ?? []).map((x) => x.paid?.date ?? "").filter(Boolean).sort();
  const vouchers = [...(p.payments ?? []).map((x) => vendbillOf(x.voucher)), vendbillOf(p.voucher)].filter(Boolean);
  const owner = ownerOf(p);
  const closed = p.step === DONE;
  return {
    id: p.id,
    title: p.title,
    budgetLine: p.budgetLine,
    funding: p.funding,
    requested: first(signed(p.signatures, "Purchase requisition", /submitted/i)) || first(dates),
    requestedBy: requesterOf(p) ?? "",
    approved: first(signed(p.signatures, "Purchase requisition", /^approved/i)),
    level: levelFor(valueOf(p)),
    route: p.route ? (ROUTES.find((r) => r.id === p.route)?.title ?? p.route) : p.sole ? "Sole source" : p.bids?.length ? "Competitive quotes or bids" : p.supplier || p.selectedBid || (stepById[p.step]?.stage ?? 0) > 3 || p.step === DONE ? "Not recorded" : "",
    quotes: p.bids?.length ?? 0,
    supplier: p.supplier?.name ?? chosen?.supplier ?? p.sole?.supplier ?? "",
    ordered: last(signed(p.signatures, "Contract / PO", /signed for/i)),
    received: last(received),
    valueUsd: Math.round(orderUsd(p) * 100) / 100,
    payments: paidDates.length,
    lastPaid: last(paidDates),
    vouchers: [...new Set(vouchers)].join(" "),
    documents: p.links?.length ?? 0,
    status: closed ? "Closed" : `${stepById[p.step]?.title ?? p.step}${owner ? ` (waiting on ${roleLabel(owner).toLowerCase()})` : ""}`,
    closed,
    openIssues: blockingIssues(p).length,
    lastActivity: last(dates),
  };
}

/** Months ("2026-10") in which any purchase moved, newest first. */
export function registerMonths(items: Procurement[]): string[] {
  return [...new Set(items.flatMap((p) => datesOf(p).map((d) => d.slice(0, 7))))].sort().reverse();
}

/** The register, or the month's report: purchases that moved in that month, or are still open at its end and were requested by then. */
export function registerRows(items: Procurement[], month?: string): RegisterRow[] {
  const rows = items.map((p) => ({ row: registerRow(p), dates: datesOf(p) }));
  const keep = month
    ? rows.filter(({ row, dates }) => dates.some((d) => d.startsWith(month)) || (!row.closed && !!row.requested && row.requested.slice(0, 7) <= month))
    : rows;
  return keep.map((x) => x.row).sort((a, b) => (b.requested || "").localeCompare(a.requested || "") || a.id.localeCompare(b.id));
}

export type RegisterTotals = { count: number; open: number; closed: number; valueUsd: number; withIssues: number };

export function registerTotals(rows: RegisterRow[]): RegisterTotals {
  return {
    count: rows.length,
    open: rows.filter((r) => !r.closed).length,
    closed: rows.filter((r) => r.closed).length,
    valueUsd: Math.round(rows.reduce((s, r) => s + r.valueUsd, 0) * 100) / 100,
    withIssues: rows.filter((r) => r.openIssues > 0).length,
  };
}

export const REGISTER_HEADERS = [
  "Reference",
  "What",
  "Budget line",
  "Funding",
  "Requested on",
  "Requested by",
  "Approved on",
  "Size",
  "How bought",
  "Quotes or bids",
  "Supplier",
  "Order or contract signed",
  "Goods received",
  "Value (USD)",
  "Payments made",
  "Last paid",
  "Voucher numbers",
  "Documents filed",
  "Where it stands",
  "Open issues",
  "Last activity",
];

export function registerCsv(rows: RegisterRow[]): string {
  return toCsv({
    headers: REGISTER_HEADERS,
    rows: rows.map((r) => [
      r.id,
      r.title,
      r.budgetLine,
      r.funding,
      r.requested,
      r.requestedBy,
      r.approved,
      r.level,
      r.route,
      String(r.quotes),
      r.supplier,
      r.ordered,
      r.received,
      r.valueUsd.toFixed(2),
      String(r.payments),
      r.lastPaid,
      r.vouchers,
      String(r.documents),
      r.status,
      String(r.openIssues),
      r.lastActivity,
    ]),
  });
}
