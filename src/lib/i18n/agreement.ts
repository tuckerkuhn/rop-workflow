/**
 * Setup from the three documents (lib/agreement): the uploads, and the Deadlines and Rules steps.
 * English is the source; Dari, Pashto and Spanish are drafts that need review by a native speaker
 * before field use. A missing string falls back to English.
 */

export const agEn = {
  "ag.title": "Start from the documents",
  "ag.help": "Upload the signed agreement, the logframe or results framework, and the budget (PDF, Word or Excel). Any one alone works. Claude proposes each part with where it came from; you confirm each section before anything is saved.",
  "ag.helpRunning": "Upload the signed agreement (and the budget, if the project has none yet). Claude proposes the report deadlines and the donor's rules with where each came from; you confirm them.",
  "ag.slot.agreement": "Agreement",
  "ag.slot.logframe": "Logframe or results framework",
  "ag.slot.budget": "Budget",
  "ag.choose": "Choose file",
  "ag.read": "Read the documents",
  "ag.reading": "Reading… (up to 2 minutes)",
  "ag.partFailed": "{part} could not be read: {error}",
  "ag.done": "Read. Check each step: nothing is saved until you confirm it.",
  "ag.sources": "Where each answer came from",
  "ag.budgetFrom": "Proposed from {file}: check the lines, then save, or skip.",
  "ag.deadlines.title": "Report deadlines",
  "ag.deadlines.help": "The reports the agreement requires, with their due dates over the project's life. Each one you keep becomes a Report deadline in Tasks, and the report check counts down to it.",
  "ag.deadlines.none": "No reporting obligations proposed. Upload the agreement above, or add deadlines in Tasks.",
  "ag.deadlines.days": "Due {days} days after each period ends",
  "ag.deadlines.format": "Format: {format}",
  "ag.deadlines.donor": "Donor",
  "ag.deadlines.periods": "Report periods",
  "ag.deadlines.periodsOwn": "The agreement's own, from {month}",
  "ag.deadlines.periodsCalendar": "Calendar quarters and years, from January",
  "ag.deadlines.link": "Link to the template, if there is one",
  "ag.deadlines.save": "Add {n} deadlines to Tasks",
  "ag.deadlines.saved": "{n} deadlines added to Tasks.",
  "ag.rules.title": "The donor's rules",
  "ag.rules.help": "Rules from the agreement that the app can check. Each one you keep becomes this project's rule in Settings, Policy, with its clause; it takes the place of the donor profile's value, and combines with ROP's own rules as usual.",
  "ag.rules.none": "No rules proposed. Upload the agreement above, or set them in Settings, Policy.",
  "ag.rules.terms": "Other terms to follow",
  "ag.rules.termsHelp": "Listed on the policy page for the team; the app does not check these.",
  "ag.rules.save": "Save {n} rules and {m} terms",
  "ag.rules.saved": "Saved to the project's policy.",
  "ag.questions": "To settle",
  "ag.skip": "Skip",
  "ag.keep": "Keep",
  "ag.source": "Source: {source}",
};
