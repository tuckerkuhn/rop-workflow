"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LoopOwner, NextReport } from "@/server/next-report";

/**
 * Home's first panel: what stands between the project and its next donor report, by who acts.
 * The same figures and checks as the report itself, so the two never disagree.
 */

const OWNER: Record<LoopOwner, string> = { field: "Field", mel: "MEL", writers: "Writing", finance: "Finance" };
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

export function NextReportPanel({ project, user }: { project: string; user: string }) {
  const [v, setV] = useState<NextReport | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/projects/${project}/next-report`, { cache: "no-store", headers: { "x-demo-user": user } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && d && setV(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [project, user]);
  if (!v) return null;
  const blocking = v.items.filter((i) => i.blocks).length;
  const owners = (Object.keys(OWNER) as LoopOwner[]).filter((o) => v.items.some((i) => i.owner === o));
  return (
    <section aria-label="Next report" className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-xl">Next report: {v.quarter.replace("-", " ")}</h2>
        <p className="text-sm text-muted">
          due about {day(v.due)} ({v.daysLeft} days)
        </p>
        <Link href="/progress/report" className="ms-auto text-sm font-semibold text-forest hover:underline">
          Open the report →
        </Link>
      </div>
      {v.released ? (
        <p className="mt-2 text-sm text-leaf">Released. Nothing stands in the way.</p>
      ) : v.items.length === 0 ? (
        <p className="mt-2 text-sm text-leaf">Nothing stands in the way yet: keep recording results and weekly updates as they happen.</p>
      ) : (
        <>
          <p className="mt-1 text-sm">{blocking ? `${blocking} ${blocking === 1 ? "thing stops" : "things stop"} it going out; ${v.items.length - blocking} more to do before it does.` : `${v.items.length} ${v.items.length === 1 ? "thing" : "things"} to do before it goes out; nothing blocks it.`}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {owners.map((o) => (
              <div key={o}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{OWNER[o]}</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {v.items
                    .filter((i) => i.owner === o)
                    .map((i) => (
                      <li key={i.text}>
                        <Link href={i.href} className="hover:text-forest">
                          {i.blocks && <span className="me-1 font-semibold text-clay">Blocks:</span>}
                          {i.text}
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
