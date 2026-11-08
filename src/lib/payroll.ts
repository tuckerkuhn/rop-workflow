import { z } from "zod";
import type { Fields, HrState } from "@/lib/hr";
import { HOURS_PER_DAY, WORK_WEEK, apportion, daysIn, splitOf, weekday, type Timesheet } from "@/lib/timesheet";

/**
 * The monthly payroll register, worked out from the HR record (pay, allowances, 403(b)) and the
 * approved timesheets (days, danger pay and post differential days, the funding split), plus the
 * adjustments the payroll preparer enters with a reason. The rules follow the ROP payroll workbook:
 *
 * - Daily rate: monthly pay ÷ 21.67 average working days; a daily rate as is; an hourly rate × 8.
 * - Danger pay and post differential: daily rate × days on the timesheet × the person's percentage.
 * - Gross pay: regular pay, danger pay, post differential, allowances, medical reimbursement,
 *   vacation payout, bonus, retro pay and non-taxable expenses.
 * - 403(b): the employee's percentage of pay excluding expenses and vacation payout, rounded down to
 *   the cent; ROP adds half of that, rounded down. The bonus is always included: the workbook
 *   left it out on a few rows, and the CFO confirmed (2026-11-05) that ROP's plan includes it.
 * - Employer taxes (FICA, SUI) for the Home Office are calculated by ADP and are not worked out here.
 * - Afghanistan: salary tax withheld on the monthly schedule below, for Finance to check and pay.
 *
 * Cost per funding source: each person's cost (gross plus the employer 403(b)) shared by their
 * timesheet split, to the cent, adding up exactly.
 */

export const AVERAGE_DAYS = 21.67;
export const EMPLOYER_MATCH = 0.5;
export const GROUPS = ["Home Office", "Afghanistan"] as const;
export type Group = (typeof GROUPS)[number];
/** How each group is paid. */
export const PAID_BY: Record<Group, string> = { "Home Office": "ADP RUN", Afghanistan: "Bank transfer" };

/**
 * Afghan monthly salary tax (Income Tax Law): up to 5,000 AFN nil; 5,001–12,500 at 2%; 12,501–100,000
 * at 10%; over 100,000 at 20%. Finance confirms the schedule before relying on it.
 */
export function afghanTax(monthly: number) {
  const bands: [number, number, number][] = [
    [5000, 12500, 0.02],
    [12500, 100000, 0.1],
    [100000, Infinity, 0.2],
  ];
  let tax = 0;
  for (const [lo, hi, r] of bands) if (monthly > lo) tax += (Math.min(monthly, hi) - lo) * r;
  return Math.round(tax);
}

export const ADJUSTMENTS = {
  bonus: "Bonus",
  retro: "Retro pay",
  vacationPayout: "Vacation payout",
  medicalReimb: "Medical reimbursement",
  advance: "Advance repayment (deducted)",
} as const;
export type AdjustmentKey = keyof typeof ADJUSTMENTS;
export const ADJUSTMENT_KEYS = Object.keys(ADJUSTMENTS) as AdjustmentKey[];
export type Adjustment = Partial<Record<AdjustmentKey, number>> & { note?: string };
/** Accepted expense reports to reimburse: total, by funding source, and which reports. */
export type Expenses = { total: number; bySource: Record<string, number>; reports: number[] };

