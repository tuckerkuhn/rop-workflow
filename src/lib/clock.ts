/**
 * What "today" is. Projects saved in the database run on the real date; the fictional demo
 * projects run on a fixed date so their synthetic timelines stay meaningful.
 *
 * The server always runs on the real date. In the browser, the current-project provider switches
 * to the demo date while a demo project is open (`setDemoClock`).
 */

export const DEMO_DATE = "2027-03-04";

let demo = false;
export const setDemoClock = (on: boolean) => {
  demo = on;
};
export const onDemoClock = () => demo;

/** Today's date (YYYY-MM-DD) where the code runs: the browser's own day, or the server's (UTC). */
export const realToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Today for the open project: the real date, or the demo date on a demo project. */
export const today = () => (demo ? DEMO_DATE : realToday());

/* ---------- the demo project's dates, brought to today ---------- */

const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whole days from the demo date to `day` (negative before it). */
export const daysFromDemo = (day: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${DEMO_DATE}T00:00:00Z`)) / DAY);

/**
 * A copy of `value` with every date in it moved by `days`: dates written YYYY-MM-DD anywhere inside
 * text (so "2027-03-04T09:00:00Z" moves too) and Date objects. Record numbers such as "PR-2027-011"
 * and years on their own are left alone, and so are the keys of objects.
 *
 * The demo project's story was written around a fixed day in March 2027. Loaded as written, its
 * history sits months in the future beside records dated today. Moving every date by the same
 * number of days keeps the story intact (training two weeks ago, the planting window closing in
 * sixteen days) and makes it start from the day the sample data is loaded.
 */
export function shiftDates<T>(value: T, days: number): T {
  if (!days) return value;
  const move = (text: string) =>
    text.replace(/(?<![\d-])(20\d{2})-(\d{2})-(\d{2})(?!\d)/g, (found, y, m, d) => {
      const at = Date.parse(`${y}-${m}-${d}T00:00:00Z`);
      // Not a real date (month 13, day 40): not a date at all, leave it.
      return Number.isNaN(at) || iso(at) !== found ? found : iso(at + days * DAY);
    });
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return move(v);
    if (v instanceof Date) return new Date(v.getTime() + days * DAY);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
