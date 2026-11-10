"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { TopBar } from "@/components/workspace/ui";
import type { MessageKey } from "@/lib/i18n";
import { daysBetween, OWNERS, parseReport, periodOf, urgency, type Preflight, type PreflightItem, type ReportKind, type ReportRef, UNCHECKED } from "@/lib/preflight";
import { quarterOf } from "@/lib/results";

/**
 * Pre-flight: before a report is downloaded or released, everything that stands in its way, in
 * three groups (blocks, worth fixing, ready), each row one line with who acts and one tap to the
 * place to fix it. The same list Home's "Next report" shows (server/preflight).
 */

const today = () => new Date().toISOString().slice(0, 10);
const select = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2 text-base";

function periods(kind: ReportKind): string[] {
  const t = today();
  const y = Number(t.slice(0, 4));
  if (kind === "annual") return [y, y - 1, y - 2].map(String);
  if (kind === "face") return Array.from({ length: 12 }, (_, k) => new Date(Date.UTC(y, Number(t.slice(5, 7)) - 1 - k, 1)).toISOString().slice(0, 7));
  const q = quarterOf(t);
  const out: string[] = [];
  let [yy, qq] = [Number(q.slice(0, 4)), Number(q.slice(-1))];
  for (let k = 0; k < 6; k++) {
    out.push(`${yy}-Q${qq}`);
    qq--;
    if (!qq) [yy, qq] = [yy - 1, 4];
  }
  return out;
}
const defaultFor = (kind: ReportKind) => (kind === "annual" ? String(Number(today().slice(0, 4))) : periods(kind)[0]);

export function itemText(t: ReturnType<typeof useT>["t"], i: Pick<PreflightItem, "text" | "key" | "vars">) {
  return i.key ? t(i.key as MessageKey, i.vars) : i.text;
}

