/**
 * The one set of words for where a target stands, used on every screen: Progress, the results
 * framework, the monthly review, the quarterly report page, the donor's share link and All projects.
 *
 *   Done         the year's target is met
 *   On track     work under way and accepted results recorded
 *   Behind       late (detail "delayed") or nothing done when it should have been (detail "not done")
 *   Not started  not begun; the detail says whether that is fine (not due yet), urgent (due this
 *                quarter) or a planning gap (not in this year's workplan)
 *   No data      the status says under way, but no result is accepted yet
 *
 * The judgment itself is the workplan status the reports use (lib/qpr suggestStatus, or the team's
 * own choice on the quarterly report). Only the downloaded Word report keeps UNDP's fixed terms
 * (Completed, On track, Delayed, Not implemented, Not yet started: lib/qpr STATUS_LABEL), because its
 * template asks for them.
 */

export type TargetWord = "done" | "on_track" | "behind" | "not_started" | "no_data";
export type TargetDetail = "notDue" | "dueNow" | "notPlanned" | "delayed" | "notDone" | null;
export type TargetTone = "forest" | "sky" | "ochre" | "clay" | "muted";
export type TargetStatus = { word: TargetWord; detail: TargetDetail; tone: TargetTone };

export const TARGET_WORDS: TargetWord[] = ["done", "on_track", "behind", "not_started", "no_data"];

/** English, for the server and pages not yet translated; translated pages use prog.w.* and prog.d.* (lib/i18n/surge). */
export const TARGET_WORD_EN: Record<TargetWord, string> = { done: "Done", on_track: "On track", behind: "Behind", not_started: "Not started", no_data: "No data" };
export const TARGET_DETAIL_EN: Record<Exclude<TargetDetail, null>, string> = {
  notDue: "not due yet",
  dueNow: "due this quarter",
  notPlanned: "not in this year's workplan",
  delayed: "delayed",
  notDone: "not done",
};

const TONE: Record<TargetWord, TargetTone> = { done: "forest", on_track: "sky", behind: "clay", not_started: "muted", no_data: "muted" };

/** The word for a report status on its own, with no figures (the status picker on the quarterly report). */
export function wordOfStatus(status: string): TargetStatus {
  switch (status) {
    case "completed":
      return { word: "done", detail: null, tone: TONE.done };
    case "on_track":
      return { word: "on_track", detail: null, tone: TONE.on_track };
    case "delayed":
      return { word: "behind", detail: "delayed", tone: TONE.behind };
    case "not_implemented":
      return { word: "behind", detail: "notDone", tone: TONE.behind };
    case "not_started":
      return { word: "not_started", detail: null, tone: TONE.not_started };
    default:
      return { word: "no_data", detail: null, tone: TONE.no_data };
  }
}

/** Why a target with nothing begun may be fine, due now, or missing from the workplan. */
function whenDue(i: { planned: number[] | null; year: number; yearTarget: number }, quarterNow: number): { detail: TargetDetail; tone?: TargetTone } {
  if (i.planned && i.planned.length === 0 && i.yearTarget > i.year) return { detail: "notPlanned", tone: "ochre" };
  if (i.planned?.length && Math.max(...i.planned) === quarterNow) return { detail: "dueNow", tone: "ochre" };
  if (i.planned?.length && Math.min(...i.planned) > quarterNow) return { detail: "notDue" };
  return { detail: null };
}

/** Where a target stands, as one word and a detail, for the quarter `quarterNow` (1 to 4). */
export function targetStatus(i: { status: string; planned: number[] | null; year: number; yearTarget: number }, quarterNow: number): TargetStatus {
  const base = wordOfStatus(i.status);
  if (base.word === "not_started") {
    const d = whenDue(i, quarterNow);
    return { word: "not_started", detail: d.detail, tone: d.tone ?? base.tone };
  }
  // Under way by its status, but nothing accepted yet: never call that On track.
  if (base.word === "on_track" && i.year <= 0) {
    const d = whenDue(i, quarterNow);
    return { word: "no_data", detail: d.detail, tone: d.tone ?? TONE.no_data };
  }
  return base;
}

/** "Behind · not done", in English (server, Word-free donor views, pages not yet translated). */
export const targetStatusText = (s: TargetStatus) => `${TARGET_WORD_EN[s.word]}${s.detail ? ` · ${TARGET_DETAIL_EN[s.detail]}` : ""}`;

export const quarterOfToday = (today: string) => Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
