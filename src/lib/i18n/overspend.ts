/**
 * The reason a budget line is over budget, chosen from a list (lib/overspend.ts). English is the
 * source; Spanish, Dari and Pashto are drafts that need review by a native speaker before field use.
 * The report itself prints the English (it goes to the donor in English).
 */

export const osEn = {
  "os.label": "Why is this line over budget?",
  "os.choose": "Choose a reason",
  "os.reason.price": "Prices or the exchange rate came in higher than budgeted",
  "os.reason.early": "Work brought forward from a later quarter (timing only)",
  "os.reason.realign": "A realignment the donor has already approved",
  "os.reason.pending": "A realignment requested and waiting for the donor",
  "os.reason.coding": "A coding error that Finance will move to the right line",
  "os.reason.other": "Other",
  "os.note": "Note (optional): a date, an amount or the donor's letter",
  "os.noteOther": "Say what the reason is",
  "os.short": "Write at least 10 characters.",
  "os.save": "Save the reason",
  "os.clear": "Clear the reason",
  "os.saved": "Saved. It goes in each quarterly report while this line is over budget.",
  "os.who": "The MEL owner or a programme lead gives the reason. It goes in each quarterly report while this line is over budget.",
  "os.reads": "Reason given:",
  "os.line": "{code}: {spent} spent of {budget} {currency} ({pct}%).",
};