export function PreflightPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const { t, date } = useT();
  const params = useSearchParams();
  const router = useRouter();
  const report: ReportRef = parseReport(params.get("report"), params.get("period")) ?? { kind: "qpr", quarter: quarterOf(today()) };
  const [v, setV] = useState<Preflight | null>(null);
  const [error, setError] = useState("");
  const key = `${report.kind}:${periodOf(report)}`;

  useEffect(() => {
    if (!ready || !user) return;
    let live = true;
    setV(null);
    setError("");
    fetch(`/api/projects/${project.id}/preflight?report=${report.kind}&period=${periodOf(report)}`, { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!live) return;
        if (!r.ok) setError(d?.error ?? `Error ${r.status}`);
        else setV(d);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id, project.id, key]);

  const go = (kind: ReportKind, period: string) => router.replace(`/progress/preflight?report=${kind}&period=${period}`);
  const blocks = v?.items.filter((i) => i.group === "blocks") ?? [];
  const fix = v?.items.filter((i) => i.group === "fix") ?? [];
  const u = v ? urgency(v.deadline, today()) : null;
  const d = v?.deadline;

  const Row = ({ i }: { i: PreflightItem }) => (
    <li>
      <Link href={i.href} className="flex min-h-12 items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 hover:border-forest">
        <span className="flex-1 text-sm">{itemText(t, i)}</span>
        <span className="shrink-0 rounded-full bg-mist px-2 py-0.5 text-[11px] font-semibold text-muted">{t(`pf.owner.${i.owner}` as MessageKey)}</span>
        <span aria-hidden className="inline-block text-forest rtl:rotate-180">
          →
        </span>
      </Link>
    </li>
  );

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">{project.name}</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">{t("pf.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("pf.intro")}</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-sm font-medium">
            {t("pf.report")}
            <select className={select} value={report.kind} onChange={(e) => go(e.target.value as ReportKind, defaultFor(e.target.value as ReportKind))}>
              {(["qpr", "annual", "face"] as ReportKind[]).map((k) => (
                <option key={k} value={k}>
                  {t(`pf.kind.${k}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            &nbsp;
            <select className={select} value={periodOf(report)} onChange={(e) => go(report.kind, e.target.value)} aria-label={t("pf.report")}>
              {[...new Set([periodOf(report), ...periods(report.kind)])].map((p) => (
                <option key={p} value={p}>
                  {p.replace("-Q", " Q")}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {!v && !error && <p className="mt-6 text-sm text-muted">{t("pf.loading")}</p>}

        {v && d && (
          <>
            <section aria-label={t("pf.due", { date: "" })} className="mt-5 rounded-2xl border border-line bg-surface p-4 text-sm">
              {d.due && d.aim ? (
                <>
                  <p className="font-semibold">{t("pf.aim", { date: date(d.aim, { day: "numeric", month: "long" }), days: d.reviewDays })}</p>
                  <p className="mt-1 text-muted">
                    {t("pf.due", { date: date(d.due, { day: "numeric", month: "long", year: "numeric" }) })} ·{" "}
                    {d.source?.kind === "milestone" ? t("pf.from.milestone", { title: d.source.title }) : d.source?.kind === "policy" ? t("pf.from.policy", { days: d.source.days }) : ""}
                  </p>
                </>
              ) : v.report.kind !== "face" ? (
                <p className="text-muted">{t("pf.noDeadline")}</p>
              ) : null}
              {u && !v.released && (
                <p role="status" className={`mt-2 rounded-xl px-3 py-2 font-semibold ${u === "near" ? "bg-ochre-soft text-ochre" : "bg-clay-soft text-clay"}`}>
                  <span aria-hidden>⚠ </span>
                  {u === "past" ? t("pf.warn.past", { date: date(d.due!, { day: "numeric", month: "long" }) }) : u === "missed-aim" ? t("pf.warn.missedAim", { n: daysBetween(today(), d.due!) }) : t("pf.warn.near", { n: daysBetween(today(), d.aim!) })}
                </p>
              )}
            </section>

            {v.released ? (
              <p className="mt-5 rounded-xl bg-mist px-4 py-3 text-sm text-leaf">{t("pf.released")}</p>
            ) : (
              <>
                <section className="mt-6">
                  <h2 className="flex items-center gap-2 font-display text-xl">
                    <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${blocks.length ? "bg-clay" : "bg-leaf"}`} />
                    {t("pf.blocks")} <span className="text-base text-muted">({blocks.length})</span>
                  </h2>
                  {blocks.length ? (
                    <ul className="mt-2 space-y-2">
                      {sortByOwner(blocks).map((i) => (
                        <Row key={i.text} i={i} />
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-leaf">{t("pf.noBlocks")}</p>
                  )}
                </section>
                <section className="mt-6">
                  <h2 className="flex items-center gap-2 font-display text-xl">
                    <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-ochre" />
                    {t("pf.fix")} <span className="text-base text-muted">({fix.length})</span>
                  </h2>
                  {fix.length ? (
                    <ul className="mt-2 space-y-2">
                      {sortByOwner(fix).map((i) => (
                        <Row key={i.text} i={i} />
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-muted">{t("pf.noFix")}</p>
                  )}
                </section>
              </>
            )}
            {v.ready.length > 0 && (
              <details className="mt-6 rounded-2xl border border-line bg-surface p-4">
                <summary className="cursor-pointer font-display text-xl">
                  {t("pf.ready")} <span className="text-base text-muted">({v.ready.length})</span>
                </summary>
                <ul className="mt-2 space-y-1 text-sm">
                  {v.ready.map((r) => (
                    <li key={r.key}>
                      <span aria-hidden className="me-2 text-leaf">
                        ✓
                      </span>
                      {t(r.key as MessageKey, r.vars)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <Link href={v.href} className="mt-6 inline-flex min-h-12 items-center rounded-xl border border-line px-4 font-semibold text-forest hover:border-forest">
              {t("pf.openReport")} <span aria-hidden className="ms-1 inline-block rtl:rotate-180">→</span>
            </Link>
          </>
        )}
      </main>
    </div>
  );
}

const sortByOwner = (list: PreflightItem[]) => [...list].sort((a, b) => OWNERS.indexOf(a.owner) - OWNERS.indexOf(b.owner));

/** A report page's pre-flight: refetched whenever `dep` changes (the report was saved). */
export function usePreflight(project: string, user: string | undefined, report: ReportRef | null, dep: unknown) {
  const [p, setP] = useState<Preflight | null>(null);
  const key = report ? `${report.kind}:${periodOf(report)}` : "";
  useEffect(() => {
    if (!user || !report) return;
    let live = true;
    fetch(`/api/projects/${project}/preflight?report=${report.kind}&period=${periodOf(report)}`, { cache: "no-store", headers: { "x-demo-user": user } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setP(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, user, key, dep]);
  return p;
}

/**
 * Before a download: with blockers left, the person confirms a file marked "Draft, not checked",
 * and the download goes on the record. Returns the number of blockers to mark, or null to stop.
 */
export async function beforeDownload(project: string, user: string, loaded: Preflight | null, confirmText: (n: number) => string, report?: ReportRef | null, uncheckedText?: string): Promise<number | null> {
  // Pre-flight still loading, or its load failed: read it now. "Not known" is never treated as "nothing blocks".
  let p = loaded;
  if (!p && report) {
    p = await fetch(`/api/projects/${project}/preflight?report=${report.kind}&period=${periodOf(report)}`, { cache: "no-store", headers: { "x-demo-user": user } })
      .then((r) => (r.ok ? (r.json() as Promise<Preflight>) : null))
      .catch(() => null);
    if (!p) return window.confirm(uncheckedText ?? "Pre-flight could not be checked just now. The file will be marked \"Draft, not checked\". Download it anyway?") ? UNCHECKED : null;
  }
  const n = p && !p.released ? p.items.filter((i) => i.group === "blocks").length : 0;
  if (!n || !p) return 0;
  if (!window.confirm(confirmText(n))) return null;
  await fetch(`/api/projects/${project}/preflight`, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user }, body: JSON.stringify({ action: "exported", report: p.report.kind, period: periodOf(p.report) }) }).catch(() => undefined);
  return n;
}

/** The button on a report page: opens pre-flight, with the number of blockers. */
export function PreflightButton({ p, report, className }: { p: Preflight | null; report: ReportRef; className: string }) {
  const { t } = useT();
  const n = p && !p.released ? p.items.filter((i) => i.group === "blocks").length : 0;
  return (
    <Link href={`/progress/preflight?report=${report.kind}&period=${periodOf(report)}`} className={`${className} ${n ? "border-clay text-clay" : ""}`}>
      {n ? t("pf.buttonBlocks", { n }) : t("pf.button")}
    </Link>
  );
}
