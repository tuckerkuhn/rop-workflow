/**
 * Reading a bank statement exported as CSV, in plain code (no library). The page uses it to show a
 * preview with the column mapping before anything is saved; the server reads the same file again
 * with the mapping the person confirmed (server/reconciliation importStatement).
 *
 * Handles quoted fields ("" inside quotes is one quote), commas and line breaks inside quotes, a
 * byte order mark, comma, semicolon or tab separators, dates written YYYY-MM-DD or DD/MM/YYYY and
 * either one signed amount column or separate money in and money out columns. Amounts come out as
 * signed decimal strings with two decimals: positive is money in, negative money out.
 */

export type DateFormat = "ymd" | "dmy";

export type StatementMapping = {
  /** Index of the row holding the column names; the lines start on the next row. */
  headerRow: number;
  date: number;
  description: number;
  /** One signed column (positive in, negative out). Leave out when money in and out are separate. */
  amount?: number | null;
  moneyIn?: number | null;
  moneyOut?: number | null;
  /** The running balance after each line, when the bank gives one. */
  balance?: number | null;
  dateFormat: DateFormat;
};

export type StatementLine = {
  /** Row number in the file, counting from 1 like a spreadsheet. */
  row: number;
  date: string;
  description: string;
  amount: string;
  balance: string | null;
};

export type ParsedStatement = {
  lines: StatementLine[];
  /** Rows left out, with the reason in plain words. */
  skipped: { row: number; reason: string }[];
  /** The balance after the last line by date, when the file has a balance column. */
  closingBalance: string | null;
};

