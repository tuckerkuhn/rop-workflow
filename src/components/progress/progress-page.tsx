"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { DonorFilter, useDonorChoice } from "@/components/app/donor-filter";
import { useT } from "@/components/app/i18n";
import { useRequireUser } from "@/components/app/session";
import { useProgress, useWorkItems } from "@/components/app/use-project-data";
import { ReportView } from "@/components/progress/report-view";
import { Pill, SectionLabel, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { isImpact, missingData, reportPeriod, type DonorInfo, type IndicatorProgress, type ProgressData } from "@/lib/progress";
import { formatById, reportCsv, reportHtml, type ReportDoc } from "@/lib/report-formats";
import type { WorkItem } from "@/lib/work-items";

/**
 * Progress: what the project has achieved against its indicators, and the donor report built
 * from the same numbers. Values come from accepted records (Kobo submissions); nothing is typed in here.
 */
export function ProgressPage() {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const { t, date } = useT();
  const progress = useProgress(project.id);
  const work = useWorkItems(project.id);
  const donors = progress.data?.donors ?? [];
  const { donor, setDonor } = useDonorChoice(project.id, donors);
  const [exporting, setExporting] = useState(false);
  const closeExport = useCallback(() => setExporting(false), []);

  if (!user) return null;
  const data = progress.data;
  // A donor's view covers the indicators it tracks.
  const tracked = (data?.indicators ?? []).filter((i) => !donor || !Object.keys(donor.indicatorRefs).length || i.code in donor.indicatorRefs);
  // Donors see the numbers; the report itself reaches them only once Roots of Peace releases it.
  const staff = user.kind === "employee";
  const doc = staff && data && tracked.length ? buildReport(data, donor, tracked, work.items, t, (iso) => date(iso, { day: "numeric", month: "short", year: "numeric" })) : null;

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 font-display text-4xl tracking-tight">{t("progress.title")}</h1>
          {doc && (
            <button type="button" onClick={() => setExporting(true)} className={`${primaryBtn} px-5 py-2.5`}>
              {t("progress.export")}
            </button>
          )}
        </div>
        <div className="mt-3">
          <DonorFilter donors={donors} donor={donor} onChange={setDonor} />
        </div>

        {progress.status === "loading" && <p className="py-16 text-center text-sm text-muted">{t("progress.loading")}</p>}
        {progress.error && (
          <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {t("progress.loadError", { error: progress.error })}
          </p>
        )}
        {data && !data.saved && <p className="mt-6 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">{t("progress.notSaved")}</p>}
        {data?.saved && tracked.length === 0 && <p className="py-16 text-center text-sm text-muted">{t("progress.empty")}</p>}

        {data && tracked.length > 0 && (
          <>
            {[
              { key: "impact", label: t("progress.impact"), list: tracked.filter(isImpact) },
              { key: "outputs", label: t("progress.outputs"), list: tracked.filter((i) => !isImpact(i)) },
            ]
              .filter((g) => g.list.length)
              .map((g) => (
                <section key={g.key} className="mt-8" aria-labelledby={`ind-${g.key}`}>
                  <span id={`ind-${g.key}`}>
                    <SectionLabel>{g.label}</SectionLabel>
                  </span>
                  <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                    {g.list.map((i) => (
                      <IndicatorCard key={i.code} i={i} donorCode={donor?.indicatorRefs[i.code]} />
                    ))}
                  </ul>
                </section>
              ))}

            {doc && (
              <section className="mt-10">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-display text-2xl">{t("progress.report")}</h2>
                  <span className="text-sm text-muted">{t(formatById(donor?.reportFormat).label)}</span>
                </div>
                <div className="mt-3">
                  <ReportView doc={doc} />
                </div>
              </section>
            )}
          </>
        )}

        {staff && (
          <p className="mt-10 border-t border-line pt-4 text-sm">
            <Link href="/progress/records" className="font-semibold text-forest hover:underline">
              {t("progress.records")} →
            </Link>
          </p>
        )}
      </main>
      {exporting && doc && data && <ExportSheet doc={doc} name={fileName(data, donor)} donor={donor} onClose={closeExport} />}
    </div>
  );
}

