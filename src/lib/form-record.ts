/**
 * A field form filled in inside the app is saved as the same record a KoboCollect submission was:
 * its answers at the top of the payload with the same names, so every reader of a KoboCollect
 * record reads it too (server/kobo toSubmission, server/review, server/distribution). It is told
 * apart by this key, which names the form, and by its source: "manual", since nothing came from
 * KoboToolbox. No new column or table is needed (no migration).
 *
 * Two different questions, kept apart:
 * - `hasAnswers`: the record holds form answers (KoboCollect, or a form filled in here), so its
 *   photo, signature, condition and amounts are read from them;
 * - `source === "kobo"`: it came through a KoboCollect account, so who collected it is worked out
 *   from the account and its photos sit in KoboToolbox. A form filled in here was made by the
 *   person signed in: they are its collector.
 */

export const APP_FORM_KEY = "_rop_app_form";

type Row = { source: string; payload?: unknown };

/** The form a record was filled in on inside the app, or null. */
export const appFormOf = (r: Row): string | null => {
  const k = ((r.payload ?? {}) as Record<string, unknown>)[APP_FORM_KEY];
  return r.source === "manual" && typeof k === "string" && k ? k : null;
};

/** Whether a record holds form answers, from KoboCollect or from a form filled in inside the app. */
export const hasAnswers = (r: Row) => r.source === "kobo" || !!appFormOf(r);
