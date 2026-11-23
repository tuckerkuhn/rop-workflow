"use client";

import { useEffect, useState } from "react";
import { quarterOf } from "@/lib/results";

/**
 * "The quarter whose report is due" (server/next-report reportQuarter): the quarter just ended
 * while its report is still being written, else the one under way. The quarterly report opens on
 * it, and anything that goes "into the report" (a story, for one) goes into the same quarter.
 */

/** The last quarter that has ended (real date): the fallback while the server's answer is not in. */
export function lastEndedQuarter(today = new Date().toISOString().slice(0, 10)) {
  const cur = quarterOf(today);
  const [y, n] = [Number(cur.slice(0, 4)), Number(cur.slice(6))];
  return n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`;
}

/** The report-due quarter for a saved project, from /report-quarter. null until it is known; the last ended quarter if it cannot be read. */
export function useReportQuarter(projectId: string, userId: string | undefined, enabled = true) {
  const [quarter, setQuarter] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !userId) return;
    let live = true;
    fetch(`/api/projects/${projectId}/report-quarter`, { cache: "no-store", headers: { "x-demo-user": userId } })
      .then((r) => (r.ok ? (r.json() as Promise<{ quarter: string }>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setQuarter(d.quarter))
      .catch(() => live && setQuarter(lastEndedQuarter()));
    return () => {
      live = false;
    };
  }, [projectId, userId, enabled]);
  return quarter;
}