function IndicatorCard({ i, donorCode }: { i: IndicatorProgress; donorCode?: string }) {
  const { t, date } = useT();
  const pct = i.total === null || !i.target ? 0 : Math.min(100, Math.round((i.total / i.target) * 100));
  const missing = missingData(i);
  return (
    <li className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium leading-snug">{i.name}</h3>
        <span className="shrink-0 font-mono text-[11px] text-muted">{donorCode || i.code}</span>
      </div>
      <p className="mt-3 flex items-baseline gap-2">
        <span className="font-display text-4xl tabular-nums">{i.total ?? "—"}</span>
        <span className="text-sm text-muted">{t("progress.ofTarget", { target: i.target, unit: i.unit })}</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div className={`h-full rounded-full ${pct >= 100 ? "bg-leaf" : "bg-forest"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {i.frequency === "end_of_season" ? (
          <span className="text-muted">{t("progress.endOfSeason")}</span>
        ) : missing ? (
          <span className="font-semibold text-clay">{t("progress.noData")}</span>
        ) : (
          <span className="text-forest">{t("progress.thisPeriod", { n: i.period ?? 0 })}</span>
        )}
        {i.pending > 0 && <span className="text-ochre">{t("progress.pending", { n: i.pending })}</span>}
        {i.lastDate && <span className="text-muted">{t("progress.last", { date: date(i.lastDate) })}</span>}
      </p>
    </li>
  );
}

/** Milestones for the report: the donor's own deadlines and project milestones, in the period and just after it. */
function reportMilestones(items: WorkItem[], donor: DonorInfo | null, from: string, to: string) {
  const ms = items
    .filter((w) => w.type === "milestone" && w.date && (!w.donorId || !donor || w.donorId === donor.id))
    .filter((w) => (w.endDate ?? w.date!) >= from)
    .sort((a, b) => a.date!.localeCompare(b.date!));
  const inPeriod = ms.filter((w) => w.date! <= to);
  const after = ms.filter((w) => w.date! > to).slice(0, 3);
  const fromItems = [...inPeriod, ...after].map((w) => ({ title: w.title, date: w.date!, end: w.endDate, kind: w.milestoneKind! }));
  // Donors cannot read Tasks, so their report lists their own deadlines.
  return fromItems.length ? fromItems : (donor?.deadlines ?? []).filter((d) => d.date >= from).map((d) => ({ title: d.title, date: d.date, end: null, kind: "report_deadline" as const }));
}

function buildReport(data: ProgressData, donor: DonorInfo | null, tracked: IndicatorProgress[], items: WorkItem[], t: ReturnType<typeof useT>["t"], date: (iso: string) => string): ReportDoc {
  const period = reportPeriod(donor, data.today, data.project.startDate);
  const values = data.reports.find((r) => r.donorId === (donor?.id ?? null))?.values ?? {};
  return formatById(donor?.reportFormat).build({
    project: data.project,
    donor,
    period,
    indicators: tracked,
    periodValues: values,
    milestones: reportMilestones(items, donor, period.from, period.to),
    preparedOn: data.today,
    t,
    date,
  });
}

const fileName = (data: ProgressData, donor: DonorInfo | null) =>
  `${data.project.code}-${(donor?.name ?? "all-donors").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-report-${data.today}`;

/** Choose how to save the donor's report: print to PDF, Word, or a spreadsheet. */
function ExportSheet({ doc, name, donor, onClose }: { doc: ReportDoc; name: string; donor: DonorInfo | null; onClose: () => void }) {
  const { t, lang, dir } = useT();

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  // CSV starts with a byte order mark so Excel reads accents and Dari/Pashto script correctly.
  const save = (body: string, type: string, ext: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type }));
    a.download = `${name}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
    onClose();
  };
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(reportHtml(doc, lang, dir));
    w.document.close();
    w.focus();
    w.print();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-paper p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-w-sm sm:rounded-2xl sm:border sm:border-line"
      >
        <h2 id="export-title" className="font-display text-2xl">
          {t("progress.export")}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {donor?.name ?? t("donor.all")} · <Pill tone="muted">{t(formatById(donor?.reportFormat).label)}</Pill>
        </p>
        <div className="mt-5 grid gap-2">
          <button type="button" onClick={print} className={primaryBtn}>
            {t("progress.pdf")}
          </button>
          <button type="button" onClick={() => save(reportHtml(doc, lang, dir), "application/msword", "doc")} className={quietBtn}>
            {t("progress.word")}
          </button>
          <button type="button" onClick={() => save(`\ufeff${reportCsv(doc)}`, "text/csv;charset=utf-8", "csv")} className={quietBtn}>
            {t("progress.csv")}
          </button>
          <button type="button" onClick={onClose} className="mt-1 py-2 text-sm text-muted hover:text-ink">
            {t("settings.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
