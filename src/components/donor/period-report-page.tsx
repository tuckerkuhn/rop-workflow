"use client";

import Link from "next/link";
import { longDate } from "@/lib/weekly";
import { useRouter, useSearchParams } from "next/navigation";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useRequireUser } from "@/components/app/session";
import { AccountPhoto } from "@/components/donor/report-page";
import { PreviewNote } from "@/components/donor/reports-page";
import { useDonorPeriodReport, useDonorView } from "@/components/donor/use-donor-view";
import { longDay } from "@/components/share/report-body";
import { Empty, Fig, Figures, LedgerRow, LedgerTable, SectionHead, StatusBlock } from "@/components/workspace/ledger";
import { TopBar } from "@/components/workspace/ui";

/**
 * A released annual or final report inside a donor's account: the frozen copy made when Roots of
 * Peace released it, read-only. Later changes to the project do not change it.
 */

const n = (v: number | null) => (v === null ? "–" : v.toLocaleString("en-US", { maximumFractionDigits: 1 }));
const VERDICT = { met: { tone: "forest", text: "Met" }, partly: { tone: "ochre", text: "Partly" }, not_met: { tone: "clay", text: "Not met" }, no_target: { tone: "muted", text: "No target" } } as const;
const LESSON_COLS = "minmax(6rem,1fr) 7rem minmax(0,3fr)";

