"use client";

import Link from "next/link";
import { useT } from "@/components/app/i18n";
import { beforeDownload, PreflightButton, usePreflight } from "@/components/progress/preflight-page";
import { ProofNumber } from "@/components/progress/proof-panel";
import { useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { periodLabel, type Period } from "@/lib/period-report";
import { YOUTH } from "@/lib/results";
import type { PeriodReportView } from "@/server/period-report-store";

/**
 * The annual and final reports: the indicator table for the period with baselines and links to
 * evidence, women, men and young people, the quarters' narrative gathered by section, lessons and
 * spending. Download as Word to edit, or print to PDF.
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
  const [v, setV] = useState<PeriodReportView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!ready || !user || !project.saved) return;
    let live = true;
    setV(null);
    const q = period.kind === "annual" ? `kind=annual&year=${period.year}` : "kind=final";
    fetch(`/api/projects/${project.id}/period-report?${q}`, { cache: "no-store", headers: { "x-demo-user": user.id } })
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
  const pf = usePreflight(project.id, user?.id, period.kind === "annual" ? { kind: "annual", year: period.year } : null, v);
  if (!user) return null;
  const startYear = Number((v?.project.start ?? `${thisYear}`).slice(0, 4));
  const years = Array.from({ length: Math.max(1, thisYear - startYear + 1) }, (_, k) => startYear + k);
  const download = async () => {
    if (!v) return;
    const draft = period.kind === "annual" ? await beforeDownload(project.id, user.id, pf, (n) => t("pf.draftConfirm", { n }), { kind: "annual", year: period.year }, t("pf.uncheckedConfirm")) : 0;
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
  const met = v?.rows.filter((r) => r.verdict === "met").length ?? 0;

  return (
    <div className="min-h-screen">
      <div className="print:hidden">
        <TopBar />
      </div>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 print:max-w-none print:p-0">
        <Link href="/progress" className="text-sm text-muted hover:text-ink print:hidden">
          ← Progress
        </Link>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <h1 className="flex-1 font-display text-4xl tracking-tight">{periodLabel(period)}</h1>
          <div className="flex flex-wrap gap-2 print:hidden">
            <select
              aria-label="Report"
              value={annual ? String(period.year) : "final"}
              onChange={(e) => setPeriod(e.target.value === "final" ? { kind: "final" } : { kind: "annual", year: Number(e.target.value) })}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  Annual {y}
                </option>
              ))}
              <option value="final">Final (whole project)</option>
            </select>
            {period.kind === "annual" && <PreflightButton p={pf} report={{ kind: "annual", year: period.year }} className={quietBtn} />}
            <button type="button" className={primaryBtn} disabled={!v || busy} onClick={() => void download()}>
              Download Word
            </button>
            <button type="button" className={quietBtn} disabled={!v} onClick={() => window.print()}>
              Save as PDF
            </button>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted">
          {project.name}
          {v ? ` · ${v.range.from} to ${v.range.to}` : ""}. Figures are from results MEL accepted; each achieved figure opens the records behind it.
        </p>
        {error && <p className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {!v && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {v && (
          <>
            <p className="mt-4 text-lg">
              {met} of {v.rows.length} indicators met their {annual ? "targets for the year" : "life-of-project targets"}
              {v.open ? `; ${v.open} ${v.open === 1 ? "result" : "results"} from the period ${v.open === 1 ? "is" : "are"} still waiting for MEL and not counted` : ""}.
            </p>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-surface print:overflow-visible">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-sunken text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">Indicator</th>
                    <th className="px-2 py-2 text-right">Baseline</th>
                    <th className="px-2 py-2 text-right">Target</th>
                    {v.rows[0]?.parts.map((x) => (
                      <th key={x.label} className="px-2 py-2 text-right">
                        {x.label}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right">Achieved</th>
                    {annual && <th className="px-2 py-2 text-right">Cumulative / life</th>}
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {v.rows.map((r) => (
                    <tr key={r.code} className="align-top">
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs text-muted">{r.donorCode}</span> {r.name} <span className="text-xs text-muted">({r.unit})</span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{n(r.baseline)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{n(r.target)}</td>
                      {r.parts.map((x) => (
                        <td key={x.label} className="px-2 py-2 text-right tabular-nums text-muted">
                          {x.value ? n(x.value) : "—"}
                        </td>
                      ))}
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">
                        <ProofNumber project={project.id} user={user.id} indicator={r.code} from={v.range.from} to={v.range.to} value={r.achieved} records={r.records} className="font-semibold tabular-nums">
                          {n(r.achieved)}
                        </ProofNumber>
                        {r.pct !== null && <span className="block text-xs font-normal text-muted">{r.pct}%</span>}
                      </td>
                      {annual && (
                        <td className="px-2 py-2 text-right tabular-nums text-muted">
                          <ProofNumber project={project.id} user={user.id} indicator={r.code} from={null} to={v.range.to} value={r.cumulative} records={r.cumulative ? 1 : 0} className="tabular-nums">
                            {n(r.cumulative)}
                          </ProofNumber>{" "}
                          / {n(r.lifeTarget)}
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <Pill tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].text}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {v.rows.some((r) => r.baseline === null) && (
              <p className="mt-2 text-xs text-muted">
                {t("td.baselineMissing")}{" "}
                <Link href="/progress/targets" className="font-semibold text-forest hover:underline">
                  {t("td.title")}
                </Link>
              </p>
            )}

            {v.rows.some((r) => r.women + r.men > 0) && (
              <section className="mt-8">
                <h2 className="font-display text-2xl">Women, men and young people</h2>
                <p className="text-xs text-muted">
                  {YOUTH.label}: {YOUTH.source}.
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {v.rows
                    .filter((r) => r.women + r.men > 0)
                    .map((r) => (
                      <li key={r.code}>
                        <span className="font-mono text-xs text-muted">{r.donorCode}</span> {r.name}: {n(r.women)} women, {n(r.men)} men{r.youth ? `, ${n(r.youth)} young people` : ", young people not recorded"}
                      </li>
                    ))}
                </ul>
              </section>
            )}

            <section className="mt-8">
              <h2 className="font-display text-2xl">Narrative from the quarters</h2>
              <p className="text-sm text-muted">
                What each quarterly report said, by section, to condense into the {annual ? "annual" : "final"} story. Quarters without a saved report: {v.quarters.length ? "none missing" : "all"}.
              </p>
              {v.narrative.length === 0 && <p className="mt-2 text-sm text-muted">No quarterly report text saved for the period.</p>}
              {v.narrative.map((sec) => (
                <details key={sec.key} className="mt-3 rounded-xl border border-line bg-surface p-3 print:block" open={sec.key === "summary"}>
                  <summary className="cursor-pointer text-sm font-semibold">
                    {sec.heading} <span className="font-normal text-muted">({sec.parts.length})</span>
                  </summary>
                  {sec.parts.map((x) => (
                    <div key={x.quarter} className="mt-2">
                      <p className="text-xs font-semibold text-muted">
                        {x.quarter.replace("-", " ")}
                        {x.released ? "" : " (draft)"}
                      </p>
                      <p className="whitespace-pre-line text-sm">{x.text}</p>
                    </div>
                  ))}
                </details>
              ))}
            </section>

            <section className="mt-8">
              <h2 className="font-display text-2xl">Lessons learned</h2>
              {v.lessons.length === 0 ? (
                <p className="text-sm text-muted">
                  None recorded for the period.{" "}
                  <Link href="/progress/learning" className="font-semibold text-forest hover:underline print:hidden">
                    Record lessons
                  </Link>
                </p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {v.lessons.map((l) => (
                    <li key={l.id}>
                      <span className="font-semibold">
                        {l.area}, {l.date}:
                      </span>{" "}
                      {l.lesson} <span className="text-muted">We will: {l.action}.</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {v.spend && (
              <section className="mt-8">
                <h2 className="font-display text-2xl">Spending</h2>
                <p className="text-sm">
                  Budget {v.spend.currency} {n(v.spend.budget)}; spent {v.spend.currency} {n(v.spend.cumulative)} ({v.spend.budget ? Math.round((v.spend.cumulative / v.spend.budget) * 100) : 0}%){v.spend.withOverhead ? ", overhead included" : ""}.
                </p>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
