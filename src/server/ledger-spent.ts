import { sql } from "drizzle-orm";
import { db } from "@/db";
import { USD_PER } from "@/lib/procurement-plan";
import { oncePerRequest } from "@/server/request-memo";

/**
 * Spent per budget line, read from the grant ledger (posted expense lines on the project's budget
 * lines). Every page that showed `budget_lines.spent`, or the spending import's actuals, reads this
 * first: the budget, the monthly review, the overspend checks, the quarterly and period reports.
 *
 * FALLBACK, on purpose: a project with no posted spending in the ledger yet (not migrated: its
 * spending only came from Finance's workbook into `budget_lines.spent`) gets `null`, and the caller
 * keeps reading what it read before. So an existing project never drops to zero spent. The same
 * happens while the ledger tables do not exist (migration 0027 not applied) and when a line's
 * spending cannot be put in the budget line's currency (see `inLineCurrency`).
 *
 * Amounts are in each budget line's own currency, so they compare with its budget as before.
 */

export type LedgerSpent = {
  /** Spent to date per budget line code, in the line's currency. Lines with no spending are absent. */
  byCode: Record<string, number>;
  /** Spent per budget line code per month ("2026-10"), by the entry's period. */
  monthsByCode: Record<string, Record<string, number>>;
  /** Every month with posted spending, sorted. */
  months: string[];
};

type Exec = Pick<typeof db, "execute">;

/** Rows from db.execute on either driver (postgres-js returns an array; PGlite returns { rows }). */
function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}

// Whether migration 0027 is in this database. Kept once found; a "no" is asked again after a minute.
let tables: { ok: boolean; at: number } | null = null;
export async function ledgerTablesExist(exec: Exec = db): Promise<boolean> {
  if (tables && (tables.ok || Date.now() - tables.at < 60_000)) return tables.ok;
  const [row] = rowsOf<{ ok: boolean }>(await exec.execute(sql`SELECT to_regclass('public.journal_lines') IS NOT NULL AS ok`));
  tables = { ok: !!row?.ok, at: Date.now() };
  return tables.ok;
}

/**
 * Whether any journal line (draft or posted) is tagged with one of these donors or budget lines. The
 * books keep those tags for ever (migration 0027's foreign keys refuse the delete), so a screen that
 * removes a donor or a budget line asks first and answers in plain words instead of failing.
 */
