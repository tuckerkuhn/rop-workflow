import { z } from "zod";

/**
 * The organization's supplier register: one record per supplier, shared by every project.
 * Procurements link to it by id, so repeat purchases, duplicate invoices and screening are
 * matched on the supplier, not on a name typed differently each time. Evidence (licence, bank
 * letter, screening printout) stays in SharePoint; the register keeps the link and who checked it.
 * Nothing is deleted: a supplier is suspended with a reason, and every change is in its history.
 */

export type Screening = { date: string; lists: string; result: "clear" | "match"; note: string; evidence: string; by: string; byName: string };
export type BankCheck = { bank: string; accountEnd: string; evidence: string; confirmedBy: string; confirmedByName: string; on: string; how: string };
export type SupplierEvent = { at: string; by: string; byName: string; what: string };

export type Supplier = {
  id: string;
  name: string;
  /** Other names it trades or invoices under. */
  aka: string[];
  licenceNo: string;
  licenceExpiry: string;
  licenceEvidence: string;
  /** Tazkira or registration of the owner, as the policy asks for vendor due diligence. */
  ownerId: string;
  phone: string;
  address: string;
  bank: BankCheck | null;
  screenings: Screening[];
  /** Declared: no family or business link to anyone at ROP. */
  noStaffLink: { on: string; evidence: string } | null;
  status: "active" | "suspended";
  suspendedWhy: string;
  history: SupplierEvent[];
};

export type SupplierRegister = { suppliers: Supplier[] };

const link = z.string().trim().max(600);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.");

export const supplierFields = z.object({
  name: z.string().trim().min(2, "Name the supplier as on its licence.").max(160),
  aka: z.array(z.string().trim().min(1).max(160)).max(10).default([]),
  licenceNo: z.string().trim().max(80).default(""),
  licenceExpiry: z.union([day, z.literal("")]).default(""),
  licenceEvidence: link.default(""),
  ownerId: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(60).default(""),
  address: z.string().trim().max(300).default(""),
});

export const supplierAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), fields: supplierFields }),
  z.object({ action: z.literal("edit"), id: z.string(), fields: supplierFields }),
  z.object({ action: z.literal("screen"), id: z.string(), date: day, lists: z.string().trim().min(3, "Say which lists were checked.").max(400), result: z.enum(["clear", "match"]), note: z.string().trim().max(1000).default(""), evidence: link.min(5, "Link the screening record in SharePoint.") }),
  z.object({
    action: z.literal("bank"),
    id: z.string(),
    bank: z.string().trim().min(2).max(120),
    accountEnd: z.string().trim().regex(/^\d{3,6}$/, "The last 3 to 6 digits of the account only."),
    evidence: link.min(5, "Link the bank letter in SharePoint."),
    how: z.string().trim().min(5, "Say how the details were confirmed (for example, a call to the number on the licence).").max(300),
  }),
  z.object({ action: z.literal("noStaffLink"), id: z.string(), evidence: link.min(5, "Link the signed declaration in SharePoint.") }),
  z.object({ action: z.literal("suspend"), id: z.string(), reason: z.string().trim().min(10, "Say why, in a sentence.").max(600) }),
  z.object({ action: z.literal("reinstate"), id: z.string(), reason: z.string().trim().min(10, "Say why, in a sentence.").max(600) }),
]);
export type SupplierAction = z.infer<typeof supplierAction>;

const normal = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(co|company|ltd|limited|llc|enterprise|trading|construction|services?)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
/** Whether two names are the same supplier, ignoring case, punctuation and company suffixes. */
export const sameSupplierName = (a: string, b: string) => !!normal(a) && normal(a) === normal(b);
/** Suppliers already in the register under this name or one of its other names. */
export const lookalikes = (reg: Supplier[], name: string, except?: string) => reg.filter((s) => s.id !== except && [s.name, ...s.aka].some((n) => sameSupplierName(n, name)));

export const lastScreening = (s: Supplier) => [...s.screenings].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

/** Months between two ISO dates, rounded down. */
const monthsBetween = (from: string, to: string) => {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
};

/** What stops this supplier being paid or awarded today, plain-language; empty when ready. */
export function supplierGaps(s: Supplier, today: string, rescreenMonths = 6): string[] {
  const out: string[] = [];
  if (s.status === "suspended") out.push(`Suspended: ${s.suspendedWhy}`);
  const sc = lastScreening(s);
  if (!sc) out.push("Not screened yet");
  else if (sc.result === "match") out.push(`Screening on ${sc.date} found a match`);
  else if (monthsBetween(sc.date, today) >= rescreenMonths) out.push(`Last screened ${sc.date}: more than ${rescreenMonths} months ago`);
  if (!s.licenceNo || !s.licenceEvidence) out.push("No licence on file");
  else if (!s.licenceExpiry || s.licenceExpiry < today) out.push(s.licenceExpiry ? `Licence expired ${s.licenceExpiry}` : "Licence expiry not recorded");
  if (!s.bank) out.push("Bank details not confirmed");
  if (!s.noStaffLink) out.push("No declaration of no staff connection");
  return out;
}

