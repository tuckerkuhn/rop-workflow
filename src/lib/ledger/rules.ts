/**
 * The accounting rules: each action a person takes (pay for something, receive donor money, undo
 * an entry) turned into journal lines. Pure functions, no database: server/ledger writes what these
 * return, and the database checks it again (migration 0027).
 *
 * Money is handled in whole cents as BigInt, never as floating point numbers, and leaves here as
 * decimal strings ("1234.50") for the numeric columns. Rates have at most 8 decimals and mean "one
 * unit of the line's currency is worth this much of the functional currency".
 */

export type EntryKind = "payment" | "donor_receipt" | "reversal";
export const ENTRY_KINDS: EntryKind[] = ["payment", "donor_receipt", "reversal"];

export type LedgerLine = {
  accountId: string;
  /** In the line's own currency. One of debit and credit is "0.00". */
  debit: string;
  credit: string;
  currency: string;
  fxRate: string;
  /** In the organization's functional currency (USD unless set otherwise). */
  functionalDebit: string;
  functionalCredit: string;
  donorId: string | null;
  projectId: string | null;
  budgetLineId: string | null;
  memo: string | null;
};

export type EntryDraft = {
  kind: EntryKind;
  /** YYYY-MM-DD */
  entryDate: string;
  /** First day of the entry's month: the period it falls in. */
  period: string;
  memo: string;
  projectId: string | null;
  reversesId: string | null;
  lines: LedgerLine[];
};

/** A rule was not followed: the message is plain words for the person. */
export class LedgerRuleError extends Error {}

/**
 * How amounts in another currency become functional amounts, said once so the screen can show it.
 */
export const BALANCING_RULE =
  "The bank or cash side is converted once: the amount times the rate, rounded to the cent (half a cent rounds up). The other lines share that exact figure in proportion to their amounts; a cent left over by rounding goes to the line with the largest remainder. So the two sides of every entry are always equal.";

/* ---------------- Money ---------------- */

const AMOUNT = /^(\d{1,14})(?:\.(\d{1,2}))?$/;
const RATE = /^(\d{1,10})(?:\.(\d{1,8}))?$/;
const RATE_SCALE = BigInt(100_000_000);

/** "1234.5" or 1234.5 → BigInt(123450). Refuses fractions of a cent rather than rounding them away. */
export function toCents(v: string | number): bigint {
  const s = String(v).trim();
  const neg = s.startsWith("-");
  const m = AMOUNT.exec(neg ? s.slice(1) : s);
  if (!m) throw new LedgerRuleError(`"${s}" is not an amount in cents (at most two decimals).`);
  const c = BigInt(m[1]) * BigInt(100) + BigInt((m[2] ?? "").padEnd(2, "0"));
  return neg ? -c : c;
}

export function fromCents(c: bigint): string {
  const neg = c < BigInt(0);
  const a = neg ? -c : c;
  return `${neg ? "-" : ""}${a / BigInt(100)}.${(a % BigInt(100)).toString().padStart(2, "0")}`;
}

function rate8(v: string | number): bigint {
  const s = String(v).trim();
  const m = RATE.exec(s);
  if (!m) throw new LedgerRuleError(`"${s}" is not an exchange rate (a number with at most 8 decimals).`);
  const r = BigInt(m[1]) * RATE_SCALE + BigInt((m[2] ?? "").padEnd(8, "0"));
  if (r <= BigInt(0)) throw new LedgerRuleError("The exchange rate must be more than zero.");
  return r;
}

const rateText = (r: bigint) => `${r / RATE_SCALE}.${(r % RATE_SCALE).toString().padStart(8, "0")}`;

/** n / d rounded to the nearest whole number, a half rounding away from zero. d > 0. */
function roundDiv(n: bigint, d: bigint): bigint {
  const neg = n < BigInt(0);
  const q = ((neg ? -n : n) * BigInt(2) + d) / (BigInt(2) * d);
  return neg ? -q : q;
}

