import { HR_ROLES, ROLE_HELP, ROLE_LABEL, type HrRole } from "@/lib/hr";

/**
 * The authority table on the client: who holds each role type, loaded with the session from the
 * HR record (the "rules" entries), plus the catalogue of every signature in the app and the role
 * type it needs. Organizations map their own titles to the role types; nothing here names ROP's.
 */

export type Authority = Partial<Record<HrRole, string[]>>;

let table: Authority = {};
/** Called once the session has loaded; every lookup below reads this. */
export function registerAuthority(a: Authority | null | undefined) {
  table = a ?? {};
}
export const holdersOfType = (type: HrRole): string[] => table[type] ?? [];
export const holdsType = (person: string, type: HrRole) => holdersOfType(type).includes(person);
export const typesHeldBy = (person: string): HrRole[] => HR_ROLES.filter((r) => holdsType(person, r));

/** Who signs, when it is not a role type: the person's line manager, the requester, or a committee named for the purchase. */
export type Signer = HrRole | "supervisor" | "requester" | "committee" | "self";
export const SIGNER_LABEL: Record<Signer, string> = { ...ROLE_LABEL, supervisor: "Line manager", requester: "The person requesting", committee: "Bid committee for the purchase", self: "The person themselves" };

export type Signature = { area: string; what: string; by: Signer[]; note?: string };

/** Every signature in the app, in order of the work it belongs to. */
export const SIGNATURES: Signature[] = [
  { area: "Procurement", what: "Request a purchase", by: ["technical"], note: "The technical lead for the budget line." },
  { area: "Procurement", what: "Approve a purchase request", by: ["management"] },
  { area: "Procurement", what: "Run quotations and solicitations, contracts, receipt and the package", by: ["procurement"] },
  { area: "Procurement", what: "Review a large procurement before award", by: ["compliance"] },
  { area: "Procurement", what: "Evaluate bids", by: ["committee"], note: "Members are named for each purchase and declare any conflict of interest." },
  { area: "Procurement", what: "Approve an award up to the large threshold", by: ["management"] },
  { area: "Procurement", what: "Approve a large award, a sole source or an exception", by: ["ceo"] },
  { area: "Procurement", what: "Check a purchase is ready to pay, prepare the voucher, close the month", by: ["finance"] },
  { area: "Procurement", what: "Approve the procurement calendar", by: ["procurement", "technical"] },
  { area: "Bills", what: "Record a bill paid directly, with its document", by: ["finance", "bills"], note: "Only Finance, and the people named for bill entry." },
  { area: "Bills", what: "Approve a bill paid directly (rent, utilities, insurance)", by: ["management"], note: "Not the person who recorded it." },
  { area: "Bills", what: "Prepare the voucher for a bill, file it in SharePoint, post it in NetSuite", by: ["finance"] },
  { area: "Payroll", what: "Prepare the monthly payroll", by: ["payroll"] },
  { area: "Payroll", what: "Check and approve the payroll", by: ["cfo", "ceo"], note: "Anyone with a bonus or adjustment in the run, or related to someone who has one, cannot sign; the Board signs instead." },
  { area: "HR record", what: "Propose a change to someone's record", by: ["hr"] },
  { area: "HR record", what: "Approve pay, a new hire or leaving", by: ["cfo", "ceo"], note: "Steps are set in the authority table and can be changed with the executive head's and the board's approval." },
  { area: "HR record", what: "Approve a job change", by: ["ceo"] },
  { area: "HR record", what: "Approve contact details, leave balance adjustments", by: ["hr"], note: "A different HR officer from the one who proposed it." },
  { area: "HR record", what: "Change the authority table", by: ["ceo", "board"] },
  { area: "Time and leave", what: "Submit a timesheet, ask for leave, claim expenses", by: ["self"] },
  { area: "Time and leave", what: "Approve a timesheet, leave or an expense report", by: ["supervisor"], note: "HR when the line manager has a conflict." },
  { area: "Time and leave", what: "Approve unpaid, parental or Hajj leave", by: ["supervisor", "hr"] },
  { area: "Time and leave", what: "Accept an expense report for payment", by: ["payroll"], note: "The finance head when payroll has a conflict." },
  { area: "Time and leave", what: "Enter an expense claim from a signed paper claim, with the scan attached", by: ["finance"], note: "Someone else in Finance then accepts it for payment." },
  { area: "Onboarding", what: "Start onboarding, confirm IT set-up, propose the new hire's details", by: ["hr"] },
  { area: "Onboarding", what: "Confirm the security briefing and the induction", by: ["supervisor"] },
];

export { HR_ROLES, ROLE_HELP, ROLE_LABEL };
