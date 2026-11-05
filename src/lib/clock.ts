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
