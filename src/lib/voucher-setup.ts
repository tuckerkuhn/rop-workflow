import { z } from "zod";

/**
 * Voucher coding set once in project setup (the CFO's rule, November 2026): the contract, the
 * account the project pays from, the account withheld tax is held in, and for each budget line its
 * donor budget code and location. Finance then picks only the GL account and department on each
 * voucher. A voucher copies these when it is coded, so a later change here does not rewrite it.
 */

export const VOUCHER_SETUP_KEY = "voucher-coding";

const code = z.string().trim().max(120);
export const voucherSetupSchema = z.object({
  contract: code,
  bankGl: code,
  taxGl: code,
  /** The location used for any line without its own. */
  location: code,
  lines: z.record(z.string().max(40), z.object({ budgetCode: code.optional(), location: code.optional() })),
});
export type VoucherSetup = z.infer<typeof voucherSetupSchema>;
export const EMPTY_VOUCHER_SETUP: VoucherSetup = { contract: "", bankGl: "", taxGl: "", location: "", lines: {} };

/** The coding a new voucher on this budget line starts from. The budget code falls back to the line's own code. */
export function codingFor(setup: VoucherSetup | null | undefined, budgetLine: string) {
  const s = setup ?? EMPTY_VOUCHER_SETUP;
  const line = s.lines[budgetLine] ?? {};
  return {
    contract: s.contract,
    bankGl: s.bankGl,
    taxGl: s.taxGl,
    budgetCode: line.budgetCode?.trim() || budgetLine,
    location: line.location?.trim() || s.location,
  };
}
