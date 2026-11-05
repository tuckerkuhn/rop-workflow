/**
 * Documents generated from a procurement record. Staff fill in the record in the app;
 * these documents are built from it, reviewed, and signed. Nobody types them separately.
 */

import { PROJECT, holderOf } from "@/lib/demo";
import { levelFor, lineOf, roleLabel, valueOf, type Money, type Procurement } from "@/lib/procurement";
import { currentInstalment, expectedAfn, expectedUsd, invoiceUsd, receivedBefore, withholding } from "@/lib/payments";
import { today } from "@/lib/clock";

export type GeneratedDoc = { title: string; number: string; rows: [string, string][]; notes: string[] };

const slug = (doc: string) =>
  doc
    .replace(/[^A-Za-z]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase();

export function documentFor(p: Procurement, doc: string, money: Money, other: Money): GeneratedDoc {
  const value = valueOf(p);
  const line = lineOf(p);
  const both = (usd: number) => `${money(usd)} (${other(usd)})`;
  const holder = p.plan?.requestedBy ?? holderOf("procurement", "holder")?.name ?? roleLabel("holder");
  const level = levelFor(value);
  const method = level === "Micro" ? "Market pricing" : level === "Small" ? "Three written quotations" : "Request for quotation · lowest priced technically acceptable";
  const base: [string, string][] = [
    ["Procurement ID", p.id],
    ["Project", p.plan ? p.plan.project : `${PROJECT.name} · ${PROJECT.award}`],
    ["Item", p.title],
  ];
  const inst = currentInstalment(p);
  const pn = inst.of > 1 ? `-P${inst.n}` : "";
  const number = `${p.id}-${slug(doc)}${["Goods received note", "Payment approval form", "Checklist pass 2", "Procurement package"].includes(doc) ? pn : ""}`;
  const instRow: [string, string][] = inst.of > 1 ? [["Payment", `${inst.n} of ${inst.of} · ${inst.label} · ${inst.pct}%`]] : [];
  const cur = p.invoice?.currency ?? "USD";
  const inCur = (n: number) => (cur === "USD" ? money(n) : `AFN ${Math.round(n).toLocaleString("en-US")}`);
  const tax = withholding(p, p.paid?.date ?? today());

  // AI-drafted documents (corrected by procurement) are shown as drafted, section by section.
  const drafted = p.drafts?.[doc];
  if (drafted)
    return {
      title: doc,
      number,
      rows: [...base, ...drafted.sections.map((s): [string, string] => [s.heading, s.body])],
      notes: [
        `Drafted with AI (${drafted.model}) on ${drafted.at} at ${drafted.by}'s request${drafted.edited ? ", then corrected by procurement" : ""}. Procurement is responsible for every statement in it.`,
        ...drafted.questions.map((q) => `Still to confirm: ${q}`),
      ],
    };

  switch (doc) {
    case "Expense voucher": {
      const signed = Object.entries(p.signatures).flatMap(([d, list]) => list.map((x) => `${x.as}: ${x.name}, ${x.date} (${d})`));
      return {
        title: "Expense voucher",
        number: p.voucher?.number ?? `EV-${p.id}`,
        rows: [
          ...base,
          ["Payee", p.supplier?.name ?? "[supplier]"],
          ...instRow,
          ["Gross amount", p.invoice ? `${inCur(p.invoice.amount)}${cur === "AFN" && invoiceUsd(p.invoice) !== null ? ` (${money(invoiceUsd(p.invoice)!)})` : ""}` : `${both(value)} (order value; no invoice recorded)`],
          ["Tax withheld", tax ? `${inCur(tax.amount)} (${tax.pct}%), payable to the Ministry of Finance` : "—"],
          ["Net paid to supplier", p.invoice && tax ? inCur(p.invoice.amount - tax.amount) : "—"],
          ["Budget line", line ? `${line.code} ${line.name}` : p.budgetLine],
          ["Funding source", p.funding],
          ["Activity", p.activity],
          ["Order", `${p.id} · ${p.qty} ${p.unit}`],
          ["Goods received", p.grn ? `${p.grn.qty} ${p.unit} at ${p.grn.place}` : "[goods received note]"],
          ["Invoice", p.invoice ? `${p.invoice.number ?? ""} ${p.invoice.date ?? ""} · ${inCur(p.invoice.amount)} for ${p.invoice.qty} ${p.unit}`.trim() : "[invoice]"],
          ["Approvals", signed.join("; ") || "—"],
          ["Filed in SharePoint", p.voucher?.sharepointUrl || "—"],
          ["NetSuite reference", p.voucher?.netsuiteRef || "—"],
          ["Closeout month", p.voucher?.month || "—"],
        ],
        notes: ["Generated from the procurement record. File it in SharePoint, then post it in NetSuite, and record both above."],
      };
    }
    case "Purchase requisition":
      return {
        title: "Purchase requisition",
        number,
        rows: [
          ...base,
          ["Requested by", `${holder} (budget holder)`],
          ["Activity", p.activity],
          ["Funding source", p.funding],
          ["Budget line", line ? `${line.code} ${line.name} · ${money(line.remainingValue)} left${line.remainingQty !== undefined ? ` · ${line.remainingQty} ${line.unit} left` : ""}` : p.budgetLine],
          ["Specification", p.specification || "—"],
          ["Quantity", `${p.qty.toLocaleString("en-US")} ${p.unit}`],
          ["Estimated unit price", both(p.unitPrice)],
          ["Estimated total", both(value)],
          ["Procurement level", level],
          ["Needed by", p.neededBy],
          ["Delivery place", p.place],
          ["Planned or urgent", p.urgent ? "Urgent (not in the procurement plan)" : "Planned"],
          ["Environmental or social risk", p.esRisk || "—"],
          ["Price basis", p.priceBasis || "—"],
        ],
        notes: [
          "Information given to any potential supplier before award is confidential. Sharing it is a disciplinary matter.",
          "Any signatory who thinks this purchase should be delayed, changed or cancelled may attach a memo giving the reasons.",
        ],
      };
    case "Solicitation (RFQ/RFP)":
      return {
        title: level === "Large" || level === "Medium" ? "Request for quotation" : "Solicitation",
        number,
        rows: [
          ...base,
          ["Specification", p.specification],
          ["Quantity", `${p.qty.toLocaleString("en-US")} ${p.unit}`],
          ["Delivery", `${p.place} by ${p.neededBy}`],
          ["Evaluation", method],
          ["Closing", p.closingDate ?? "Set on issue"],
          ["Bid validity", "90 days from closing"],
        ],
        notes: [
          "Minimum requirements are pass or fail and are checked before any scoring.",
          "A bidder related to any Roots of Peace staff member must say so on the front page of its bid.",
          "Protests and concerns: use the channel in the Roots of Peace Whistleblower Policy (interim: Grievance Redressal Procedures).",
        ],
      };
    case "Source selection memo":
      return {
        title: "Source selection memo",
        number,
        rows: [
          ...base,
          ["Method", method],
          ["Recommended supplier", p.supplier?.name ?? "Pending evaluation"],
          ["Award value", both(value)],
          ["Basis for award", "Lowest priced bid meeting every stated minimum requirement, exactly as published"],
        ],
        notes: ["The comparative bid matrix and the committee's reasoning are attached."],
      };
    case "Contract / PO":
      return {
        title: level === "Large" ? "Supply contract" : "Purchase order",
        number,
        rows: [
          ...base,
          ["Supplier", p.supplier?.name ?? "—"],
          ["Quantity", `${p.qty.toLocaleString("en-US")} ${p.unit}`],
          ["Price", both(value)],
          ["Delivery", `${p.place} by ${p.neededBy}`],
          ["Funding source", p.funding],
          ["Liquidated damages", "0.1% of contract value per day late, capped at 10%"],
        ],
        notes: ["Includes Roots of Peace standard terms: audit and access, records, anti-corruption, safeguarding, labor, environmental and social, data, intellectual property, termination, subcontracting."],
      };
    case "Goods received note":
      return {
        title: "Goods received note",
        number,
        rows: [
          ...base,
          ["Supplier", p.supplier?.name ?? "—"],
          ["Ordered", `${p.qty.toLocaleString("en-US")} ${p.unit}`],
          ...instRow,
          ["Received", p.grn ? `${p.grn.qty.toLocaleString("en-US")} ${p.unit}${receivedBefore(p) ? ` (${(receivedBefore(p) + p.grn.qty).toLocaleString("en-US")} in all, with earlier payments)` : ""}` : "—"],
          ...(p.grn?.progressPct !== undefined ? ([["Work verified complete", `${p.grn.progressPct}%`]] as [string, string][]) : []),
          ["Place of receipt", p.grn?.place ?? p.place],
          ["Requesting department", holder],
        ],
        notes: ["Inspected against the contract, the delivery note and the invoice by the person who requested the goods."],
      };
    case "Checklist pass 2":
      return {
        title: "Payment-ready checklist (pass 2)",
        number,
        rows: [
          ...base,
          ["Supplier", p.supplier?.name ?? "—"],
          ...instRow,
          ["Invoice", p.invoice ? inCur(p.invoice.amount) : "—"],
          ["Tax withheld", tax ? `${inCur(tax.amount)} (${tax.pct}%)` : "—"],
          ["Last screening", p.supplier?.screenedOn ?? "—"],
          ["Payee account", "Verified against contract and supplier evidence"],
        ],
        notes: ["No payment without a complete file, a certified receipt and screening evidence. Payment approval follows the Finance Manual."],
      };
    case "Payment approval form": {
      const inv = p.invoice;
      return {
        title: "Payment approval form",
        number,
        rows: [
          ...base,
          ...instRow,
          ["Payee", p.supplier?.name ?? "[supplier]"],
          ["Business licence", p.supplier?.licenceNo ? `${p.supplier.licenceNo}, valid until ${p.supplier.licenceExpiry ?? "[date]"}` : p.supplier?.licenceExpiry ? `Valid until ${p.supplier.licenceExpiry}` : "[licence]"],
          ["Contract value", p.contractAfn && p.contractCurrency === "AFN" ? `AFN ${p.contractAfn.toLocaleString("en-US")}` : both(value)],
          ["Due for this payment", expectedAfn(p) !== null ? `AFN ${expectedAfn(p)!.toLocaleString("en-US")}` : money(expectedUsd(p))],
          ["Invoice", inv ? `${inv.number ?? "[number]"} of ${inv.date ?? "[date]"}` : "[invoice]"],
          ["Gross amount", inv ? `${inCur(inv.amount)}${cur === "AFN" && inv.rate ? ` at AFN ${inv.rate} per USD = ${money(invoiceUsd(inv)!)}` : ""}` : "—"],
          ["Tax withheld", tax ? `${inCur(tax.amount)} (${tax.pct}%)` : "—"],
          ["Net to pay", inv && tax ? inCur(inv.amount - tax.amount) : "—"],
          ["Budget line", line ? `${line.code} ${line.name}` : p.budgetLine],
          ["Activity", p.activity],
          ["Funding source", p.funding],
        ],
        notes: [tax?.why ?? "", "Prepared by procurement, checked by Finance (and verified by a second Finance person on larger contracts), approved by programme management. The withholding rate is certified by Finance on each payment."].filter(Boolean),
      };
    }
    default:
      return {
        title: doc,
        number,
        rows: [...base, ["Value", both(value)], ["Status", "Generated from the procurement record"]],
        notes: [],
      };
  }
}
