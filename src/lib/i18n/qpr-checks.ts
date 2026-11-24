/**
 * The quarterly report's checks before it goes out (lib/qpr checksFor), shown on the report page and
 * in pre-flight. English is the source; Spanish, Dari and Pashto are drafts that need review by a
 * native speaker before field use. Codes, figures, section names and status names arrive as vars.
 */

export const qcEn = {
  "qc.pending": "{code}: {n} result(s) this quarter are still waiting for MEL to check, so they are not counted.",
  "qc.queried": "{code}: MEL sent back {n} result(s) this quarter with a question, so they are not counted until corrected.",
  "qc.noProof": "{code}: {n} result(s) this quarter have no proof attached{note}.",
  "qc.completedShort": "{code}: marked Done (Completed in the Word report), but this year's result is {done} of a target of {target} {unit}.",
  "qc.notImplemented": "{code}: marked Behind, not done (Not implemented in the Word report), but this year's result is {done} {unit}.",
  "qc.commentPct": "{code}: the comment says {pcts}%, but this year's result is {real}% of the target.",
  "qc.commentStatus": "{code}: the comment should start with its status as the Word report words it ({status}).",
  "qc.overBudget": "Spending so far ({spent}) is more than the budget ({budget}).",
  "qc.quarterOverTotal": "This quarter's spending is more than all spending so far.",
  "qc.noQuarterSpend": "This quarter's spending is not entered: import Finance's budget and spending workbook, or type it in under Project information.",
  "qc.lineOver": "Budget line {code} has spent {spent} of {budget} {currency} ({pct}%): say why it is over budget, or give the budget revision, under Project information.",
  "qc.missingMonths": "The spending import does not include {months}: import Finance's latest workbook.",
  "qc.typedSpend": "This quarter's spending is typed in as {typed}, but Finance's import says {imported}.",
  "qc.sectionEmpty": "{heading} is not written yet.",
  "qc.sectionCopied": "{heading} is copied from {from}: check it still fits this quarter.",
  "qc.activityText": "Activity {code} has results this quarter but nothing written about them.",
  "qc.risks": "The risk table is empty.",
  "qc.grm": "The complaints numbers are not filled in: record complaints in the feedback log, or type the figures on the report.",
};
