"use client";

import Link from "next/link";
import { askConfirm } from "@/components/app/dialogs";
import { useT } from "@/components/app/i18n";
import { askForChecks, beforeDownload, PreflightButton, usePreflightState } from "@/components/progress/preflight-page";
import { ReportChecks, ReportKinds } from "@/components/progress/report-checks";
import { ProofNumber } from "@/components/progress/proof-panel";
import { useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { Empty, Fig, Figures, LedgerRow, LedgerTable, PageHead, SectionHead, StatusBlock } from "@/components/workspace/ledger";
import { periodLabel, type Period } from "@/lib/period-report";
import { personName } from "@/lib/project";
import { YOUTH } from "@/lib/results";
import type { PeriodView } from "@/app/api/projects/[code]/period-report/route";
import type { PeriodReportView } from "@/server/period-report-store";

/**
 * The annual and final reports: the indicator table for the period with baselines and links to
 * evidence, women, men and young people, the quarters' narrative gathered by section, lessons and
 * spending. Download as Word to edit, or print to PDF. The person who releases reports releases it
 * to the donor, as a quarterly report is released: from then on this page shows the frozen copy.
 */

const n = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 1 }));
const VERDICT = { met: { tone: "forest", text: "Met" }, partly: { tone: "ochre", text: "Partly" }, not_met: { tone: "clay", text: "Not met" }, no_target: { tone: "muted", text: "No target" } } as const;