/** Splits CSV text into rows of cells. */
export function parseCsv(text: string, separator?: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const sep = separator ?? guessSeparator(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
    } else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

/** Comma unless the first lines plainly use semicolons or tabs. */
function guessSeparator(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join("\n");
  const count = (c: string) => head.split(c).length - 1;
  const best = [",", ";", "\t"].map((c) => [c, count(c)] as const).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ",";
}

/* ---------------- Dates and amounts ---------------- */

const pad = (n: number) => String(n).padStart(2, "0");

function realDay(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : null;
}

/** A statement date as YYYY-MM-DD, or null when it is not one. A time after the date is ignored. */
export function parseStatementDate(value: string, format: DateFormat): string | null {
  const v = value.trim().split(/[ T]/)[0];
  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
  if (ymd) return realDay(+ymd[1], +ymd[2], +ymd[3]);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
  if (dmy && format === "dmy") return realDay(+dmy[3], +dmy[2], +dmy[1]);
  return null;
}

/**
 * An amount as a signed decimal string with two decimals, or null when the cell is empty or not a
 * number. Accepts "1,234.50", "-50", "(50.00)" for a negative, "50.00-", a currency sign or code,
 * and a decimal comma ("1.234,50" or "12,5").
 */
export function parseAmount(value: string): string | null {
  let v = value.trim();
  if (!v) return null;
  let neg = false;
  if (/^\(.*\)$/.test(v)) {
    neg = true;
    v = v.slice(1, -1);
  }
  v = v.replace(/[A-Za-z$€£¥₹؋\s ']/g, "");
  if (v.endsWith("-")) {
    neg = !neg;
    v = v.slice(0, -1);
  }
  if (v.startsWith("-")) {
    neg = !neg;
    v = v.slice(1);
  } else if (v.startsWith("+")) v = v.slice(1);
  if (!v || !/^[\d.,]+$/.test(v)) return null;
  const lastDot = v.lastIndexOf(".");
  const lastComma = v.lastIndexOf(",");
  let whole: string;
  let frac = "";
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const at = v.lastIndexOf(dec);
    whole = v.slice(0, at).replace(/[.,]/g, "");
    frac = v.slice(at + 1);
  } else if (lastComma >= 0) {
    // "1,234" and "1,234,567" are thousands; "12,5" and "12,50" are a decimal comma.
    const parts = v.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      whole = parts[0];
      frac = parts[1];
    } else whole = parts.join("");
  } else if (lastDot >= 0) {
    const parts = v.split(".");
    if (parts.length > 2) whole = parts.join("");
    else {
      whole = parts[0];
      frac = parts[1];
    }
  } else whole = v;
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac) || (!whole && !frac)) return null;
  if (frac.length > 2) {
    if (/^0+$/.test(frac.slice(2))) frac = frac.slice(0, 2);
    else return null;
  }
  const cents = BigInt(whole || "0") * BigInt(100) + BigInt(frac.padEnd(2, "0") || "0");
  if (cents === BigInt(0)) return "0.00";
  const out = `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
  return neg ? `-${out}` : out;
}

/* ---------------- Mapping ---------------- */

const RX = {
  date: /date|fecha|day|posted|value/i,
  description: /desc|detail|narrat|memo|particular|concept|payee|reference|transaction|text/i,
  amount: /amount|monto|importe|value|sum/i,
  moneyIn: /credit|money ?in|paid ?in|deposit|in$|cr$|ingreso|abono/i,
  moneyOut: /debit|money ?out|paid ?out|withdraw|out$|dr$|egreso|cargo|retiro/i,
  balance: /balance|saldo/i,
};

/** The row holding the column names: the first with a cell that says "date", or the first row. */
export function guessHeaderRow(rows: string[][]): number {
  const i = rows.slice(0, 20).findIndex((r) => r.some((c) => /^(date|fecha|transaction date|posting date|value date)$/i.test(c) || /\bdate\b/i.test(c)));
  return i >= 0 ? i : 0;
}

/** A first guess at which column is which, for the person to confirm or change. */
export function guessMapping(rows: string[][]): StatementMapping {
  const headerRow = guessHeaderRow(rows);
  const head = rows[headerRow] ?? [];
  const find = (rx: RegExp, not: number[] = []) => head.findIndex((h, i) => !not.includes(i) && rx.test(h));
  const date = find(RX.date);
  const balance = find(RX.balance, [date]);
  const moneyIn = find(RX.moneyIn, [date, balance]);
  const moneyOut = find(RX.moneyOut, [date, balance, moneyIn]);
  const split = moneyIn >= 0 && moneyOut >= 0;
  const amount = split ? -1 : find(RX.amount, [date, balance]);
  let description = find(RX.description, [date, balance, amount, moneyIn, moneyOut]);
  if (description < 0) description = head.findIndex((_, i) => ![date, balance, amount, moneyIn, moneyOut].includes(i));
  const body = rows.slice(headerRow + 1);
  const dateCells = date >= 0 ? body.map((r) => r[date] ?? "").filter(Boolean) : [];
  return {
    headerRow,
    date: Math.max(date, 0),
    description: Math.max(description, 0),
    amount: split ? null : amount >= 0 ? amount : null,
    moneyIn: split ? moneyIn : null,
    moneyOut: split ? moneyOut : null,
    balance: balance >= 0 ? balance : null,
    dateFormat: guessDateFormat(dateCells),
  };
}

/** YYYY-MM-DD when the dates start with a four-digit year, otherwise DD/MM/YYYY. */
export function guessDateFormat(cells: string[]): DateFormat {
  const sample = cells.slice(0, 30);
  return sample.length && sample.every((c) => /^\d{4}[-/.]/.test(c.trim())) ? "ymd" : "dmy";
}

/** What is wrong with a mapping, in plain words, or null when it can be used. */
export function mappingProblem(m: StatementMapping, columns: number): string | null {
  const ok = (i: number | null | undefined) => typeof i === "number" && i >= 0 && i < columns;
  if (!ok(m.date)) return "Choose the column with the date.";
  if (!ok(m.description)) return "Choose the column with the description.";
  const single = ok(m.amount);
  const split = ok(m.moneyIn) && ok(m.moneyOut);
  if (!single && !split) return "Choose the amount column, or both the money in and money out columns.";
  if (single && split) return "Use either one amount column or separate money in and money out columns, not both.";
  return null;
}

/* ---------------- Reading the lines ---------------- */

const toCents = (v: string) => {
  const neg = v.startsWith("-");
  const [w, f = "0"] = (neg ? v.slice(1) : v).split(".");
  const c = BigInt(w) * BigInt(100) + BigInt(f.padEnd(2, "0"));
  return neg ? -c : c;
};
const fromCents = (c: bigint) => {
  const neg = c < BigInt(0);
  const a = neg ? -c : c;
  return `${neg ? "-" : ""}${a / BigInt(100)}.${(a % BigInt(100)).toString().padStart(2, "0")}`;
};

/** The statement's lines under a mapping. Rows without a date or an amount (totals, notes) are left out and listed. */
export function readStatement(rows: string[][], m: StatementMapping): ParsedStatement {
  const problem = mappingProblem(m, Math.max(0, ...rows.map((r) => r.length)));
  if (problem) throw new Error(problem);
  const lines: StatementLine[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const split = typeof m.amount !== "number" || m.amount < 0;
  for (let i = m.headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const row = i + 1;
    const rawDate = r[m.date] ?? "";
    const date = parseStatementDate(rawDate, m.dateFormat);
    if (!date) {
      skipped.push({ row, reason: rawDate ? `"${rawDate}" is not a date in the format chosen.` : "No date." });
      continue;
    }
    let amount: string | null;
    if (split) {
      const inn = parseAmount(r[m.moneyIn!] ?? "");
      const out = parseAmount(r[m.moneyOut!] ?? "");
      const badIn = (r[m.moneyIn!] ?? "").trim() !== "" && inn === null;
      const badOut = (r[m.moneyOut!] ?? "").trim() !== "" && out === null;
      if (badIn || badOut) {
        skipped.push({ row, reason: `"${badIn ? r[m.moneyIn!] : r[m.moneyOut!]}" is not an amount.` });
        continue;
      }
      // Money out is shown positive by most banks; a minus sign there still means money out.
      const c = (inn ? (toCents(inn) < 0 ? -toCents(inn) : toCents(inn)) : BigInt(0)) - (out ? (toCents(out) < 0 ? -toCents(out) : toCents(out)) : BigInt(0));
      amount = fromCents(c);
    } else {
      amount = parseAmount(r[m.amount!] ?? "");
      if (amount === null) {
        skipped.push({ row, reason: (r[m.amount!] ?? "").trim() ? `"${r[m.amount!]}" is not an amount.` : "No amount." });
        continue;
      }
    }
    if (toCents(amount) === BigInt(0)) {
      skipped.push({ row, reason: "The amount is zero." });
      continue;
    }
    const balance = typeof m.balance === "number" && m.balance >= 0 ? parseAmount(r[m.balance] ?? "") : null;
    lines.push({ row, date, description: (r[m.description] ?? "").replace(/\s+/g, " ").trim() || "(no description)", amount, balance });
  }
  return { lines, skipped, closingBalance: closingBalanceOf(lines) };
}

/**
 * The balance after the latest line. Banks list oldest first or newest first: the order of the
 * first and last dates says which. Within the latest day the line last in time order wins.
 */
export function closingBalanceOf(lines: StatementLine[]): string | null {
  const withBalance = lines.filter((l) => l.balance !== null);
  if (!withBalance.length) return null;
  const newestFirst = withBalance.length > 1 && withBalance[0].date > withBalance[withBalance.length - 1].date;
  const ordered = newestFirst ? [...withBalance].reverse() : withBalance;
  let best = ordered[0];
  for (const l of ordered) if (l.date >= best.date) best = l;
  return best.balance;
}

/** Text that identifies a line for its import key: the same line read twice gives the same text. */
export function lineIdentity(l: Pick<StatementLine, "date" | "description" | "amount">): string {
  return `${l.date}|${l.description.replace(/\s+/g, " ").trim().toLowerCase()}|${l.amount}`;
}

/**
 * Each line's identity with its running occurrence in the file: two identical lines on the same day
 * (two transfers of the same amount) stay two lines. Reading the file again gives the same keys.
 */
export function withOccurrence(lines: StatementLine[]): { line: StatementLine; identity: string }[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const id = lineIdentity(line);
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return { line, identity: `${id}|${n}` };
  });
}
