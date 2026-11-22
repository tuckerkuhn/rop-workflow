"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useSession } from "@/components/app/session";
import type { CalendarRow, CalendarState } from "@/lib/report-calendar";

/**
 * The report calendar on Progress: each donor report owed around now on one ruled list, soonest
 * first, each row opening that report at its check. Says why the dates matter, once.
 */

const STATE: Record<CalendarState, { text: string; tone: string }> = {
  late: { text: "Late", tone: "bg-clay text-paper" },
  soon: { text: "Due soon", tone: "bg-ochre text-ink" },
  later: { text: "Coming", tone: "text-muted" },
  passed: { text: "Date passed", tone: "text-warn" },
  released: { text: "Released", tone: "text-leaf" },
};

export function ReportCalendar() {
  const { user, ready } = useSession();
  const { project } = useCurrentProject();
  const { date } = useT();
  const [rows, setRows] = useState<CalendarRow[] | null>(null);
  useEffect(() => {
    if (!ready || !user || user.kind !== "employee" || !project.saved) return;
    let live = true;
    setRows(null);
    fetch(`/api/projects/${project.id}/report-calendar`, { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setRows(d?.rows ?? []))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [ready, user, project.id, project.saved]);
  if (!rows?.length) return null;
  const day = (iso: string) => date(iso, { day: "numeric", month: "short", year: "numeric" });
  const none = rows.every((r) => !r.due);
  return (
    <section aria-labelledby="report-calendar" className="mt-8">
      <h2 id="report-calendar" className="border-s-[6px] border-warn ps-2 font-ledger text-lg font-bold leading-tight">
        Report calendar
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Every report the donor is owed around now. The dates come from the grant agreement: a donor can hold the next payment until a late report arrives.
      </p>
      <ol className="mt-2 border-t-2 border-ink">
        {rows.map((r, k) => (
          <li key={`${r.kind}-${r.period}`} className={`border-b border-line ${k === 0 && !r.released ? "bg-ochre-soft" : ""}`}>
            <Link href={r.href} className="group flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 px-2 py-2 hover:bg-ochre-soft focus-visible:bg-ochre-soft">
              <span aria-hidden className="w-6 shrink-0 font-mono text-xs text-muted">
                {String(k + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1 font-semibold">{r.kind === "qpr" ? `Quarterly report, ${r.period.replace("-Q", " Q")}` : `Annual report, ${r.period}`}</span>
              <span className="w-32 shrink-0 font-mono text-sm">{r.due ? day(r.due) : "No date set"}</span>
              <span className={`w-28 shrink-0 px-2 py-0.5 text-center font-mono text-xs uppercase ${STATE[r.state].tone}`}>{STATE[r.state].text}</span>
              <span aria-hidden className="inline-block text-forest opacity-40 group-hover:opacity-100 rtl:rotate-180">
                →
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {none && (
        <p className="mt-2 text-sm text-warn">
          No report dates are set for this project. Add the donor&rsquo;s reporting days in{" "}
          <Link href="/settings/policy" className="font-semibold underline">
            Rules
          </Link>{" "}
          or add a &ldquo;Report deadline&rdquo; milestone to the plan.
        </p>
      )}
    </section>
  );
}