export const adjustmentSchema = z
  .object({
    bonus: z.number().min(0).max(1e8).optional(),
    retro: z.number().min(-1e8).max(1e8).optional(),
    vacationPayout: z.number().min(0).max(1e8).optional(),
    medicalReimb: z.number().min(0).max(1e8).optional(),
    advance: z.number().min(0).max(1e8).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((a) => !ADJUSTMENT_KEYS.some((k) => a[k]) || (a.note ?? "").length >= 3, "Every adjustment needs a note saying why.");

export type Line = {
  person: string;
  name: string;
  title: string;
  office: string;
  currency: string;
  payBasis: string;
  rate: number;
  adpId: string | null;
  bankAccount: string | null;
  /** Share of the month employed (start or leaving date inside the month). */
  employed: number;
  daysWorked: number;
  hoursWorked: number;
  dailyRate: number;
  regular: number;
  dangerDays: number;
  dangerPay: number;
  postDiffDays: number;
  postDiff: number;
  comms: number;
  living: number;
  bonus: number;
  retro: number;
  vacationPayout: number;
  medicalReimb: number;
  expenses: number;
  advance: number;
  gross: number;
  retirementBase: number;
  ee403b: number;
  er403b: number;
  tax: number;
  /** Paid to the person before Home Office taxes, which ADP withholds. */
  net: number;
  /** Gross plus the employer 403(b), by funding source. */
  cost: Record<string, number>;
  pct: Record<string, number>;
  timesheet: number | null;
  /** Expense reports reimbursed in this line, and their amounts by funding source. */
  expenseReports: number[];
  expenseBySource: Record<string, number>;
  note: string | null;
  problems: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const down2 = (n: number) => Math.floor(n * 100 + 1e-6) / 100;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The record as it stood on a date: approved changes effective on or before it. */
export function recordOn(hr: HrState, person: string, on: string): Fields {
  const out: Fields = {};
  const changes = hr.proposals
    .filter((p) => p.status === "approved" && p.subject === person && (p.type === "hire" || p.type === "update") && p.effective <= on)
    .sort((a, b) => a.effective.localeCompare(b.effective) || a.id - b.id);
  for (const c of changes) Object.assign(out, (c as { fields: Fields }).fields);
  return out;
}

/** Who is in a group's payroll for a month: employed for at least one day of it. */
export function inPayroll(hr: HrState, group: Group, month: string): string[] {
  const first = `${month}-01`;
  const last = daysIn(month).at(-1)!;
  return Object.values(hr.people)
    .filter((p) => {
      const rec = recordOn(hr, p.id, last);
      if (String(rec.office ?? "") !== group) return false;
      if (!rec.startDate || String(rec.startDate) > last) return false;
      return !p.separated || p.separated.effective >= first;
    })
    .map((p) => p.id);
}

export function lineFor(hr: HrState, person: string, month: string, sheet: Timesheet | undefined, adj: Adjustment = {}, exp?: Expenses): Line {
  const days = daysIn(month);
  const last = days.at(-1)!;
  const rec = recordOn(hr, person, last);
  const office = String(rec.office ?? "Home Office");
  const problems: string[] = [];
  const work = WORK_WEEK[office] ?? WORK_WEEK["Home Office"];
  const workdays = days.filter((d) => work.includes(weekday(d)));
  const start = String(rec.startDate ?? days[0]);
  const sep = hr.people[person]?.separated?.effective ?? null;
  const employedDays = workdays.filter((d) => d >= start && (!sep || d <= sep));
  const employed = workdays.length ? employedDays.length / workdays.length : 0;
  if (employed < 1) problems.push(`Employed ${employedDays.length} of ${workdays.length} working days this month; pay is prorated.`);

  const payBasis = String(rec.payBasis ?? "Month");
  const rate = num(rec.pay);
  const currency = String(rec.currency ?? "USD");
  if (!rate) problems.push("No pay rate in the record.");

  const approved = sheet?.status === "approved" ? sheet : undefined;
  if (!sheet) problems.push("No timesheet for this month.");
  else if (sheet.status !== "approved") problems.push(sheet.status === "returned" ? "Timesheet sent back, not yet corrected." : "Timesheet not yet approved.");
  const split = approved ? splitOf(approved.sheet, office) : null;
  const hoursWorked = split ? split.directTotal + split.leaveTotal : 0;
  const daysWorked = hoursWorked / HOURS_PER_DAY;

  const dailyRate = payBasis === "Month" ? rate / AVERAGE_DAYS : payBasis === "Day" ? rate : rate * HOURS_PER_DAY;
  const regular = r2(payBasis === "Month" ? rate * employed : payBasis === "Day" ? rate * daysWorked : rate * hoursWorked);
  if (payBasis !== "Month" && !approved) problems.push(`Paid per ${payBasis.toLowerCase()}: no approved hours, so no regular pay yet.`);
  const dangerDays = split?.allowanceDays.dangerPay ?? 0;
  const postDiffDays = split?.allowanceDays.postDiff ?? 0;
  const dangerPay = r2(dailyRate * dangerDays * (num(rec.dangerPay) / 100));
  const postDiff = r2(dailyRate * postDiffDays * (num(rec.postDiff) / 100));
  if (dangerDays && !num(rec.dangerPay)) problems.push(`${dangerDays} danger pay days on the timesheet, but no danger pay rate in the record.`);
  if (postDiffDays && !num(rec.postDiff)) problems.push(`${postDiffDays} post differential days on the timesheet, but no rate in the record.`);
  const comms = r2(num(rec.commsAllowance) * employed);
  const living = r2(num(rec.livingAllowance) * employed);
  const a = (k: AdjustmentKey) => r2(num(adj[k]));
  const [bonus, retro, vacationPayout, medicalReimb, advance] = ADJUSTMENT_KEYS.map(a);
  const expenses = r2(exp?.total ?? 0);

  const gross = r2(regular + dangerPay + postDiff + comms + living + medicalReimb + vacationPayout + bonus + retro + expenses);
  const retirementBase = r2(regular + dangerPay + postDiff + comms + living + medicalReimb + bonus + retro);
  const ee403b = down2(retirementBase * (num(rec.retirementPct) / 100));
  const er403b = down2(ee403b * EMPLOYER_MATCH);
  // The Afghan schedule is in afghani: it applies to afghani pay only.
  const tax = office === "Afghanistan" && currency === "AFN" ? afghanTax(gross - expenses) : 0;
  if (office === "Afghanistan" && currency !== "AFN") problems.push(`Paid in ${currency}: Afghan salary tax is not worked out here. Finance to confirm the tax for this person.`);
  const net = r2(gross - advance - ee403b - tax);

  if (office === "Home Office" && !rec.adpId) problems.push("No ADP employee ID in the record.");
  if (office === "Afghanistan" && !rec.bankAccount) problems.push("No bank account in the record.");

  const pct = split?.pct ?? {};
  const cost = costOf(pct, r2(gross - expenses + er403b), exp?.bySource);
  if (!Object.keys(pct).length && gross) problems.push("No approved timesheet split: cost charged to non-contract for now.");

  return {
    person,
    name: String(rec.name ?? person),
    title: String(rec.title ?? ""),
    office,
    currency,
    payBasis,
    rate,
    adpId: rec.adpId ? String(rec.adpId) : null,
    bankAccount: rec.bankAccount ? String(rec.bankAccount) : null,
    employed: Math.round(employed * 10000) / 10000,
    daysWorked,
    hoursWorked,
    dailyRate: r2(dailyRate),
    regular,
    dangerDays,
    dangerPay,
    postDiffDays,
    postDiff,
    comms,
    living,
    bonus,
    retro,
    vacationPayout,
    medicalReimb,
    expenses,
    advance,
    gross,
    retirementBase,
    ee403b,
    er403b,
    tax,
    net,
    cost,
    pct,
    timesheet: sheet?.n ?? null,
    expenseReports: exp?.reports ?? [],
    expenseBySource: exp?.bySource ?? {},
    note: adj.note?.trim() || null,
    problems,
  };
}

/** Pay is shared by the timesheet split; expenses go to the funding source on each expense line. */
function costOf(pct: Record<string, number>, pay: number, expenses?: Record<string, number>) {
  const cost: Record<string, number> = Object.keys(pct).length ? apportion(pct, pay, 0.01) : pay ? { "non-contract": pay } : {};
  for (const [s, v] of Object.entries(expenses ?? {})) cost[s] = r2((cost[s] ?? 0) + v);
  return cost;
}

export function register(
  hr: HrState,
  sheets: Timesheet[],
  group: Group,
  month: string,
  adjustments: Record<string, Adjustment> = {},
  supplemental = false,
  expenses: Record<string, Expenses> = {},
): Line[] {
  const inGroup = new Set(inPayroll(hr, group, month));
  const people = supplemental ? [...new Set([...Object.keys(adjustments), ...Object.keys(expenses)])].filter((id) => inGroup.has(id) || hr.people[id]) : [...inGroup];
  return people
    .map((id) => {
      const sheet = sheets.find((t) => t.person === id && t.month === month);
      const line = lineFor(hr, id, month, sheet, adjustments[id], expenses[id]);
      // A supplemental payroll pays only the adjustments; regular pay went in the first one.
      if (!supplemental) return line;
      return recalc({ ...line, regular: 0, dangerPay: 0, postDiff: 0, comms: 0, living: 0, problems: line.problems.filter((x) => !x.startsWith("Timesheet") && !x.startsWith("No timesheet")) });
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Totals again after amounts were zeroed (supplemental payroll). */
function recalc(l: Line): Line {
  const gross = r2(l.regular + l.dangerPay + l.postDiff + l.comms + l.living + l.medicalReimb + l.vacationPayout + l.bonus + l.retro + l.expenses);
  const retirementBase = r2(l.regular + l.dangerPay + l.postDiff + l.comms + l.living + l.medicalReimb + l.bonus + l.retro);
  const pctRet = l.retirementBase ? l.ee403b / l.retirementBase : 0;
  const ee403b = down2(retirementBase * pctRet);
  const er403b = down2(ee403b * EMPLOYER_MATCH);
  const tax = l.office === "Afghanistan" && l.currency === "AFN" ? afghanTax(gross - l.expenses) : 0;
  const cost = costOf(l.pct, r2(gross - l.expenses + er403b), l.expenseBySource);
  return { ...l, gross, retirementBase, ee403b, er403b, tax, net: r2(gross - l.advance - ee403b - tax), cost };
}

export type Totals = { gross: number; net: number; ee403b: number; er403b: number; tax: number; advance: number; expenses: number; cost: Record<string, number> };
export function totals(lines: Line[]): Totals {
  const t: Totals = { gross: 0, net: 0, ee403b: 0, er403b: 0, tax: 0, advance: 0, expenses: 0, cost: {} };
  for (const l of lines) {
    for (const k of ["gross", "net", "ee403b", "er403b", "tax", "advance", "expenses"] as const) t[k] = r2(t[k] + l[k]);
    for (const [s, v] of Object.entries(l.cost)) t.cost[s] = r2((t.cost[s] ?? 0) + v);
  }
  return t;
}

/** Differences between a run as approved and the same run worked out again now. */
export function differences(stored: Line[], now: Line[]): string[] {
  const out: string[] = [];
  const fields = ["regular", "dangerPay", "postDiff", "comms", "living", "gross", "ee403b", "er403b", "tax", "net"] as const;
  for (const s of stored) {
    const n = now.find((x) => x.person === s.person);
    if (!n) {
      out.push(`${s.name}: no longer in this payroll.`);
      continue;
    }
    const changed = fields.filter((f) => Math.abs((s[f] ?? 0) - (n[f] ?? 0)) > 0.005);
    if (changed.length) out.push(`${s.name}: ${changed.map((f) => `${f} ${s[f]} → ${n[f]}`).join(", ")}.`);
    else {
      const keys = new Set([...Object.keys(s.cost), ...Object.keys(n.cost)]);
      if ([...keys].some((k) => Math.abs((s.cost[k] ?? 0) - (n.cost[k] ?? 0)) > 0.005)) out.push(`${s.name}: the funding split changed (a revised timesheet), so costs are charged differently.`);
    }
  }
  for (const n of now) if (!stored.some((s) => s.person === n.person)) out.push(`${n.name}: now in this payroll but not in the run.`);
  return out;
}

/* ---------------- Files ---------------- */

const csv = (rows: (string | number | null)[][]) =>
  rows.map((r) => r.map((c) => (c == null ? "" : /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(",")).join("\r\n") + "\r\n";

/**
 * For ADP RUN: one row per earning per employee. The columns, their headings and the earning
 * codes are a Payroll setting (RunLayout), so ROP's RUN import template is matched in the app
 * when Finance supplies it, without a code change. Until then the draft layout below is used and
 * every file says it is a draft.
 */
export const RUN_EARNINGS = ["regular", "dangerPay", "postDiff", "comms", "living", "medicalReimb", "vacationPayout", "bonus", "retro", "expenses", "advance"] as const;
export type RunEarning = (typeof RUN_EARNINGS)[number];
export const RUN_EARNING_LABEL: Record<RunEarning, string> = { regular: "Regular pay", dangerPay: "Danger pay", postDiff: "Post differential", comms: "Communications", living: "Living allowance", medicalReimb: "Medical reimbursement", vacationPayout: "Vacation payout", bonus: "Bonus", retro: "Retro pay", expenses: "Expense reimbursement", advance: "Advance repayment (deduction)" };
export const RUN_COLUMNS = ["companyCode", "employeeId", "name", "earningCode", "hours", "rate", "amount", "payDate", "memo"] as const;
export type RunColumn = (typeof RUN_COLUMNS)[number];
export const RUN_COLUMN_LABEL: Record<RunColumn, string> = { companyCode: "Company code", employeeId: "Employee ID (ADP file number)", name: "Employee name", earningCode: "Earning code", hours: "Hours (hourly staff)", rate: "Rate", amount: "Amount", payDate: "Pay date", memo: "Memo" };
export type RunLayout = { columns: { key: RunColumn; heading: string }[]; codes: Record<RunEarning, string>; companyCode: string; dateFormat: "MM/DD/YYYY" | "YYYY-MM-DD"; confirmed: boolean; source: string };
export const DRAFT_RUN_LAYOUT: RunLayout = {
  columns: [
    { key: "employeeId", heading: "Employee ID" },
    { key: "name", heading: "Employee name" },
    { key: "earningCode", heading: "Earning code" },
    { key: "hours", heading: "Hours" },
    { key: "amount", heading: "Amount" },
  ],
  codes: { regular: "REG", dangerPay: "DANGER", postDiff: "POSTDIFF", comms: "COMMS", living: "LIVING", medicalReimb: "MEDREIMB", vacationPayout: "VACPAY", bonus: "BONUS", retro: "RETRO", expenses: "EXPREIMB", advance: "ADVANCE" },
  companyCode: "",
  dateFormat: "MM/DD/YYYY",
  confirmed: false,
  source: "Draft: replace with ROP's ADP RUN import template from Finance",
};
export const runLayoutSchema = z.object({
  columns: z.array(z.object({ key: z.enum(RUN_COLUMNS), heading: z.string().trim().min(1).max(60) })).min(3).max(RUN_COLUMNS.length),
  codes: z.object(Object.fromEntries(RUN_EARNINGS.map((k) => [k, z.string().trim().min(1).max(20)])) as Record<RunEarning, z.ZodString>),
  companyCode: z.string().trim().max(20),
  dateFormat: z.enum(["MM/DD/YYYY", "YYYY-MM-DD"]),
  confirmed: z.boolean(),
  source: z.string().trim().min(3).max(300),
});
/** Kept for screens that list the codes. */
export const RUN_CODES: [keyof Line, string][] = RUN_EARNINGS.map((k) => [k, DRAFT_RUN_LAYOUT.codes[k]]);

export function runFile(lines: Line[], layout: RunLayout = DRAFT_RUN_LAYOUT, payDate = "") {
  const date = payDate && layout.dateFormat === "MM/DD/YYYY" ? `${payDate.slice(5, 7)}/${payDate.slice(8, 10)}/${payDate.slice(0, 4)}` : payDate;
  const rows: (string | number | null)[][] = [layout.columns.map((c) => c.heading)];
  for (const l of lines.filter((x) => x.office === "Home Office"))
    for (const k of RUN_EARNINGS) {
      const v = l[k] as number;
      if (!v) continue;
      const cell: Record<RunColumn, string | number | null> = {
        companyCode: layout.companyCode,
        employeeId: l.adpId,
        name: l.name,
        earningCode: layout.codes[k],
        hours: k === "regular" && l.payBasis === "Hour" ? l.hoursWorked : null,
        rate: k === "regular" && l.payBasis === "Hour" ? l.rate : null,
        amount: v.toFixed(2),
        payDate: date,
        memo: RUN_EARNING_LABEL[k],
      };
      rows.push(layout.columns.map((c) => cell[c.key]));
    }
  return csv(rows);
}

/** Bank transfers, each in the currency the person is paid in (afghani rounded to whole afghani). */
export function bankFile(lines: Line[], month: string) {
  return csv([["Name", "Bank account", "Amount", "Currency", "Reference"], ...lines.filter((l) => l.net > 0).map((l) => [l.name, l.bankAccount, l.currency === "AFN" ? Math.round(l.net) : l.net.toFixed(2), l.currency, `ROP salary ${month}`])]);
}

export function registerFile(lines: Line[], sourceLabel: (s: string) => string) {
  const sources = [...new Set(lines.flatMap((l) => Object.keys(l.cost)))].sort();
  const head = ["Name", "Title", "Currency", "Paid per", "Rate", "Regular", "Danger pay", "Post diff", "Comms", "Living", "Medical reimb.", "Vacation payout", "Bonus", "Retro", "Expenses", "Gross", "403(b) EE", "403(b) ER", "Tax withheld", "Advance", "Net", ...sources.map((s) => `Cost: ${sourceLabel(s)}`), "Note"];
  return csv([head, ...lines.map((l) => [l.name, l.title, l.currency, l.payBasis, l.rate, l.regular, l.dangerPay, l.postDiff, l.comms, l.living, l.medicalReimb, l.vacationPayout, l.bonus, l.retro, l.expenses, l.gross, l.ee403b, l.er403b, l.tax, l.advance, l.net, ...sources.map((s) => l.cost[s] ?? 0), l.note])]);
}
