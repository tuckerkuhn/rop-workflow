/**
 * What Record a payment refuses or asks about before it writes to the books (review round 1,
 * ISS-02; Q3 audit findings 5 and 6).
 *
 * A purchase is paid from its own Pay step or an approved bill, which check the invoice, the
 * goods received, the tax to withhold, the supplier's screening and the bank details. Record a
 * payment checks none of those, so it must not become the way around them:
 *
 * 1. A payment that names a purchase of this project is refused: pay it from the purchase.
 * 2. A payment on a budget line with purchases not yet closed needs a written reason why it is
 *    not one of them. The reason is kept with the entry.
 * 3. Money handed to someone other than the payee needs the payee's written authorization on file
 *    and the date the receiver was screened, no older than the re-screening period.
 *
 * Pure: the form and the project's open purchases in, a refusal or nothing out.
 */

export type OpenPurchase = { id: string; title: string; lineCode: string; supplier: string | null; usd: number };
export type ThirdParty = { receivedBy: string; authorization: { hash: string }; screenedOn: string };
export type GuardForm = { payee: string; what: string; lineCode: string; date: string; notAPurchase?: string | null; thirdParty?: ThirdParty | null };
export type Refusal = { status: 400 | 409; error: string };

/** How old a screening may be, in days, when no rule says otherwise: six months. */
export const SCREENING_DAYS = 183;
/** The shortest reason that says something. */
export const REASON_MIN = 10;

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
/** "2.2 Fertilizer" and "2.2" are the same line: its code is the first word. */
export const lineCodeOf = (line: string) => line.trim().split(/\s+/)[0] ?? "";
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/** The purchase a text names by its number ("PR-2027-011"), if any. */
export function namedPurchase(text: string, purchases: readonly { id: string }[]): string | null {
  const flat = text.toUpperCase().replace(/[^A-Z0-9]+/g, " ");
  return purchases.find((p) => p.id && ` ${flat} `.includes(` ${p.id.toUpperCase().replace(/[^A-Z0-9]+/g, " ")} `))?.id ?? null;
}

/** Wording that says the money went to someone other than the payee. */
export const saysThirdParty = (text: string) => /\b(on behalf of|c\/o|care of|for (the )?account of|collected by|received by|handed to|paid to .+ for)\b/i.test(text);

/** The purchases still open on a budget line: the ones a payment on that line could be for. */
export const openOnLine = (lineCode: string, purchases: readonly OpenPurchase[]) => purchases.filter((p) => lineCodeOf(p.lineCode) === lineCodeOf(lineCode));

export const describePurchases = (list: readonly OpenPurchase[]) => list.map((p) => `${p.id} ${p.title} (${usd(p.usd)}${p.supplier ? `, ${p.supplier}` : ""})`).join("; ");

/**
 * Null when the payment may be recorded; otherwise why not, in words a person can act on.
 * `all` is every purchase of the project (open or closed) for rule 1; `open` the ones not yet closed.
 */
export function paymentGuard(f: GuardForm, all: readonly { id: string }[], open: readonly OpenPurchase[], today: string, screeningDays = SCREENING_DAYS): Refusal | null {
  const named = namedPurchase(`${f.payee} ${f.what}`, all);
  if (named)
    return {
      status: 409,
      error: `${named} is a purchase on this project. Pay it from the purchase itself (Work, Procurement, its Pay step) or from its approved bill: those check the invoice, the goods received, the tax and the supplier's screening. Recorded here it would skip those checks and could be paid twice.`,
    };

  const tp = f.thirdParty ?? null;
  if (!tp && saysThirdParty(`${f.payee} ${f.what}`))
    return {
      status: 400,
      error: "This says the money went to someone other than the payee. Tick \"The money was handed to someone other than the payee\" and attach the payee's written authorization and the date the receiver was screened.",
    };
  if (tp) {
    if (tp.receivedBy.trim().length < 2) return { status: 400, error: "Say who received the money." };
    if (!tp.authorization?.hash) return { status: 400, error: "Attach the payee's written authorization for someone else to receive the money." };
    const age = days(tp.screenedOn, today);
    if (!Number.isFinite(age)) return { status: 400, error: "Enter the date the person who received the money was screened." };
    if (age < 0) return { status: 400, error: "The screening date is in the future. Check it." };
    if (age > screeningDays) return { status: 400, error: `The person who received the money was screened ${age} days ago. Screen them again first: a screening counts for ${screeningDays} days.` };
  }

  const same = openOnLine(f.lineCode, open);
  if (same.length && (f.notAPurchase ?? "").trim().length < REASON_MIN)
    return {
      status: 409,
      error: `This budget line has ${same.length === 1 ? "a purchase" : "purchases"} not yet closed: ${describePurchases(same)}. If this payment is for ${same.length === 1 ? "it" : "one of them"}, pay it from the purchase. If it is not, say what it is for instead.`,
    };
  return null;
}