export function DonorPeriodReportPage({ slug }: { slug: string }) {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const asked = useSearchParams().get("donor");
  const router = useRouter();
  const { tx } = useT();
  const code = project.saved ? project.id : null;
  const { data, error } = useDonorPeriodReport(code, slug, asked);
  // Staff choosing between donors need the list; a donor never asks for it.
  const list = useDonorView(user?.kind === "employee" ? code : null, asked).data;
  if (!user) return null;
  const withDonor = asked ? `?donor=${encodeURIComponent(asked)}` : "";
  const r = data?.report;
  const annual = r?.period.kind === "annual";
  const cols = ["minmax(14rem,2fr)", "6rem", "6rem", ...(r?.rows[0]?.parts.map(() => "6rem") ?? []), "7rem", "7rem"].join(" ");
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {list && <PreviewNote view={list} onPick={(id) => router.replace(`/progress/released/${slug}?donor=${encodeURIComponent(id)}`)} />}
        <Link href={`/progress/released${withDonor}`} className="text-sm font-semibold text-forest hover:underline">
          ← {tx("Reports")}
        </Link>
        {error && (
          <p role="alert" className="mt-6 rounded-xl bg-sunken px-4 py-3 text-sm">
            {error}
          </p>
        )}
        {!data && !error && <p className="mt-6 text-sm text-muted">{tx("Loading…")}</p>}
        {r && (
          <>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-warn">{r.project.donor ?? ""}</p>
            <h1 className="mt-1 font-display text-3xl tracking-tight sm:text-4xl">{r.project.name}</h1>
            <p className="mt-1 text-lg">
              {r.label}, {longDate(r.range.from)} to {longDate(r.range.to)}
            </p>
            <p className="mt-2 text-sm text-muted">{tx("Released by Roots of Peace on {date}. This is the report as it was released.", { date: longDay(r.releasedAt) })}</p>

            <div className="mt-6 overflow-x-auto">
              <LedgerTable
                cols={cols}
                label={tx("Indicators")}
                className="mt-0 min-w-[45rem] text-sm"
                head={[tx("Indicator"), { label: tx("Baseline"), end: true }, { label: tx("Target"), end: true }, ...(r.rows[0]?.parts.map((x) => ({ label: x.label, end: true })) ?? []), { label: tx("Achieved"), end: true }, ""]}
              >
                {r.rows.map((row) => (
                  <LedgerRow key={row.code} cols={cols}>
                    <span className="min-w-0">
                      <span className="font-mono text-xs text-muted">{row.donorCode}</span> {row.name} <span className="text-xs text-muted">({row.unit})</span>
                    </span>
                    <Fig>{n(row.baseline)}</Fig>
                    <Fig>{n(row.target)}</Fig>
                    {row.parts.map((x) => (
                      <Fig key={x.label} tone="muted">
                        {n(x.value)}
                      </Fig>
                    ))}
                    <span className="text-end font-mono text-sm font-semibold tabular-nums">
                      {row.note?.achieved ? <span className="font-sans text-xs text-clay">{tx(row.note.achieved)}</span> : n(row.achieved)}
                      {row.pct !== null && <span className="block text-xs font-normal text-muted">{row.pct}%</span>}
                    </span>
                    <span>
                      <StatusBlock tone={VERDICT[row.verdict].tone}>{tx(VERDICT[row.verdict].text)}</StatusBlock>
                    </span>
                  </LedgerRow>
                ))}
              </LedgerTable>
            </div>
            <p className="mt-2 text-xs text-muted">{annual ? tx("Targets are for the year.") : tx("Targets are for the life of the project.")}</p>

            {r.narrative.length > 0 && (
              <section className="mt-10">
                <SectionHead className="mt-0">{tx("From the quarterly reports")}</SectionHead>
                <div className="mt-3 border-t border-ink">
                  {r.narrative.map((sec) => (
                    <details key={sec.heading} className="border-b border-line px-3">
                      <summary className="min-h-12 cursor-pointer py-3 font-ledger text-base font-bold">{sec.heading}</summary>
                      {sec.parts.map((x) => (
                        <div key={x.quarter} className="mb-3">
                          <p className="font-mono text-xs font-semibold text-muted">{x.quarter.replace("-", " ")}</p>
                          <p className="whitespace-pre-line text-sm">{x.text}</p>
                        </div>
                      ))}
                    </details>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-10">
              <SectionHead className="mt-0">{tx("Lessons learned")}</SectionHead>
              {r.lessons.length === 0 ? (
                <Empty>{tx("None recorded for the period.")}</Empty>
              ) : (
                <LedgerTable cols={`2.25rem ${LESSON_COLS}`} label={tx("Lessons learned")} className="mt-3 text-sm" head={["#", tx("Area"), tx("Date"), tx("Lesson and what we will do")]}>
                  {r.lessons.map((l, i) => (
                    <LedgerRow key={l.id} n={i + 1} cols={LESSON_COLS}>
                      <span className="font-semibold">{l.area}</span>
                      <Fig tone="muted" className="text-start">
                        {l.date}
                      </Fig>
                      <span className="min-w-0">
                        {l.lesson} <span className="text-muted">{tx("We will: {action}.", { action: l.action })}</span>
                      </span>
                    </LedgerRow>
                  ))}
                </LedgerTable>
              )}
            </section>

            {r.spend && (
              <section className="mt-10">
                <SectionHead className="mt-0">{tx("Spending")}</SectionHead>
                <Figures
                  className="mt-3"
                  items={[
                    { label: tx("Budget"), value: `${r.spend.currency} ${n(r.spend.budget)}` },
                    { label: tx("Spent"), value: `${r.spend.currency} ${n(r.spend.cumulative)}` },
                    { label: tx("Of the budget"), value: `${r.spend.budget ? Math.round((r.spend.cumulative / r.spend.budget) * 100) : 0}%` },
                  ]}
                />
                {r.spend.withOverhead && <p className="mt-2 text-xs text-muted">{tx("Overhead included.")}</p>}
              </section>
            )}

            {r.photos.length > 0 && (
              <section className="mt-10">
                <SectionHead className="mt-0">{tx("Photos")}</SectionHead>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {r.photos.map((p) => (
                    <AccountPhoto key={p.hash} src={`/api/projects/${encodeURIComponent(project.id)}/donor-view/${slug}/photo/${p.hash}`} caption={p.caption} size="grid" user={user.id} />
                  ))}
                </div>
              </section>
            )}

            <p className="mt-12 border-t border-line pt-4 text-xs text-muted">
              {tx("Nobody is named in this report. Attendance sheets and other documents with personal details are not opened from this page: Roots of Peace provides them on request.")}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
