/**
 * One row per target on Progress (C3): the status as one of three words, never colour alone, with
 * a short second word that says which kind. The judgment itself is the workplan status the reports
 * use (lib/qpr suggestStatus); this only puts it into the three words a new reader needs.
 */

export type TargetWord = "on_track" | "behind" | "no_data";
export type TargetDetail = "met" | "notDue" | "dueNow" | "notPlanned" | "delayed" | "notDone" | null;
export type TargetStatus = { word: TargetWord; detail: TargetDetail; tone: "forest" | "clay" | "muted" };

export function targetStatus(i: { status: string; planned: number[] | null; year: number; yearTarget: number }, quarterNow: number): TargetStatus {
  if (i.status === "delayed") return { word: "behind", detail: "delayed", tone: "clay" };
  if (i.status === "not_implemented") return { word: "behind", detail: "notDone", tone: "clay" };
  if (i.status === "completed") return { word: "on_track", detail: "met", tone: "forest" };
  // Nothing accepted yet: say so, with why that may be fine (not due yet) or not (not in the workplan, due now).
  if (i.year <= 0) {
    if (i.planned && i.planned.length === 0 && i.yearTarget > 0) return { word: "no_data", detail: "notPlanned", tone: "muted" };
    if (i.planned?.length && Math.max(...i.planned) === quarterNow) return { word: "no_data", detail: "dueNow", tone: "muted" };
    return { word: "no_data", detail: i.planned?.length && Math.min(...i.planned) > quarterNow ? "notDue" : null, tone: "muted" };
  }
  return { word: "on_track", detail: null, tone: "forest" };
}

export const quarterOfToday = (today: string) => Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
