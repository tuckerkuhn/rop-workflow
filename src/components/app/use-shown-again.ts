"use client";

import { useEffect, useState } from "react";

/**
 * Counts each time a page that was left open is looked at again: the phone's browser or the tab
 * comes back to the front, or the Back button brings the page back as it was. A screen that lists
 * what waits for a person puts the count among what its read depends on, so the list is read again
 * and a row that arrived meanwhile shows without a reload.
 *
 * Not more often than every `gap` milliseconds, so flicking between two apps does not read the
 * same thing over and over. Starts at 0: the first read is the screen's own.
 */
export function useShownAgain(gap = 20_000): number {
  const [times, setTimes] = useState(0);
  useEffect(() => {
    let last = Date.now();
    const again = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < gap) return;
      last = Date.now();
      setTimes((n) => n + 1);
    };
    const restored = (e: PageTransitionEvent) => {
      if (e.persisted) again();
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("pageshow", restored);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("pageshow", restored);
    };
  }, [gap]);
  return times;
}
