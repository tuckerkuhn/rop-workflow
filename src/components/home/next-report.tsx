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

const OWNERS: LoopOwner[] = ["lead", "field", "mel", "writers", "finance"];

/** `data`: the next report already loaded by Home (null while loading); without it the panel loads its own. */
export function NextReportPanel({ project, user, owners, data }: { project: string; user: string; owners?: LoopOwner[]; data?: NextReport | null }) {
  const { t, date } = useT();
  const day = (d: string) => date(d, { day: "numeric", month: "long" });
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
  // The counts are always the whole report's, as on Home's tile and pre-flight, so the numbers agree
  // wherever they show. The list is this person's own part (leads see all of it); the rest is
  // named by who has it.
  const all = v.items;
  const blocking = all.filter((i) => i.blocks).length;
  if (owners) v = { ...v, items: all.filter((i) => owners.includes(i.owner)) };
  const others = all.filter((i) => !v!.items.includes(i));
  const otherOwners = OWNERS.filter((o) => others.some((i) => i.owner === o));
  // One line until opened; open from the start when something stops the report going out.
  const shown = open ?? blocking > 0;
  const groups = OWNERS.filter((o) => v.items.some((i) => i.owner === o));
  return (
    <section aria-label={t("nr.title", { q: v.quarter.replace("-", " ") })} className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xl font-semibold">{t("nr.title", { q: v.quarter.replace("-", " ") })}</h2>
        <p className="text-sm text-muted">
          {v.deadline.aim && v.deadline.due ? (
            <>
              {t("nr.dates", { aim: day(v.deadline.aim), n: v.daysLeft ?? 0, due: day(v.deadline.due) })}
              {!v.released && urgency(v.deadline, new Date().toISOString().slice(0, 10)) && <span className="ms-1 font-semibold text-clay">⚠</span>}
            </>
          ) : (
            t("nr.noDeadline")
          )}
        </p>
        {!v.released && all.length > 0 && (
          <button type="button" onClick={() => setOpen(!shown)} aria-expanded={shown} className="text-sm font-semibold text-forest hover:underline">
            {blocking === 1 ? t("nr.blocksOne") : blocking ? t("nr.blocks", { n: blocking }) : t("nr.blocksNone")} · {t("nr.toDo", { n: all.length - blocking })} {shown ? "▴" : "▾"}
          </button>
        )}
        <span className="ms-auto flex flex-wrap gap-x-4 gap-y-1">
          <Link href={`/progress/report?q=${v.quarter}`} className="btn-link">
            {t("pf.openReport")} →
          </Link>
          <Link href={preflightHref({ kind: "qpr", quarter: v.quarter })} className="btn-link">
            {t("pf.button")} →
          </Link>
        </span>
      </div>
      {v.released ? (
        <p className="mt-2 text-sm text-leaf">{t("nr.released")}</p>
      ) : all.length === 0 ? (
        <p className="mt-2 text-sm text-leaf">{t("nr.clear")}</p>
      ) : !shown ? null : (
        <>
          <p className="mt-1 text-sm">
            {blocking === 1 ? t("nr.sumBlockedOne", { m: all.length - 1 }) : blocking ? t("nr.sumBlocked", { n: blocking, m: all.length - blocking }) : t("nr.sumOpen", { n: all.length })}
            {owners && others.length > 0 && (
              <>
                {" "}
                {t("nr.yours", { n: v.items.length })} {t("nr.others", { n: others.length, who: otherOwners.map((o) => t(`pf.owner.${o}`)).join(", ") })}
              </>
            )}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {groups.map((o) => (
              <div key={o}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t(`pf.owner.${o}`)}</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {v.items
                    .filter((i) => i.owner === o)
                    .map((i) => (
                      <li key={i.text}>
                        <Link href={i.href} className="hover:text-forest">
                          {i.blocks && <span className="me-1 font-semibold text-clay">{t("home.b.blocks")}</span>}
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