/** An amount in cents times a rate, in functional cents. */
export function convertCents(cents: bigint, rate: string | number): bigint {
  return roundDiv(cents * rate8(rate), RATE_SCALE);
}

/**
 * Shares `total` cents across parts in proportion to `weights` so the shares add up to exactly
 * `total`: each part gets its share rounded down, and the cents left over go one each to the parts
 * with the largest remainders (the earlier part first on a tie).
 */
export function allocateCents(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, BigInt(0));
  if (sum <= BigInt(0) || total < BigInt(0) || weights.some((w) => w < BigInt(0))) throw new LedgerRuleError("Nothing to share the amount across.");
  const shares = weights.map((w) => (total * w) / sum);
  const remainders = weights.map((w, i) => ({ i, r: (total * w) % sum }));
  let left = total - shares.reduce((a, b) => a + b, BigInt(0));
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left <= BigInt(0)) break;
    shares[i] += BigInt(1);
    left -= BigInt(1);
  }
  return shares;
}

/** Totals of a set of lines in the functional currency. */
export function totals(lines: Pick<LedgerLine, "functionalDebit" | "functionalCredit">[]) {
  const d = lines.reduce((a, l) => a + toCents(l.functionalDebit), BigInt(0));
  const c = lines.reduce((a, l) => a + toCents(l.functionalCredit), BigInt(0));
  return { functionalDebit: fromCents(d), functionalCredit: fromCents(c), balanced: d === c && d > BigInt(0) };
}

/* ---------------- Checks ---------------- */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function periodOf(date: string): string {
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    throw new LedgerRuleError(`"${date}" is not a date (YYYY-MM-DD).`);
  return `${date.slice(0, 7)}-01`;
}

function currencyOf(c: string): string {
  const u = c.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(u)) throw new LedgerRuleError(`"${c}" is not a currency code like USD or AFN.`);
  return u;
}

/** The rate for a currency: exactly 1 for the functional currency. */
function rateFor(currency: string, fxRate: string | number, functionalCurrency: string): bigint {
  const r = rate8(fxRate);
  if (currency === currencyOf(functionalCurrency) && r !== RATE_SCALE)
    throw new LedgerRuleError(`The rate for ${currency} is 1: it is the organization's own currency.`);
  return r;
}

function positive(v: string | number, what: string): bigint {
  const c = toCents(v);
  if (c <= BigInt(0)) throw new LedgerRuleError(`The ${what} must be more than zero.`);
  return c;
}

const blankLine = { donorId: null, projectId: null, budgetLineId: null, memo: null } as const;

function debitLine(accountId: string, cents: bigint, fCents: bigint, currency: string, rate: bigint, tags: Partial<LedgerLine>): LedgerLine {
  return { ...blankLine, ...tags, accountId, debit: fromCents(cents), credit: "0.00", functionalDebit: fromCents(fCents), functionalCredit: "0.00", currency, fxRate: rateText(rate) };
}
function creditLine(accountId: string, cents: bigint, fCents: bigint, currency: string, rate: bigint, tags: Partial<LedgerLine>): LedgerLine {
  return { ...blankLine, ...tags, accountId, debit: "0.00", credit: fromCents(cents), functionalDebit: "0.00", functionalCredit: fromCents(fCents), currency, fxRate: rateText(rate) };
}

const common = <T>(xs: (T | null | undefined)[]): T | null => {
  const set = new Set(xs.map((x) => x ?? null));
  return set.size === 1 ? ([...set][0] as T | null) : null;
};

/* ---------------- Actions ---------------- */

export type PaymentInput = {
  functionalCurrency: string;
  date: string;
  memo: string;
  /** The bank or cash ledger account the money left. */
  paidFrom: string;
  currency: string;
  fxRate: string | number;
  /** What it paid for: one line per expense account and budget line. */
  expenses: { accountId: string; amount: string | number; donorId?: string | null; projectId?: string | null; budgetLineId?: string | null; memo?: string | null }[];
  projectId?: string | null;
};

/**
 * Record a payment: each expense line is debited with its donor, project and budget line; the bank
 * or cash account is credited with the total. Functional amounts follow BALANCING_RULE.
 */
