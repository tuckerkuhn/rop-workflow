import type { Grid } from "@/lib/budget";
import { HIRE_REQUIRED, type Fields } from "@/lib/hr";

/**
 * Reads a BambooHR employee report (Reports → a custom report with the columns below, exported
 * as CSV or Excel) into proposed HR records. Nothing is written here: each row becomes a "new
 * person" proposal that goes through the usual approvals. Columns are found by their headings,
 * so the report's column order does not matter.
 *
 * Read: First Name, Last Name (or Name), Job Title, Location, Employment Status, Hire Date,
 * Reports To, Pay Rate, Pay Per (or Pay Schedule), Work Phone or Mobile Phone, Employee # (kept as
 * the ADP ID only when the column says ADP), Contract End Date. Status "Inactive" rows are skipped.
 */

export type BambooRow = { row: number; fields: Fields; reportsTo: string; warnings: string[]; errors: string[]; skip: string | null };

const text = (v: unknown) => (v == null ? "" : String(v).trim());
const find = (head: string[], ...p: RegExp[]) => {
  for (const r of p) {
    const i = head.findIndex((h) => r.test(h));
    if (i >= 0) return i;
  }
  return -1;
};
function isoDate(v: unknown): string | null {
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const t = text(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  // BambooHR's US exports write month first.
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

export function readBamboo(grid: Grid): { rows: BambooRow[]; missing: string[] } {
  const h = grid.findIndex((r) => r.some((c) => /first name|^name$|employee name/i.test(text(c))) && r.some((c) => /job title|hire date/i.test(text(c))));
  if (h < 0) return { rows: [], missing: ["a header row with First Name (or Name) and Job Title or Hire Date"] };
  const head = grid[h].map((c) => text(c).toLowerCase());
  const col = {
    first: find(head, /^first name/, /^preferred name/),
    last: find(head, /^last name/),
    name: find(head, /^name$/, /^employee name$/, /^full name$/),
    title: find(head, /job title/, /^title$/),
    location: find(head, /^location/, /^office/, /^division/),
    status: find(head, /employment status/, /employee type/),
    active: find(head, /^status$/),
    hire: find(head, /hire date/, /start date/),
    end: find(head, /contract end/, /end date/),
    reports: find(head, /reports to/, /supervisor/, /manager/),
    rate: find(head, /pay rate/, /^salary/, /^compensation/),
    per: find(head, /pay per/, /pay schedule/, /pay type/),
    phone: find(head, /mobile phone/, /work phone/, /^phone/),
    adp: find(head, /adp/),
  };
  const missing = [
    col.first < 0 && col.name < 0 ? "First Name or Name" : "",
    col.title < 0 ? "Job Title" : "",
    col.hire < 0 ? "Hire Date" : "",
    col.rate < 0 ? "Pay Rate" : "",
  ].filter(Boolean);
  if (missing.length) return { rows: [], missing };
  const at = (r: unknown[], i: number) => (i >= 0 ? r[i] : null);
  const rows: BambooRow[] = [];
  grid.slice(h + 1).forEach((r, k) => {
    if (!r.some((c) => text(c))) return;
    const warnings: string[] = [];
    const errors: string[] = [];
    const name = col.name >= 0 ? text(at(r, col.name)) : `${text(at(r, col.first))} ${text(at(r, col.last))}`.trim();
    const active = text(at(r, col.active));
    const skip = /inactive|terminated/i.test(active) ? "Inactive in BambooHR" : null;
    const loc = text(at(r, col.location));
    const office = /afghan|kabul|kandahar|helmand|herat|mazar|balkh|nangarhar/i.test(loc) ? "Afghanistan" : /guatemala/i.test(loc) ? "Guatemala" : "Home Office";
    if (!loc) warnings.push("No location: put in the Home Office; check");
    const status = text(at(r, col.status));
    const employment = /contract|consult|freelanc/i.test(status) ? "Contractor" : /expat|international/i.test(status) ? "Expatriate" : office === "Afghanistan" ? "National staff" : "Employee";
    if (office === "Afghanistan" && employment === "National staff" && !/national|local/i.test(status)) warnings.push("In Afghanistan: entered as national staff; change to Expatriate if they are");
    // "65,000.00 USD", "$31.25", "48000 AFN".
    const rateText = text(at(r, col.rate));
    const amount = Number(rateText.replace(/[^0-9.]/g, ""));
    const currency = /afn|afghani|؋/i.test(rateText) ? "AFN" : "USD";
    const per = text(at(r, col.per)).toLowerCase();
    let payBasis: "Month" | "Day" | "Hour" = "Month";
    let pay = amount;
    if (/hour/.test(per)) payBasis = "Hour";
    else if (/day/.test(per)) payBasis = "Day";
    else if (/year|annual|salary/.test(per) || (!per && amount > 20000 && currency === "USD")) {
      pay = Math.round((amount / 12) * 100) / 100;
      warnings.push(`Yearly ${amount.toLocaleString("en-US")} entered as ${pay.toLocaleString("en-US")} a month`);
    } else if (/week/.test(per)) {
      pay = Math.round(((amount * 52) / 12) * 100) / 100;
      warnings.push(`Weekly pay entered as ${pay.toLocaleString("en-US")} a month`);
    } else if (!per) warnings.push("Pay period not given: taken as monthly");
    const startDate = isoDate(at(r, col.hire));
    const contractEnd = isoDate(at(r, col.end));
    const fields: Fields = {
      name,
      title: text(at(r, col.title)),
      office,
      employment,
      startDate,
      payBasis,
      pay: amount > 0 ? pay : null,
      currency,
      ...(contractEnd ? { contractEnd } : {}),
      ...(text(at(r, col.phone)) ? { phone: text(at(r, col.phone)) } : {}),
      ...(text(at(r, col.adp)) ? { adpId: text(at(r, col.adp)) } : {}),
    };
    for (const k of HIRE_REQUIRED) if (fields[k] == null || fields[k] === "") errors.push(`${k === "pay" ? "Pay rate" : k === "startDate" ? "Hire date" : k} missing`);
    rows.push({ row: h + k + 2, fields, reportsTo: text(at(r, col.reports)), warnings, errors, skip });
  });
  return { rows, missing: [] };
}