export function PeriodReportPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const thisYear = new Date().getFullYear();
  const { t } = useT();
  const [period, setPeriod] = useState<Period>({ kind: "annual", year: thisYear });
  // A link may ask for a year (?year=2026), as the report check's old address did.
  useEffect(() => {
    const y = Number(new URLSearchParams(window.location.search).get("year"));
    if (y > 2000 && y <= thisYear) setPeriod({ kind: "annual", year: y });
  }, [thisYear]);
  const [v, setV] = useState<PeriodView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!ready || !user || !project.saved) return;
    let live = true;
    setV(null);
    setNotice("");
    fetch(`/api/projects/${project.id}/period-report?${queryOf(period)}`, { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not load the report.");
        if (live) setV(d);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [ready, user, project.saved, project.id, period]);
  // The annual report has a report check; once released it is history, not a to-do.
  const { p: pf, fresh: pfFresh, failed: pfFailed } = usePreflightState(project.id, user?.id, period.kind === "annual" && !v?.released ? { kind: "annual", year: period.year } : null, v);
  if (!user) return null;
  const blockN = pf ? pf.items.filter((i) => i.group === "blocks").length : 0;
  // Mark final only when the check was read after the latest change and nothing blocks. The final report has no check.
  const mayMarkFinal = period.kind === "final" || (pfFresh && blockN === 0);
  const release = async () => {
    const ok = await askConfirm({
      message: `Mark the ${periodLabel(period).toLowerCase()} final and release it to the donor? It is locked for good: this copy is what the donor receives. It appears in the donor's Reports tab. No email is sent: tell the donor yourself.`,
      confirm: "Mark final and release",
    });
    if (!ok) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const r = await fetch(`/api/projects/${project.id}/period-report?${queryOf(period)}`, { method: "POST", headers: { "x-demo-user": user.id, "content-type": "application/json" }, body: JSON.stringify({ action: "release" }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not release the report.");
      setV(d);
      setNotice("Released: the report is final and it is in the donor's Reports tab. It can no longer be changed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const startYear = Number((v?.project.start ?? `${thisYear}`).slice(0, 4));
  const years = Array.from({ length: Math.max(1, thisYear - startYear + 1) }, (_, k) => startYear + k);
  const download = async () => {
    if (!v) return;
    // A released report is downloaded as it was; a draft annual report goes through the report check first.
    const draft = period.kind === "annual" && !v.released ? await beforeDownload(project.id, user.id, pf, (n) => t("pf.draftConfirm", { n }), { kind: "annual", year: period.year }, t("pf.uncheckedConfirm")) : 0;
    if (draft === null) return;
    setBusy(true);
    try {
      const { periodDocx } = await import("@/lib/period-docx");
      const blob = await periodDocx(v, window.location.origin, draft);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${v.project.code}-${period.kind === "annual" ? `annual-${period.year}` : "final"}${draft ? "-DRAFT-not-checked" : ""}.docx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setBusy(false);
    }
  };
  const annual = period.kind === "annual";
  const rows = v ? v.rows.map((r) => indicatorCells(r, v, project.id, user.id)) : [];
  const met = v?.rows.filter((r) => r.verdict === "met").length ?? 0;
  // The indicator table's columns: the indicator, baseline and target, any parts of the period, achieved, cumulative (annual only), the verdict.
  const cols = ["minmax(14rem,2fr)", "6rem", "6rem", ...(v?.rows[0]?.parts.map(() => "6rem") ?? []), "7rem", ...(annual ? ["8rem"] : []), "7rem"].join(" ");
  const people = v ? v.rows.filter((r) => r.women + r.men > 0) : [];

  return (
    <div className="min-h-screen">
      <div className="print:hidden">
        <TopBar />
      </div>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 print:max-w-none print:p-0">
        <ReportKinds kind="annual" />
        <div className="mt-5">
          <PageHead
            kicker={project.name}
            title={periodLabel(period)}
            meta={v ? `${v.range.from} to ${v.range.to}` : undefined}
            actions={
              <div className="flex flex-wrap gap-2 print:hidden">
                <select
                  aria-label="Report"
                  value={annual ? String(period.year) : "final"}
                  onChange={(e) => setPeriod(e.target.value === "final" ? { kind: "final" } : { kind: "annual", year: Number(e.target.value) })}
                  className="min-h-11 border border-line bg-paper px-3 font-mono text-sm"
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      Annual {y}
                    </option>
                  ))}
                  <option value="final">Final (whole project)</option>
                </select>
                {period.kind === "annual" && !v?.released && <PreflightButton p={pf} report={{ kind: "annual", year: period.year }} className={quietBtn} />}
                <button type="button" className={primaryBtn} disabled={!v || busy} onClick={() => void download()}>
                  Download Word
                </button>
                <button type="button" className={quietBtn} disabled={!v} onClick={() => window.print()}>
                  Save as PDF
                </button>
                {v?.mayRelease && (
                  <button
                    type="button"
                    className={primaryBtn}
                    disabled={busy || !mayMarkFinal}
                    title={period.kind === "annual" && !blockN && !pfFresh ? (pfFailed ? t("pf.notLoaded") : t("pf.rechecking")) : undefined}
                    onClick={() => void release()}
                  >
                    Mark final and release to the donor{blockN ? ` (${blockN} blocking)` : ""}
                  </button>
                )}
                {/* Why it cannot be marked final, in the page: a hover title never shows on a phone. */}
                {v?.mayRelease && blockN > 0 && (
                  <p className="basis-full text-sm text-clay">
                    {blockN === 1 ? t("report.blockedOne") : t("report.blocked", { n: blockN })}{" "}
                    <a href="#checks" onClick={askForChecks} className="font-semibold underline">
                      {t("pf.button")}
                    </a>
                  </p>
                )}
              </div>
            }
          >
            Figures are from results MEL accepted; each achieved figure opens the records behind it.
          </PageHead>
        </div>
        {v && (
          <div className="mt-4 flex flex-wrap items-center gap-2 font-ledger">
            {v.released ? (
              <StatusBlock tone="forest">
                Released {v.released.at.slice(0, 10)} by {personName(v.released.by)}
              </StatusBlock>
            ) : (
              <StatusBlock tone="ochre">Draft · not released to the donor</StatusBlock>
            )}
          </div>
        )}
        {v?.released && (
          <p className="mt-3 border-y border-ink px-3 py-3 text-sm font-semibold">This is the report as released on {v.released.at.slice(0, 10)}: what the donor received. It stays as it was.</p>
        )}
        {annual && !v?.released && <ReportChecks p={pf} />}
        {error && <p className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {notice && (
          <p role="status" className="mt-4 bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}
        {!v && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {v && (
          <>
            <p className="mt-5 font-ledger text-lg">
              <Fig strong>{met}</Fig> of <Fig strong>{v.rows.length}</Fig> targets met {annual ? "for the year" : "for the life of the project"}
              {v.open ? `; ${v.open} ${v.open === 1 ? "result" : "results"} from the period ${v.open === 1 ? "is" : "are"} still waiting for MEL and not counted` : ""}.
            </p>
            {v.changed.length > 0 && (
              <div id="changed" className="mt-4 scroll-mt-24 border border-clay/40 bg-clay-soft px-4 py-3 text-sm">
                <p className="font-semibold text-clay">
                  {v.changed.length === 1 ? "1 figure no longer matches" : `${v.changed.length} figures no longer match`} what a released quarterly report sent the donor
                </p>
                <ul className="mt-1 border-t border-clay/40">
                  {v.changed.map((x) => (
                    <li key={`${x.code}-${x.quarter}`} className="border-b border-clay/40 py-1">
                      <span className="font-mono text-xs">{x.donorCode}</span>, <span className="font-mono text-xs">{x.quarter.replace("-", " ")}</span>: <span className="font-mono tabular-nums">{x.then.toLocaleString("en-US")}</span> sent, <span className="font-mono tabular-nums">{x.now.toLocaleString("en-US")}</span> in the records now.{" "}
                      <Link href={`/progress/results?indicator=${x.code}&q=${x.quarter}`} className="inline-flex min-h-11 items-center font-semibold text-forest underline">
                        See the records
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-muted">This table uses the records as they are now. Say why each changed in the report, or put the record back if the change was a mistake.</p>
              </div>
            )}
            {/* Below a medium screen: one block per indicator, stacked, so nothing scrolls sideways on a phone. Print keeps the table. */}
            <ul aria-label="Indicators" className="mt-4 divide-y divide-line border-y border-ink md:hidden print:hidden">
              {rows.map((c) => (
                <IndicatorCard key={c.r.code} c={c} annual={annual} />
              ))}
            </ul>
            <div className="mt-4 hidden overflow-x-auto md:block print:block print:overflow-visible">
              <LedgerTable
                cols={cols}
                label="Indicators"
                className="mt-0 min-w-[45rem] text-sm"
                head={[
                  "Indicator",
                  { label: "Baseline", end: true },
                  { label: "Target", end: true },
                  ...(v.rows[0]?.parts.map((x) => ({ label: x.label, end: true })) ?? []),
                  { label: "Achieved", end: true },
                  ...(annual ? [{ label: "Cumulative / life", end: true }] : []),
                  "",
                ]}
              >
                {rows.map((c) => (
                  <IndicatorTableRow key={c.r.code} c={c} annual={annual} cols={cols} />
                ))}
              </LedgerTable>
            </div>
            {v.rows.some((r) => r.baseline === null) && (
              <p className="mt-2 text-xs text-muted">
                {t("td.baselineMissing")}{" "}
                <Link href="/progress/targets" className="font-semibold text-forest hover:underline">
                  {t("td.title")}
                </Link>
              </p>
            )}

            {people.length > 0 && (
              <section className="mt-10">
                <SectionHead className="mt-0">Women, men and young people</SectionHead>
                <p className="mt-1 text-xs text-muted">
                  {YOUTH.label}: {YOUTH.source}.
                </p>
                <div className="overflow-x-auto print:overflow-visible">
                  <LedgerTable cols={PEOPLE_COLS} label="Women, men and young people" className="mt-2 min-w-[32rem] text-sm" head={["Indicator", { label: "Women", end: true }, { label: "Men", end: true }, { label: "Young people", end: true }]}>
                    {people.map((r) => (
                      <LedgerRow key={r.code} cols={PEOPLE_COLS}>
                        <span className="min-w-0">
                          <span className="font-mono text-xs text-muted">{r.donorCode}</span> {r.name}
                        </span>
                        <Fig>{n(r.women)}</Fig>
                        <Fig>{n(r.men)}</Fig>
                        {r.youth ? <Fig>{n(r.youth)}</Fig> : <span className="text-end text-xs text-muted">Not recorded</span>}
                      </LedgerRow>
                    ))}
                  </LedgerTable>
                </div>
              </section>
            )}

            <section className="mt-10">
              <SectionHead className="mt-0">Narrative from the quarters</SectionHead>
              <p className="mt-1 text-sm text-muted">
                What each quarterly report said, by section, to condense into the {annual ? "annual" : "final"} story. Quarters without a saved report: {v.quarters.length ? "none missing" : "all"}.
              </p>
              {v.narrative.length === 0 && <Empty>No quarterly report text saved for the period.</Empty>}
              {v.narrative.length > 0 && (
                <div className="mt-3 border-t border-ink [&>*:last-child]:border-ink">
                  {v.narrative.map((sec) => (
                    <details key={sec.key} className="border-b border-line px-3 print:block" open={sec.key === "summary"}>
                      <summary className="min-h-12 cursor-pointer py-3 font-ledger text-base font-bold">
                        {sec.heading} <span className="font-mono text-sm font-normal text-muted">({sec.parts.length})</span>
                      </summary>
                      {sec.parts.map((x) => (
                        <div key={x.quarter} className="mb-3">
                          <p className="font-mono text-xs font-semibold text-muted">
                            {x.quarter.replace("-", " ")}
                            {x.released ? "" : " (draft)"}
                          </p>
                          <p className="whitespace-pre-line text-sm">{x.text}</p>
                        </div>
                      ))}
                    </details>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-10">
              <SectionHead className="mt-0">Lessons learned</SectionHead>
              {v.lessons.length === 0 ? (
                <Empty>
                  None recorded for the period.{" "}
                  <Link href="/progress/learning" className="font-semibold text-forest hover:underline print:hidden">
                    Record lessons
                  </Link>
                </Empty>
              ) : (
                <LedgerTable cols={`2.25rem ${LESSON_COLS}`} label="Lessons learned" className="mt-3 text-sm" head={["#", "Area", "Date", "Lesson and what we will do"]}>
                  {v.lessons.map((l, i) => (
                    <LedgerRow key={l.id} n={i + 1} cols={LESSON_COLS}>
                      <span className="font-semibold">{l.area}</span>
                      <Fig tone="muted" className="text-start">
                        {l.date}
                      </Fig>
                      <span className="min-w-0">
                        {l.lesson} <span className="text-muted">We will: {l.action}.</span>
                      </span>
                    </LedgerRow>
                  ))}
                </LedgerTable>
              )}
            </section>

            {v.spend && (
              <section className="mt-10">
                <SectionHead className="mt-0">Spending</SectionHead>
                <Figures
                  className="mt-3"
                  items={[
                    { label: "Budget", value: `${v.spend.currency} ${n(v.spend.budget)}` },
                    { label: "Spent", value: `${v.spend.currency} ${n(v.spend.cumulative)}` },
                    { label: "Of the budget", value: `${v.spend.budget ? Math.round((v.spend.cumulative / v.spend.budget) * 100) : 0}%` },
                  ]}
                />
                {v.spend.withOverhead && <p className="mt-2 text-xs text-muted">Overhead included.</p>}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

const PEOPLE_COLS = "minmax(0,1fr) 6rem 6rem 7rem";
const queryOf = (p: Period) => (p.kind === "annual" ? `kind=annual&year=${p.year}` : "kind=final");
const LESSON_COLS = "minmax(6rem,1fr) 7rem minmax(0,3fr)";

type Row = PeriodReportView["rows"][number];
/** One indicator's figures, worked out once and shown either as a table row or as a stacked block on a phone. */
type Cells = { r: Row; name: React.ReactNode; achieved: React.ReactNode; cumulative: React.ReactNode; verdict: React.ReactNode };

function indicatorCells(r: Row, v: PeriodReportView, project: string, user: string): Cells {
  return {
    r,
    name: (
      <>
        <span className="font-mono text-xs text-muted">{r.donorCode}</span> {r.name} <span className="text-xs text-muted">({r.unit})</span>
      </>
    ),
    achieved: (
      <ProofNumber project={project} user={user} indicator={r.code} from={v.range.from} to={v.range.to} value={r.achieved} records={r.records} className="font-semibold tabular-nums">
        {n(r.achieved)}
      </ProofNumber>
    ),
    cumulative: (
      <>
        <ProofNumber project={project} user={user} indicator={r.code} from={null} to={v.range.to} value={r.cumulative} records={r.cumulative ? 1 : 0} className="tabular-nums">
          {n(r.cumulative)}
        </ProofNumber>{" "}
        / {n(r.lifeTarget)}
      </>
    ),
    verdict: <StatusBlock tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].text}</StatusBlock>,
  };
}

/** The small mono label over each figure when a row is shown as a stacked block on a phone. */
const label = "font-mono text-xs text-muted";

function IndicatorCard({ c, annual }: { c: Cells; annual: boolean }) {
  const { r } = c;
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 font-ledger text-sm">{c.name}</h3>
        {c.verdict}
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 font-mono text-sm tabular-nums">
        <div>
          <dt className={label}>Baseline</dt>
          <dd>{n(r.baseline)}</dd>
        </div>
        <div>
          <dt className={label}>Target</dt>
          <dd>{n(r.target)}</dd>
        </div>
        <div>
          <dt className={label}>Achieved</dt>
          <dd className="font-semibold">{c.achieved}</dd>
          {r.pct !== null && <dd className="text-xs text-muted">{r.pct}%</dd>}
        </div>
        {r.parts.map((x) => (
          <div key={x.label}>
            <dt className={label}>{x.label}</dt>
            <dd className="text-muted">{n(x.value)}</dd>
          </div>
        ))}
        {annual && (
          <div className="col-span-2">
            <dt className={label}>Cumulative / life</dt>
            <dd className="text-muted">{c.cumulative}</dd>
          </div>
        )}
      </dl>
    </li>
  );
}

function IndicatorTableRow({ c, annual, cols }: { c: Cells; annual: boolean; cols: string }) {
  const { r } = c;
  return (
    <LedgerRow cols={cols}>
      <span className="min-w-0">{c.name}</span>
      <Fig>{n(r.baseline)}</Fig>
      <Fig>{n(r.target)}</Fig>
      {r.parts.map((x) => (
        <Fig key={x.label} tone="muted">
          {n(x.value)}
        </Fig>
      ))}
      <span className="text-end font-mono text-sm font-semibold tabular-nums">
        {c.achieved}
        {r.pct !== null && <span className="block text-xs font-normal text-muted">{r.pct}%</span>}
      </span>
      {annual && <span className="text-end font-mono text-sm tabular-nums text-muted">{c.cumulative}</span>}
      <span>{c.verdict}</span>
    </LedgerRow>
  );
}
