"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { itemText } from "@/components/progress/preflight-page";
import { preflightHref, urgency } from "@/lib/preflight";
import type { LoopOwner, NextReport } from "@/server/next-report";

/**
 * Home's first panel: what stands between the project and its next donor report, by who acts.
 * The same figures and checks as the report itself, so the two never disagree.
 */

const OWNER: Record<LoopOwner, string> = { lead: "Programme lead", field: "Field", mel: "MEL", writers: "Writing", finance: "Finance" };
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/** `data`: the next report already loaded by Home (null while loading); without it the panel loads its own. */
export function NextReportPanel({ project, user, owners, data }: { project: string; user: string; owners?: LoopOwner[]; data?: NextReport | null }) {
  const { t } = useT();
  const [loaded, setV] = useState<NextReport | null>(null);
  let v = data === undefined ? loaded : data;
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    if (data !== undefined) return;
    let live = true;
    fetch(`/api/projects/${project}/next-report`, { cache: "no-store", headers: { "x-demo-user": user } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && d && setV(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [project, user, data]);
  if (!v) return null;
  // Each person sees their own part of what stands in the way; leads see all of it.
  if (owners) v = { ...v, items: v.items.filter((i) => owners.includes(i.owner)) };
  const blocking = v.items.filter((i) => i.blocks).length;
  // One line until opened; open from the start when something stops the report going out.
  const shown = open ?? blocking > 0;
  const groups = (Object.keys(OWNER) as LoopOwner[]).filter((o) => v.items.some((i) => i.owner === o));
  return (
    <section aria-label="Next report" className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-xl">Next report: {v.quarter.replace("-", " ")}</h2>
        <p className="text-sm text-muted">
          {v.deadline.aim && v.deadline.due ? (
            <>
              ready by {day(v.deadline.aim)} ({v.daysLeft} days), due to the donor {day(v.deadline.due)}
              {!v.released && urgency(v.deadline, new Date().toISOString().slice(0, 10)) && <span className="ms-1 font-semibold text-clay">⚠</span>}
            </>
          ) : (
            "no deadline set"
          )}
        </p>
        {!v.released && v.items.length > 0 && (
          <button type="button" onClick={() => setOpen(!shown)} aria-expanded={shown} className="text-sm font-semibold text-forest hover:underline">
            {blocking ? `${blocking} ${blocking === 1 ? "thing blocks" : "things block"} it` : "nothing blocks it"} · {v.items.length - blocking} to do {shown ? "▴" : "▾"}
          </button>
        )}
        <Link href={preflightHref({ kind: "qpr", quarter: v.quarter })} className="ms-auto text-sm font-semibold text-forest hover:underline">
          Pre-flight →
        </Link>
      </div>
      {v.released ? (
        <p className="mt-2 text-sm text-leaf">Released. Nothing stands in the way.</p>
      ) : v.items.length === 0 ? (
        <p className="mt-2 text-sm text-leaf">Nothing stands in the way yet: keep recording results and weekly updates as they happen.</p>
      ) : !shown ? null : (
        <>
          <p className="mt-1 text-sm">{blocking ? `${blocking} ${blocking === 1 ? "thing stops" : "things stop"} it going out; ${v.items.length - blocking} more to do before it does.` : `${v.items.length} ${v.items.length === 1 ? "thing" : "things"} to do before it goes out; nothing blocks it.`}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {groups.map((o) => (
              <div key={o}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{OWNER[o]}</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {v.items
                    .filter((i) => i.owner === o)
                    .map((i) => (
                      <li key={i.text}>
                        <Link href={i.href} className="hover:text-forest">
                          {i.blocks && <span className="me-1 font-semibold text-clay">Blocks:</span>}
                          {itemText(t, i)}
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
