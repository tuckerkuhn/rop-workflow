/**
 * The default chart of accounts every organization starts with (server/ledger seedChart). About 25
 * accounts, enough for a first institutional grant. Each choice of type and of what counts as
 * restricted is a default the accountant has not yet confirmed: see "Questions for the accountant"
 * in docs/deep-dive/09-finance.md. An organization can add accounts; codes are its own.
 */

export type AccountType = "asset" | "liability" | "net_assets" | "revenue" | "expense";
export const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "net_assets", "revenue", "expense"];

/** The kinds a budget line can have (budget_lines.kind). */
export type BudgetKind = "program" | "personnel" | "operations";
export const BUDGET_KINDS: BudgetKind[] = ["program", "personnel", "operations"];

export type ChartAccount = {
  code: string;
  name: string;
  type: AccountType;
  /** Money a donor limited to a purpose (DEFAULT, to confirm: only donor grants and the net assets they build). */
  restricted: boolean;
  /** The budget line kind whose spending this account takes by default. */
  budgetKind?: BudgetKind;
  /** Money accounts a payment can be made from or a receipt paid into. */
  money?: boolean;
};

export const DEFAULT_CHART: ChartAccount[] = [
  // Assets
  { code: "1000", name: "Cash on hand", type: "asset", restricted: false, money: true },
  { code: "1010", name: "Main bank account", type: "asset", restricted: false, money: true },
  { code: "1020", name: "Field bank account", type: "asset", restricted: false, money: true },
  { code: "1100", name: "Grants receivable", type: "asset", restricted: false },
  { code: "1200", name: "Staff advances", type: "asset", restricted: false },
  { code: "1300", name: "Prepaid expenses", type: "asset", restricted: false },
  { code: "1500", name: "Equipment", type: "asset", restricted: false },
  // Liabilities
  { code: "2000", name: "Bills to pay", type: "liability", restricted: false },
  { code: "2100", name: "Salaries to pay", type: "liability", restricted: false },
  { code: "2200", name: "Taxes withheld", type: "liability", restricted: false },
  { code: "2300", name: "Donor money received but not yet earned", type: "liability", restricted: false },
  { code: "2400", name: "Owed to partners", type: "liability", restricted: false },
  // Net assets
  { code: "3000", name: "Net assets without donor restrictions", type: "net_assets", restricted: false },
  { code: "3100", name: "Net assets with donor restrictions", type: "net_assets", restricted: true },
  // Revenue
  { code: "4000", name: "Donor grants (restricted)", type: "revenue", restricted: true },
  { code: "4100", name: "Donations without restrictions", type: "revenue", restricted: false },
  { code: "4200", name: "Gifts in kind", type: "revenue", restricted: false },
  { code: "4300", name: "Interest and other income", type: "revenue", restricted: false },
  // Expenses
  { code: "5000", name: "Program costs", type: "expense", restricted: false, budgetKind: "program" },
  { code: "5100", name: "Training and events", type: "expense", restricted: false },
  { code: "5200", name: "Grants to farmers and partners", type: "expense", restricted: false },
  { code: "6000", name: "Salaries and benefits", type: "expense", restricted: false, budgetKind: "personnel" },
  { code: "6100", name: "Consultants", type: "expense", restricted: false },
  { code: "7000", name: "Office and operations", type: "expense", restricted: false, budgetKind: "operations" },
  { code: "7100", name: "Travel", type: "expense", restricted: false },
  { code: "7200", name: "Vehicles and fuel", type: "expense", restricted: false },
  { code: "7300", name: "Bank charges", type: "expense", restricted: false },
  { code: "7400", name: "Exchange differences", type: "expense", restricted: false },
];

/** The default expense account code for a budget line kind. An unknown kind is treated as program. */
export function expenseCodeForKind(kind: string): string {
  const k = (BUDGET_KINDS as string[]).includes(kind) ? kind : "program";
  return DEFAULT_CHART.find((a) => a.budgetKind === k)!.code;
}

/** The default revenue account for donor money received (restricted by donor). */
export const DONOR_REVENUE_CODE = "4000";
