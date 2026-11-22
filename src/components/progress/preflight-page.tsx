"use client";

import { askConfirm } from "@/components/app/dialogs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import type { MessageKey } from "@/lib/i18n";
import { periodOf, type Preflight, type PreflightItem, type ReportRef, UNCHECKED } from "@/lib/preflight";

/**
 * The report check's data and guards for the three report pages. The check itself is shown on each
 * report (components/progress/report-checks); the old /progress/preflight page redirects there.
 */

export function itemText(t: ReturnType<typeof useT>["t"], i: Pick<PreflightItem, "text" | "key" | "vars">) {
  return i.key ? t(i.key as MessageKey, i.vars) : i.text;
}

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
    if (!p) return (await askConfirm({ message: uncheckedText ?? "The report check could not run just now. The file will be marked \"Draft, not checked\". Download it anyway?", confirm: "Download anyway" })) ? UNCHECKED : null;
  }
  const n = p && !p.released ? p.items.filter((i) => i.group === "blocks").length : 0;
  if (!n || !p) return 0;
  if (!(await askConfirm({ message: confirmText(n), confirm: "Download anyway" }))) return null;
  await fetch(`/api/projects/${project}/preflight`, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user }, body: JSON.stringify({ action: "exported", report: p.report.kind, period: periodOf(p.report) }) }).catch(() => undefined);
  return n;
}

/** The button on a report page: jumps to the check on the same page, with the number of blockers. */
export function PreflightButton({ p, className }: { p: Preflight | null; report?: ReportRef; className: string }) {
  const { t } = useT();
  const n = p && !p.released ? p.items.filter((i) => i.group === "blocks").length : 0;
  return (
    <Link href="#checks" className={`${className} ${n ? "border-clay text-clay" : ""}`}>
      {n ? t("pf.buttonBlocks", { n }) : t("pf.button")}
    </Link>
  );
}