/** Applies an action. Returns the new register, or why it was refused. */
export function applySupplierAction(reg: SupplierRegister, a: SupplierAction, who: { id: string; name: string; finance: boolean; manage: boolean }, today: string, newId: () => string): SupplierRegister | string {
  const ev = (what: string): SupplierEvent => ({ at: today, by: who.id, byName: who.name, what });
  if (a.action === "add") {
    if (!who.manage) return "Only procurement staff add suppliers.";
    const twins = [a.fields.name, ...a.fields.aka].flatMap((n) => lookalikes(reg.suppliers, n));
    if (twins.length) return `Already in the register as ${twins[0].name}: use that record, or add this name to it as another name.`;
    const s: Supplier = { id: newId(), ...a.fields, bank: null, screenings: [], noStaffLink: null, status: "active", suspendedWhy: "", history: [ev("Added to the register")] };
    return { suppliers: [...reg.suppliers, s] };
  }
  const s = reg.suppliers.find((x) => x.id === a.id);
  if (!s) return "No such supplier.";
  const put = (next: Supplier) => ({ suppliers: reg.suppliers.map((x) => (x.id === s.id ? next : x)) });
  switch (a.action) {
    case "edit": {
      if (!who.manage) return "Only procurement staff change a supplier's details.";
      const twins = [a.fields.name, ...a.fields.aka].flatMap((n) => lookalikes(reg.suppliers, n, s.id));
      if (twins.length) return `That name belongs to ${twins[0].name} in the register.`;
      const changed = (Object.keys(a.fields) as (keyof typeof a.fields)[]).filter((k) => JSON.stringify(s[k]) !== JSON.stringify(a.fields[k]));
      if (!changed.length) return put(s);
      return put({ ...s, ...a.fields, history: [...s.history, ev(`Changed ${changed.join(", ")}`)] });
    }
    case "screen": {
      if (!who.manage) return "Only procurement staff record a screening.";
      if (a.date > today) return "A screening cannot be dated in the future.";
      const sc: Screening = { date: a.date, lists: a.lists, result: a.result, note: a.note, evidence: a.evidence, by: who.id, byName: who.name };
      // A match suspends the supplier until someone with authority reviews it.
      const match = a.result === "match";
      return put({ ...s, screenings: [...s.screenings, sc], ...(match ? { status: "suspended" as const, suspendedWhy: `Screening match on ${a.date}: ${a.note || a.lists}` } : {}), history: [...s.history, ev(`Screened ${a.date}: ${a.result}${match ? " (suspended)" : ""}`)] });
    }
    case "bank": {
      // Bank details are Finance's to confirm: the spot check's payment-diversion risk.
      if (!who.finance) return "Finance confirms a supplier's bank details.";
      const changedBank = !!s.bank && (s.bank.bank !== a.bank || s.bank.accountEnd !== a.accountEnd);
      const bank: BankCheck = { bank: a.bank, accountEnd: a.accountEnd, evidence: a.evidence, how: a.how, confirmedBy: who.id, confirmedByName: who.name, on: today };
      return put({ ...s, bank, history: [...s.history, ev(changedBank ? `Bank details CHANGED to ${a.bank} …${a.accountEnd}, confirmed: ${a.how}` : `Bank details confirmed: ${a.bank} …${a.accountEnd} (${a.how})`)] });
    }
    case "noStaffLink":
      if (!who.manage) return "Only procurement staff record the declaration.";
      return put({ ...s, noStaffLink: { on: today, evidence: a.evidence }, history: [...s.history, ev("Declaration of no staff connection filed")] });
    case "suspend":
      if (!who.manage && !who.finance) return "Only procurement or Finance staff suspend a supplier.";
      return put({ ...s, status: "suspended", suspendedWhy: a.reason, history: [...s.history, ev(`Suspended: ${a.reason}`)] });
    case "reinstate": {
      if (!who.manage) return "Only procurement staff reinstate a supplier.";
      const sc = lastScreening(s);
      if (sc?.result === "match") return "The last screening found a match: record a clear screening first.";
      return put({ ...s, status: "active", suspendedWhy: "", history: [...s.history, ev(`Reinstated: ${a.reason}`)] });
    }
  }
}
