/**
 * Text added in the November 2026 clean-up: what a screen says when something could not load or
 * be checked, and what to do next. English is the source; Spanish, Dari and Pashto are drafts
 * that need review by a native speaker before field use. A missing string falls back to English.
 */

export const sgEn = {
  "pf.uncheckedConfirm": "The report check could not run just now, so the app cannot tell whether anything blocks this report. The file will be marked \"Draft, not checked\". Download it anyway?",
  "pf.c.typedSpend": "This quarter's spending is typed in as {typed}, but Finance's import says {imported}. The report will print the typed figure: clear it to use Finance's, or keep it and be ready to explain the difference.",
  "err.title": "This page could not load",
  "err.body": "Nothing you saved is lost. Check your connection and try again. If it keeps happening, tell an administrator.",
  "err.retry": "Try again",
  "err.home": "Go to Home",
  "load.wait": "Loading…",
  "tasks.loadFailed": "Your work on this project could not be loaded, so this list may be missing things. Check your connection and try again.",
  "closeout.loadFailed": "The bills could not be loaded, so vouchers may be missing from this list. Check your connection and reload the page.",
  "field.saveFailed": "The last change was not saved: {error} Check your connection, then make the change again.",
  "report.loading": "Loading the report…",
  "report.blocked": "{n} things block this report, so it cannot be marked final yet. The report check lists each one and where to fix it.",
  "report.blockedOne": "1 thing blocks this report, so it cannot be marked final yet. The report check shows what it is and where to fix it.",
  "setup.saveFailed": "The project was not saved. Nothing you entered is lost: check your connection and press Save again.",
};

/** Home: what is waiting on a person, in three groups (C1). */
export const hbEn = {
  "home.b.title": "Waiting on you",
  "home.b.none": "Nothing is waiting on you.",
  "home.b.approve": "Approve",
  "home.b.fix": "Fix",
  "home.b.due": "Due",
  "home.b.blocks": "Blocks the report:",
  "home.b.now": "Now",
  "home.b.reportDue": "{report} report: have it ready by {date}",
  "home.b.reviewDue": "{review} closes on {date}",
  "home.b.days": "{n} days",
  "home.b.today": "Today",
  "home.b.late": "{n} days late",
};

/** Progress: one row per target (C3). */
export const prEn = {
  "prog.title": "Targets in {year}",
  "prog.target": "Target",
  "prog.result": "Result so far",
  "prog.w.done": "Done",
  "prog.w.on_track": "On track",
  "prog.w.behind": "Behind",
  "prog.w.not_started": "Not started",
  "prog.w.no_data": "No data",
  "prog.d.notDue": "not due yet",
  "prog.d.dueNow": "due this quarter",
  "prog.d.notPlanned": "not in this year's workplan",
  "prog.d.delayed": "delayed",
  "prog.d.notDone": "not done",
  "prog.last": "Last accepted result: {date}",
  "prog.noLast": "No accepted result yet",
  "prog.open": "Tap a row to see the records and proof behind it.",
};

/** Project manager's path and the short Home for field staff who only use KoboCollect (C2). */
export const pmEn = {
  "pf.clearNext": "Nothing blocks this report. Open it, read it through, then mark it final.",
  "home.kobo.title": "Your data comes in through KoboCollect",
  "home.kobo.body": "Keep filling in the forms on your phone as you do now. You do not need to enter anything here. What is sent shows below after the next sync, and MEL then checks it.",
  "home.kobo.recent": "Latest submissions received for this project",
  "home.kobo.notYours": "The app cannot yet tell which submissions are yours, so this list is the whole project's.",
  "home.kobo.none": "No submissions have arrived yet. If you have sent some, they show here after the next sync.",
  "home.kobo.synced": "Last synced {date}",
  "home.kobo.neverSynced": "Not synced yet",
  "home.kobo.pending": "Waiting for MEL",
  "home.kobo.accepted": "Counted",
  "home.kobo.queried": "MEL has a question",
};

/** Health page: the nightly KoboToolbox reconcile (B4). */
export const hkEn = {
  "health.kobo.title": "KoboToolbox nightly check",
  "health.kobo.help": "Each night the app reads every connected project's forms again, to catch answers edited or deleted in KoboToolbox after they first arrived. An accepted result is never changed by this: it is flagged for MEL.",
  "health.kobo.none": "No run in the last week. It starts once the scheduled job is live and a project is connected to KoboToolbox.",
  "health.kobo.same": "{fetched} submissions checked: nothing had changed.",
  "health.kobo.changed": "{fetched} submissions checked: {added} new, {updated} edited, {removed} deleted in KoboToolbox.",
  "health.kobo.flagged": "Accepted results changed in KoboToolbox and flagged for MEL: {n}.",
  "health.kobo.failed": "Did not run: {error}",
};