export async function ledgerUses(ids: { donorIds?: string[]; budgetLineIds?: string[] }, exec: Exec = db): Promise<boolean> {
  const donors = ids.donorIds ?? [];
  const lines = ids.budgetLineIds ?? [];
  if (!donors.length && !lines.length) return false;
  if (!(await ledgerTablesExist(exec))) return false;
  const list = (xs: string[]) => sql.join(xs.map((x) => sql`${x}::uuid`), sql`, `);
  const cond = [donors.length ? sql`donor_id IN (${list(donors)})` : null, lines.length ? sql`budget_line_id IN (${list(lines)})` : null].filter((c) => c !== null);
  const [row] = rowsOf<{ ok: number }>(await exec.execute(sql`SELECT 1 AS ok FROM journal_lines WHERE ${sql.join(cond, sql` OR `)} LIMIT 1`));
  return !!row;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One ledger line group in the budget line's currency: the line's own amount when it is in that
 * currency; the functional amount when the budget is in the functional currency; otherwise the
 * functional amount (USD) at the app's existing rate (lib/procurement-plan USD_PER, AFN_PER_USD).
 * Null when none of these applies.
 */
export function inLineCurrency(r: { lineCurrency: string; budgetCurrency: string; amount: number; functional: number }, functionalCurrency: string): number | null {
  if (r.lineCurrency === r.budgetCurrency) return r.amount;
  if (r.budgetCurrency === functionalCurrency) return r.functional;
  if (functionalCurrency === "USD" && USD_PER[r.budgetCurrency]) return r.functional / USD_PER[r.budgetCurrency];
  return null;
}

/**
 * The project_state key that says a project's books are kept in the app: set when the demo books are
 * seeded and when the expenditure CLI posts a project's spending with --apply. Kept as a record of
 * when and why. Since decision AQ (25 Nov 2026) the pages read the books as soon as anything is
 * posted on a project, whether or not this is set: a real project's spending to date must be loaded
 * into the books before then, or "spent" shows only what was posted in the app.
 */
export const BOOKS_KEY = "books";

/** Marks a project's books as kept in the app (see BOOKS_KEY). Idempotent. */
export async function markBooksKept(projectId: string, why: string, exec: Exec = db) {
  await exec.execute(sql`INSERT INTO project_state (project_id, key, data) VALUES (${projectId}, ${BOOKS_KEY}, ${JSON.stringify({ source: "ledger", why, since: new Date().toISOString() })}::jsonb)
    ON CONFLICT (project_id, key) DO NOTHING`);
}

async function read(projectId: string, exec: Exec): Promise<LedgerSpent | null> {
  if (!(await ledgerTablesExist(exec))) return null;
  const rows = rowsOf<{ code: string; budget_currency: string; month: string; currency: string; amount: string; functional: string; org: string }>(
    await exec.execute(sql`
      SELECT bl.code, bl.currency AS budget_currency, to_char(e.period, 'YYYY-MM') AS month, l.currency, e.organization_id AS org,
             (sum(l.debit) - sum(l.credit))::text AS amount,
             (sum(l.functional_debit) - sum(l.functional_credit))::text AS functional
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      JOIN ledger_accounts a ON a.id = l.account_id
      JOIN budget_lines bl ON bl.id = l.budget_line_id
      WHERE e.status = 'posted' AND a.type = 'expense' AND bl.project_id = ${projectId}
      GROUP BY bl.code, bl.currency, month, l.currency, e.organization_id`),
  );
  // Not migrated yet: no posted spending on this project's budget lines.
  if (!rows.length) return null;
  let functional: string | null = null;
  if (rows.some((r) => r.currency !== r.budget_currency)) {
    const doc = rowsOf<{ c: string | null }>(await exec.execute(sql`SELECT data->>'functionalCurrency' AS c FROM organization_state WHERE organization_id = ${rows[0].org} AND key = 'ledger' LIMIT 1`));
    // server/ledger DEFAULT_FUNCTIONAL_CURRENCY: books in US dollars unless set otherwise.
    functional = doc[0]?.c ?? "USD";
  }
  const byCode: Record<string, number> = {};
  const monthsByCode: Record<string, Record<string, number>> = {};
  const months = new Set<string>();
  for (const r of rows) {
    const v = inLineCurrency({ lineCurrency: r.currency, budgetCurrency: r.budget_currency, amount: Number(r.amount), functional: Number(r.functional) }, functional ?? "USD");
    // A currency the app has no rate for: read the old figures for the whole project rather than a wrong one.
    if (v === null) return null;
    byCode[r.code] = round2((byCode[r.code] ?? 0) + v);
    monthsByCode[r.code] ??= {};
    monthsByCode[r.code][r.month] = round2((monthsByCode[r.code][r.month] ?? 0) + v);
    months.add(r.month);
  }
  return { byCode, monthsByCode, months: [...months].sort() };
}

/**
 * The project's spent per budget line from the ledger, or null when it has none yet (fall back to
 * `budget_lines.spent` or the import). Pass the transaction when called inside one. Read once per
 * read-only request.
 */
export function ledgerSpent(projectId: string, exec?: Exec): Promise<LedgerSpent | null> {
  if (exec) return read(projectId, exec);
  return oncePerRequest(`ledger-spent:${projectId}`, () => read(projectId, db));
}

/** Sum of a line's months from `from` to `to` ("YYYY-MM", both included). */
export function spentBetween(months: Record<string, number> | undefined, from: string, to: string): number {
  return round2(Object.entries(months ?? {}).reduce((t, [m, v]) => (m >= from && m <= to ? t + v : t), 0));
}
