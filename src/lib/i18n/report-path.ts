/**
 * Text for the path to a quarterly report (10 Nov 2026): which quarter a person is in, what the
 * app filled in, and what their roles do not let them do. English is the source; Spanish, Dari
 * and Pashto are drafts that need review by a native speaker before field use.
 */

export const rpEn = {
  "nr.title": "Next report: {q}",
  "nr.dates": "ready by {aim} (days left: {n}), due to the donor {due}",
  "nr.noDeadline": "no deadline set",
  "nr.blocksOne": "1 thing blocks it",
  "nr.blocks": "{n} things block it",
  "nr.blocksNone": "nothing blocks it",
  "nr.toDo": "{n} to do",
  "nr.released": "Released. Nothing stands in the way.",
  "nr.clear": "Nothing stands in the way yet: keep recording results and weekly updates as they happen.",
  "nr.sumBlockedOne": "1 thing blocks the report, and {m} more to do before it can go.",
  "nr.sumBlocked": "{n} things block the report, and {m} more to do before it can go.",
  "nr.sumOpen": "{n} to do before the report can go. Nothing blocks it.",
  "nr.yours": "{n} for you.",
  "nr.others": "{n} for others ({who}). The report check lists every one.",
  "rp.quarterPast": "This is the report for {q}, {from} to {to}. Home's next report is {now}.",
  "rp.quarterNow": "This is the report for {q}, the quarter now under way. It ends on {to}.",
  "rp.quarterDue": "This is the report for {q}, {from} to {to}: the quarter has ended and this is the next report due to the donor.",
  "rp.openQuarter": "Open {q}",
  "rp.durationFromDates": "Left empty, the report prints the project's dates: {dates}. Type here only if the agreement says something else.",
  "rp.cannot": "On this report you cannot:",
  "rp.cannot.edit": "write or change the text (needs the MEL owner or a programme lead)",
  "rp.cannot.release": "mark it final (needs the role \"Releases donor reports\")",
  "rp.cannot.import": "import spending (needs Finance or the role \"Imports spending\")",
  "rp.cannot.accept": "accept results (needs the MEL owner)",
  "rp.cannot.ask": "An administrator can give you a role.",
  // UNDP's Word template has its own fixed status terms; the comment starts with this one.
  "rp.wordTerm": "In the Word report: {term}",
  "rp.totals.onReport": "The Budget page shows the current phase only, before overhead, so its totals are not the same as these.",
  "rp.totals.onBudget": "The quarterly report shows the whole agreement, with overhead when Finance's workbook gives it, so its totals are not the same as these.",
  "rp.col.target": "{year} target",
  "rp.col.quarter": "{q} achieved",
  "rp.col.year": "This year",
};
