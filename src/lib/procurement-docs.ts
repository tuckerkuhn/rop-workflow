/**
 * Documents generated from a procurement record. Staff fill in the record in the app;
 * these documents are built from it, reviewed, and signed. Nobody types them separately.
 */

import { PROJECT, holderOf } from "@/lib/demo";
import { levelFor, lineOf, roleLabel, valueOf, type Money, type Procurement } from "@/lib/procurement";

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
  const holder = holderOf("procurement", "holder")?.name ?? roleLabel("holder");
  const level = levelFor(value);
  const method = level === "Micro" ? "Market pricing" : level === "Small" ? "Three written quotations" : "Request for quotation · lowest priced technically acceptable";
  const base: [string, string][] = [
    ["Procurement ID", p.id],
    ["Project", `${PROJECT.name} · ${PROJECT.award}`],
    ["Item", p.title],
  ];
  const number = `${p.id}-${slug(doc)}`;

  switch (doc) {
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
          ["Received", p.grn ? `${p.grn.qty.toLocaleString("en-US")} ${p.unit}` : "—"],
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
          ["Invoice", p.invoice ? both(p.invoice.amount) : "—"],
          ["Last screening", p.supplier?.screenedOn ?? "—"],
          ["Payee account", "Verified against contract and supplier evidence"],
        ],
        notes: ["No payment without a complete file, a certified receipt and screening evidence. Payment approval follows the Finance Manual."],
      };
    default:
      return {
        title: doc,
        number,
        rows: [...base, ["Value", both(value)], ["Status", "Generated from the procurement record"]],
        notes: [],
      };
  }
}
