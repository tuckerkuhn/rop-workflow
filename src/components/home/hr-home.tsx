"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pill } from "@/components/workspace/ui";
import type { HrHomeView } from "@/server/hr-home";

/**
 * Home for HR staff: are our people set up, paid and covered? The headline, four tiles (waiting
 * for you, timesheets, payroll, contracts ending), then who is starting, leaving and away.
 */

type Level = "good" | "warning" | "critical";
const TONE: Record<Level, { pill: "forest" | "ochre" | "clay"; text: string }> = { good: { pill: "forest", text: "✓ On track" }, warning: { pill: "ochre", text: "! Watch" }, critical: { pill: "clay", text: "! Now" } };
const monthName = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const PAY: Record<string, string> = { not_prepared: "not prepared", pending: "waiting for approval", approved: "approved" };

function Tile({ label, value, level, href, children }: { label: string; value: string; level: Level; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded-2xl border border-line bg-surface p-4 transition hover:border-forest">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted">{label}</p>
        <Pill tone={TONE[level].pill}>{TONE[level].text}</Pill>
      </div>
      <p className="mt-1 font-display text-3xl tabular-nums">{value}</p>
      <p className="mt-2 text-sm text-muted">{children}</p>
    </Link>
  );
}

export function HrHome({ userId }: { userId: string }) {
  const [v, setV] = useState<HrHomeView | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    fetch("/api/hr/home", { cache: "no-store", headers: { "x-demo-user": userId } })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not load.");
        if (live) setV(d);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [userId]);
  if (error) return <p className="rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>;
  if (!v)
    return (
      <div aria-busy className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-sunken" />
        ))}
      </div>
    );

  const m = monthName(v.month);
  // Timesheets and payroll are due at the month's end: a warning only in its last week.
  const monthEnd = new Date(Date.UTC(Number(v.month.slice(0, 4)), Number(v.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const lastWeek = new Date().toISOString().slice(0, 10) >= new Date(Date.parse(`${monthEnd}T00:00:00Z`) - 6 * 864e5).toISOString().slice(0, 10);
  const todo = v.waiting + v.myLeavingSteps;
  const notPrepared = v.payroll.filter((p) => p.status === "not_prepared");
  const overdue = v.renewals.filter((r) => r.overdue).length;
  const headline = [
    `${v.staff} staff on record`,
    v.timesheets.missing.length ? (lastWeek ? `${v.timesheets.missing.length} ${m} ${v.timesheets.missing.length === 1 ? "timesheet" : "timesheets"} not in yet` : `${m} timesheets due ${day(monthEnd)}`) : `every ${m} timesheet is in`,
    notPrepared.length ? (lastWeek ? `${m} payroll not prepared for ${notPrepared.map((p) => p.group).join(" and ")}` : "") : `${m} payroll prepared`,
    v.renewals.length ? `${v.renewals.length} ${v.renewals.length === 1 ? "contract ends" : "contracts end"} within ${v.renewalDays} days` : "",
  ]
    .filter(Boolean)
    .join("; ");

  return (
    <section aria-label="People" className="space-y-5">
      {!v.intact && (
        <Link href="/people" className="block rounded-2xl border border-clay bg-clay-soft px-5 py-3 text-sm font-semibold text-clay">
          The HR record shows signs of tampering. Open it now.
        </Link>
      )}
      <p className="text-lg leading-snug">{headline}.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Waiting for you" value={String(todo)} level={todo ? "warning" : "good"} href="/work">
          {todo ? [v.waiting ? `${v.waiting} record ${v.waiting === 1 ? "change" : "changes"} to sign` : "", v.myLeavingSteps ? `${v.myLeavingSteps} leaving ${v.myLeavingSteps === 1 ? "step" : "steps"}` : ""].filter(Boolean).join("; ") : "Nothing to sign."}
        </Tile>
        <Tile label={`${m} timesheets`} value={`${v.timesheets.submitted} of ${v.timesheets.total}`} level={v.timesheets.missing.length && lastWeek ? "warning" : "good"} href="/timesheets">
          {v.timesheets.missing.length ? (lastWeek ? `Not in: ${v.timesheets.missing.slice(0, 3).join(", ")}${v.timesheets.missing.length > 3 ? ` and ${v.timesheets.missing.length - 3} more` : ""}` : `Due ${day(monthEnd)}; ${v.timesheets.submitted} in so far.`) : "All submitted."}
          {v.timesheets.pending ? ` ${v.timesheets.pending} waiting for approval.` : ""}
        </Tile>
        <Tile label={`${m} payroll`} value={notPrepared.length ? "To prepare" : v.payroll.every((p) => p.status === "approved") ? "Approved" : "In approval"} level={notPrepared.length && lastWeek ? "warning" : "good"} href="/payroll">
          {v.payroll.map((p) => `${p.group}: ${PAY[p.status] ?? p.status}`).join(" · ")}
        </Tile>
        <Tile label="Contracts ending" value={String(v.renewals.length)} level={overdue ? "critical" : v.renewals.length ? "warning" : "good"} href="/offboarding">
          {v.renewals.length ? `${v.renewals[0].name}, ${v.renewals[0].overdue ? "ended" : "ends"} ${day(v.renewals[0].contractEnd)}${v.renewals.length > 1 ? `, and ${v.renewals.length - 1} more` : ""}` : `None in the next ${v.renewalDays} days.`}
        </Tile>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-display text-xl">Starting</h2>
          {v.starting.length ? (
            <ul className="mt-2 space-y-1.5 text-sm">
              {v.starting.map((s) => (
                <li key={s.name}>
                  <Link href="/onboarding" className="hover:text-forest">
                    {s.name}
                  </Link>{" "}
                  <span className="text-muted">
                    · {s.done} of {s.total} steps · due {day(s.due)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">Nobody is onboarding.</p>
          )}
        </section>
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-display text-xl">Leaving</h2>
          {v.leaving.length ? (
            <ul className="mt-2 space-y-1.5 text-sm">
              {v.leaving.map((l) => (
                <li key={l.name}>
                  <Link href="/offboarding" className="hover:text-forest">
                    {l.name}
                  </Link>{" "}
                  <span className="text-muted">
                    · last day {day(l.effective)} · {l.open} {l.open === 1 ? "step" : "steps"} open
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">Nobody is leaving.</p>
          )}
        </section>
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-display text-xl">Away today</h2>
          {v.away.length ? (
            <ul className="mt-2 space-y-1.5 text-sm">
              {v.away.map((a) => (
                <li key={a.name}>
                  {a.name} <span className="text-muted">· back after {day(a.until)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">Everyone is in.</p>
          )}
          {v.leaveWaiting > 0 && (
            <Link href="/leave" className="mt-2 block text-sm font-semibold text-forest hover:underline">
              {v.leaveWaiting} leave {v.leaveWaiting === 1 ? "request" : "requests"} waiting →
            </Link>
          )}
        </section>
      </div>
    </section>
  );
}
