import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { closingBalanceOf, guessMapping, mappingProblem, parseAmount, parseCsv, parseStatementDate, readStatement, withOccurrence } from "@/lib/ledger/statement-csv";

describe("reading a bank statement CSV", () => {
  it("splits quoted fields, commas and line breaks inside quotes, doubled quotes and CRLF", () => {
    const rows = parseCsv('﻿Date,Description,Amount\r\n2026-12-01,"Seed, fertilizer and bags",-120.50\r\n2026-12-02,"Say ""hello""\nsecond line",5\r\n\r\n');
    expect(rows).toEqual([
      ["Date", "Description", "Amount"],
      ["2026-12-01", "Seed, fertilizer and bags", "-120.50"],
      ["2026-12-02", 'Say "hello"\nsecond line', "5"],
    ]);
  });

  it("reads semicolon files", () => {
    expect(parseCsv("Fecha;Concepto;Importe\n01/12/2026;Renta;-1.200,00")).toEqual([
      ["Fecha", "Concepto", "Importe"],
      ["01/12/2026", "Renta", "-1.200,00"],
    ]);
  });

  it("reads dates written YYYY-MM-DD or DD/MM/YYYY; refuses days that do not exist", () => {
    expect(parseStatementDate("2026-12-05", "ymd")).toBe("2026-12-05");
    expect(parseStatementDate("2026-12-05 14:30", "dmy")).toBe("2026-12-05");
    expect(parseStatementDate("05/12/2026", "dmy")).toBe("2026-12-05");
    expect(parseStatementDate("5.12.2026", "dmy")).toBe("2026-12-05");
    expect(parseStatementDate("31/02/2026", "dmy")).toBeNull();
    expect(parseStatementDate("05/12/2026", "ymd")).toBeNull();
    expect(parseStatementDate("Total", "dmy")).toBeNull();
  });

  it("reads amounts with thousands, signs, brackets, currency and a decimal comma", () => {
    expect(parseAmount("1,234.50")).toBe("1234.50");
    expect(parseAmount("-50")).toBe("-50.00");
    expect(parseAmount("(75.25)")).toBe("-75.25");
    expect(parseAmount("75.25-")).toBe("-75.25");
    expect(parseAmount("USD 2,000")).toBe("2000.00");
    expect(parseAmount("$ 12.5")).toBe("12.50");
    expect(parseAmount("1.234,50")).toBe("1234.50");
    expect(parseAmount("12,5")).toBe("12.50");
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("1.234")).toBeNull();
  });

  it("guesses a single signed amount column and reads the lines", () => {
    const rows = parseCsv("Date,Description,Amount,Balance\n2026-12-01,Opening transfer,1000.00,1000.00\n2026-12-03,Seed,-250.00,750.00\n,Total,750.00,\n");
    const m = guessMapping(rows);
    expect(m).toMatchObject({ headerRow: 0, date: 0, description: 1, amount: 2, balance: 3, dateFormat: "ymd" });
    const p = readStatement(rows, m);
    expect(p.lines.map((l) => [l.date, l.amount])).toEqual([
      ["2026-12-01", "1000.00"],
      ["2026-12-03", "-250.00"],
    ]);
    expect(p.skipped).toEqual([{ row: 4, reason: "No date." }]);
    expect(p.closingBalance).toBe("750.00");
  });

  it("reads separate money in and money out columns, with lines above the header and DD/MM/YYYY dates", () => {
    const rows = parseCsv('Account,"Main bank, USD"\nStatement for December 2026\nDate,Details,Money out,Money in,Balance\n02/12/2026,Rent,"1,200.00",,3800.00\n01/12/2026,Donor tranche,,"5,000.00",5000.00\n');
    const m = guessMapping(rows);
    expect(m).toMatchObject({ headerRow: 2, date: 0, description: 1, amount: null, moneyOut: 2, moneyIn: 3, balance: 4, dateFormat: "dmy" });
    const p = readStatement(rows, m);
    expect(p.lines.map((l) => [l.date, l.description, l.amount])).toEqual([
      ["2026-12-02", "Rent", "-1200.00"],
      ["2026-12-01", "Donor tranche", "5000.00"],
    ]);
    // Newest first: the closing balance is the first line's.
    expect(p.closingBalance).toBe("3800.00");
  });

  it("says what is missing from a mapping", () => {
    expect(mappingProblem({ headerRow: 0, date: 0, description: 1, dateFormat: "ymd" }, 3)).toMatch(/amount column/);
    expect(mappingProblem({ headerRow: 0, date: 0, description: 1, amount: 2, moneyIn: 3, moneyOut: 4, dateFormat: "ymd" }, 5)).toMatch(/not both/);
    expect(mappingProblem({ headerRow: 0, date: 0, description: 1, amount: 2, dateFormat: "ymd" }, 3)).toBeNull();
  });

  it("gives two identical lines different identities and the same identities when read again", () => {
    const text = "Date,Description,Amount\n2026-12-04,Transfer to field,-100\n2026-12-04,Transfer  to field,-100\n";
    const once = withOccurrence(readStatement(parseCsv(text), guessMapping(parseCsv(text))).lines).map((x) => x.identity);
    const twice = withOccurrence(readStatement(parseCsv(text), guessMapping(parseCsv(text))).lines).map((x) => x.identity);
    expect(once).toHaveLength(2);
    expect(new Set(once).size).toBe(2);
    expect(twice).toEqual(once);
  });

  it("takes the closing balance from the latest day, whatever the order", () => {
    const l = (date: string, balance: string) => ({ row: 0, date, description: "x", amount: "1.00", balance });
    expect(closingBalanceOf([l("2026-12-01", "10.00"), l("2026-12-09", "30.00"), l("2026-12-09", "31.00")])).toBe("31.00");
    expect(closingBalanceOf([l("2026-12-09", "31.00"), l("2026-12-09", "30.00"), l("2026-12-01", "10.00")])).toBe("31.00");
    expect(closingBalanceOf([{ ...l("2026-12-01", "1"), balance: null }])).toBeNull();
  });

  it("reads the sample statement for the demo", () => {
    const text = fs.readFileSync(path.resolve(import.meta.dirname, "../../../docs/deep-dive/sample-bank-statement.csv"), "utf8");
    const rows = parseCsv(text);
    const p = readStatement(rows, guessMapping(rows));
    expect(p.skipped).toEqual([]);
    expect(p.lines.length).toBeGreaterThanOrEqual(5);
    expect(p.lines.every((l) => l.date.startsWith("2026-10"))).toBe(true);
    const sum = p.lines.reduce((a, l) => a + Math.round(Number(l.amount) * 100), 0);
    expect(p.closingBalance).toBe((sum / 100).toFixed(2));
  });
});