export function payment(input: PaymentInput): EntryDraft {
  const period = periodOf(input.date);
  if (!input.expenses.length) throw new LedgerRuleError("Say what the payment was for.");
  const currency = currencyOf(input.currency);
  const rate = rateFor(currency, input.fxRate, input.functionalCurrency);
  const amounts = input.expenses.map((e) => positive(e.amount, "amount"));
  const total = amounts.reduce((a, b) => a + b, BigInt(0));
  const fTotal = convertCents(total, rateText(rate));
  const fShares = allocateCents(fTotal, amounts);
  const projectId = input.projectId ?? common(input.expenses.map((e) => e.projectId));
  const donorId = common(input.expenses.map((e) => e.donorId));
  const lines = input.expenses.map((e, i) =>
    debitLine(e.accountId, amounts[i], fShares[i], currency, rate, { donorId: e.donorId ?? null, projectId: e.projectId ?? projectId, budgetLineId: e.budgetLineId ?? null, memo: e.memo ?? null }),
  );
  lines.push(creditLine(input.paidFrom, total, fTotal, currency, rate, { donorId, projectId }));
  return { kind: "payment", entryDate: input.date, period, memo: input.memo.trim(), projectId, reversesId: null, lines };
}

export type DonorReceiptInput = {
  functionalCurrency: string;
  date: string;
  memo: string;
  /** The bank or cash ledger account the money arrived in. */
  depositedTo: string;
  /** The revenue account, restricted by donor (default chart: 4000 Donor grants). */
  revenueAccountId: string;
  donorId: string;
  projectId?: string | null;
  currency: string;
  fxRate: string | number;
  amount: string | number;
};

/** Record donor money received: the bank is debited and restricted revenue credited, both marked with the donor. */
export function donorReceipt(input: DonorReceiptInput): EntryDraft {
  const period = periodOf(input.date);
  if (!input.donorId) throw new LedgerRuleError("Say which donor the money came from.");
  const currency = currencyOf(input.currency);
  const rate = rateFor(currency, input.fxRate, input.functionalCurrency);
  const amount = positive(input.amount, "amount received");
  const f = convertCents(amount, rateText(rate));
  const tags = { donorId: input.donorId, projectId: input.projectId ?? null };
  return {
    kind: "donor_receipt",
    entryDate: input.date,
    period,
    memo: input.memo.trim(),
    projectId: input.projectId ?? null,
    reversesId: null,
    lines: [debitLine(input.depositedTo, amount, f, currency, rate, tags), creditLine(input.revenueAccountId, amount, f, currency, rate, tags)],
  };
}

export type ReversibleEntry = { id: string; projectId: string | null; lines: (Omit<LedgerLine, "memo"> & { memo?: string | null })[] };

/**
 * Reverse an entry: the same lines with debits and credits swapped, in the same currencies at the
 * same rates (nothing is converted again, so the two entries net to exactly zero), pointing to the
 * original. Dated when the correction is made; the original stays as it was.
 */
export function reversal(original: ReversibleEntry, at: { date: string; memo: string }): EntryDraft {
  const period = periodOf(at.date);
  if (!original.lines.length) throw new LedgerRuleError("That entry has no lines to reverse.");
  const lines: LedgerLine[] = original.lines.map((l) => ({
    accountId: l.accountId,
    debit: fromCents(toCents(l.credit)),
    credit: fromCents(toCents(l.debit)),
    functionalDebit: fromCents(toCents(l.functionalCredit)),
    functionalCredit: fromCents(toCents(l.functionalDebit)),
    currency: l.currency,
    fxRate: rateText(rate8(l.fxRate)),
    donorId: l.donorId ?? null,
    projectId: l.projectId ?? null,
    budgetLineId: l.budgetLineId ?? null,
    memo: l.memo ?? null,
  }));
  return { kind: "reversal", entryDate: at.date, period, memo: at.memo.trim(), projectId: original.projectId, reversesId: original.id, lines };
}
