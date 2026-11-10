"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { ErrorNote } from "@/components/app/error-note";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { TopBar, primaryBtn } from "@/components/workspace/ui";
import { BREAKDOWNS, type Breakdown, type TargetDetailsPatch } from "@/lib/target-details";
import type { TargetDetailsView } from "@/server/target-details";

/**
 * Target details: for each target, its baseline, breakdown, proof documents, budget line,
 * workplan step and whether it is in the donor's quarterly table. One target per block, stacked,
 * so it works on a phone. A plan approver saves; everyone else on staff reads.
 */

const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2 text-base";
type Target = TargetDetailsView["targets"][number];

export function TargetDetailsPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const { t } = useT();
  const [v, setV] = useState<TargetDetailsView | null>(null);
  const [error, setError] = useState("");
  // The target saved last, and a count that restarts every form from the saved facts after a save.
  const [saved, setSaved] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const url = `/api/projects/${project.id}/targets`;
  const userId = user?.id;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(url, { cache: "no-store", headers: { "x-demo-user": userId } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
      setV(body as TargetDetailsView);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [userId, url]);
  useEffect(() => {
    if (ready && userId && project.saved) void load();
  }, [ready, userId, project.saved, load]);

  if (!user) return null;
  const save = async (a: TargetDetailsPatch) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user.id }, body: JSON.stringify(a) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `Not saved (${res.status})`);
    setV(body as TargetDetailsView);
    setSaved(a.indicator);
    setVersion((n) => n + 1);
  };

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <Link href="/progress" className="text-sm text-muted hover:text-ink">
          <span aria-hidden className="inline-block rtl:rotate-180">←</span> Progress
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">{t("td.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("td.intro")}</p>
        {!project.saved && <p className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">{t("td.demo")}</p>}
        {error && <ErrorNote>{error}</ErrorNote>}
        {project.saved && !v && !error && <p className="mt-10 text-center text-sm text-muted">{t("load.wait")}</p>}
        {v && !v.can.edit && <p className="mt-4 rounded-xl bg-sunken px-4 py-3 text-sm">{t("td.readOnly")}</p>}
        {v && v.targets.length === 0 && <p className="mt-6 text-sm text-muted">{t("td.empty")}</p>}
        {v && (
          <div className="mt-4 space-y-4">
            {v.targets.map((x) => (
              <TargetForm key={`${x.code}:${version}`} x={x} v={v} save={save} justSaved={saved === x.code} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function TargetForm({ x, v, save, justSaved }: { x: Target; v: TargetDetailsView; save: (a: TargetDetailsPatch) => Promise<void>; justSaved: boolean }) {
  const { t } = useT();
  // The form starts from the saved facts; the page gives it a new key after a save, so it starts again from them.
  const [f, setF] = useState({ baseline: x.baseline === null ? "" : String(x.baseline), breakdown: x.breakdown as Breakdown[], verification: x.verification, budgetRef: x.budgetRef, workplanCode: x.workplanCode, inQuarterlyReport: x.inQuarterlyReport });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const typed = f.baseline.trim().replace(/,/g, "");
  const baseline = typed === "" ? null : Number(typed);
  const badNumber = baseline !== null && !Number.isFinite(baseline);
  const dirty = baseline !== x.baseline || JSON.stringify(BREAKDOWNS.filter((b) => f.breakdown.includes(b))) !== JSON.stringify(x.breakdown) || f.verification.trim() !== x.verification || f.budgetRef !== x.budgetRef || f.workplanCode !== x.workplanCode || f.inQuarterlyReport !== x.inQuarterlyReport;
  const off = !v.can.edit;
  const help = "mt-1 block text-xs text-muted";
  return (
    <section className="rounded-2xl border border-line bg-surface p-4" aria-label={x.name}>
      <h2 className="text-base font-semibold">
        <span className="font-mono text-xs text-muted">{x.donorCode ?? x.code}</span> {x.name} <span className="font-normal text-muted">({x.unit})</span>
      </h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          {t("td.baseline")}
          <input inputMode="decimal" className={input} value={f.baseline} disabled={off} onChange={(e) => setF({ ...f, baseline: e.target.value })} aria-invalid={badNumber} />
          <span className={help}>{t("td.baseline.help")}</span>
        </label>
        <fieldset className="text-sm">
          <legend>{t("td.breakdown")}</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
            {BREAKDOWNS.map((b) => (
              <label key={b} className="flex min-h-10 items-center gap-2">
                <input type="checkbox" className="h-5 w-5" checked={f.breakdown.includes(b)} disabled={off} onChange={(e) => setF({ ...f, breakdown: e.target.checked ? [...f.breakdown, b] : f.breakdown.filter((y) => y !== b) })} />
                {t(`td.by.${b}`)}
              </label>
            ))}
          </div>
          <span className={help}>
            {t("td.breakdown.help")}
            {x.otherBreakdowns.length > 0 && ` ${t("td.breakdown.other", { list: x.otherBreakdowns.join(", ") })}`}
          </span>
        </fieldset>
        <label className="text-sm sm:col-span-2">
          {t("td.verification")}
          <input className={input} value={f.verification} maxLength={500} disabled={off} onChange={(e) => setF({ ...f, verification: e.target.value })} />
          <span className={help}>{t("td.verification.help")}</span>
        </label>
        <label className="text-sm">
          {t("td.budgetRef")}
          <select className={input} value={f.budgetRef} disabled={off} onChange={(e) => setF({ ...f, budgetRef: e.target.value })}>
            <option value="">{t("td.none")}</option>
            {/* A line saved earlier that is no longer in the budget stays selectable, so opening the form changes nothing. */}
            {x.budgetRef && !v.budgetLines.some((l) => l.code === x.budgetRef) && <option value={x.budgetRef}>{x.budgetRef}</option>}
            {v.budgetLines.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code} {l.description}
              </option>
            ))}
          </select>
          <span className={help}>{t("td.budgetRef.help")}</span>
        </label>
        <label className="text-sm">
          {t("td.workplanCode")}
          <select className={input} value={f.workplanCode} disabled={off} onChange={(e) => setF({ ...f, workplanCode: e.target.value })}>
            <option value="">{t("td.none")}</option>
            {x.workplanCode && !v.workplan.some((w) => w.code === x.workplanCode) && <option value={x.workplanCode}>{x.workplanCode}</option>}
            {v.workplan.map((w) => (
              <option key={w.code} value={w.code}>
                {w.code} {w.title}
              </option>
            ))}
          </select>
          <span className={help}>{t("td.workplanCode.help")}</span>
        </label>
        <label className="flex min-h-10 items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={f.inQuarterlyReport} disabled={off} onChange={(e) => setF({ ...f, inQuarterlyReport: e.target.checked })} />
          <span>
            {t("td.inQpr")}
            <span className={help}>{t("td.inQpr.help")}</span>
          </span>
        </label>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {v.can.edit && dirty && (
        <button
          type="button"
          className={`${primaryBtn} mt-3`}
          disabled={busy || badNumber}
          onClick={() => {
            setBusy(true);
            setError("");
            save({ indicator: x.code, baseline, breakdown: BREAKDOWNS.filter((b) => f.breakdown.includes(b)), verification: f.verification.trim(), budgetRef: f.budgetRef, workplanCode: f.workplanCode, inQuarterlyReport: f.inQuarterlyReport })
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false));
          }}
        >
          {t("td.save")}
        </button>
      )}
      {justSaved && !dirty && (
        <p role="status" className="mt-3 text-sm text-forest">
          {t("td.saved")}
        </p>
      )}
    </section>
  );
}
