"use client";

import { useEffect, useState } from "react";
import { today } from "@/lib/clock";
import { errorText } from "@/lib/plain-error";
import { quarterOf } from "@/lib/results";

/**
 * "The quarter whose report is due" (server/next-report reportQuarter): the quarter just ended
 * while its report is still being written, else the one under way. The quarterly report opens on
 * it, and anything that goes "into the report" (a story, for one) goes into the same quarter.
 */

/** The last quarter that has ended, by the app's clock (the demo date when it is on): the fallback while the server's answer is not in. */
export function lastEndedQuarter(day = today()) {
  const cur = quarterOf(day);
  const [y, n] = [Number(cur.slice(0, 4)), Number(cur.slice(6))];
  return n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`;
}

/** The same request shape as the progress pages' call(): signed in as the demo user, the server's own error words on failure. */
async function call<T>(url: string, user: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", headers: { "Content-Type": "application/json", "x-demo-user": user } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorText(body, res.status));
  return body as T;
}

/**
 * The report-due quarter for a saved project, from /report-quarter. null until it is known (and
 * again while another project's answer is loading); the last ended quarter if it cannot be read.
 */
export function useReportQuarter(projectId: string, userId: string | undefined, enabled = true) {
  // Kept with the project it belongs to, so a project switch never shows the previous project's quarter.
  const [got, setGot] = useState<{ projectId: string; quarter: string } | null>(null);
  useEffect(() => {
    if (!enabled || !userId) return;
    let live = true;
    call<{ quarter: string }>(`/api/projects/${projectId}/report-quarter`, userId)
      .then((d) => live && setGot({ projectId, quarter: d.quarter }))
      .catch(() => live && setGot({ projectId, quarter: lastEndedQuarter() }));
    return () => {
      live = false;
    };
  }, [projectId, userId, enabled]);
  return got && got.projectId === projectId ? got.quarter : null;
}
