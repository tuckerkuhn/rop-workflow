"use client";

import { Why } from "@/components/app/why";
import { FRAMEWORK_TABS, PlaceTabs } from "@/components/progress/report-checks";
import { plainError } from "@/lib/plain-error";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { ErrorNote } from "@/components/app/error-note";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { TopBar, primaryBtn } from "@/components/workspace/ui";
import { BREAKDOWNS, type Breakdown, type ConfirmLinks, type TargetDetailsPatch } from "@/lib/target-details";
import { LinkSuggestions } from "@/components/progress/link-suggestions";
import { SignedOffBanner, changeReasonHeader } from "@/components/setup/change-reason";
import { MEASURES, MEASURE_TEXT, isPercentUnit } from "@/lib/measure";
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
  // What was loaded is kept with the address it came from, so one project's targets are never shown or saved under another.
  const [got, setGot] = useState<{ url: string; view: TargetDetailsView } | null>(null);
  const [error, setError] = useState("");
  // The target saved last, for its "Saved." line.
  const [saved, setSaved] = useState<string | null>(null);
  const url = `/api/projects/${project.id}/targets`;
  const v = got?.url === url ? got.view : null;
  const userId = user?.id;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(url, { cache: "no-store", headers: { "x-demo-user": userId } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
      setGot({ url, view: body as TargetDetailsView });
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
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user.id, ...changeReasonHeader(url) }, body: JSON.stringify(a) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `Not saved (${res.status})`);
    setGot({ url, view: body as TargetDetailsView });
    setSaved(a.indicator);
  };
  // Suggested links a person confirmed: only empty links are filled, with the same audit row as a save.
  const applyLinks = async (links: ConfirmLinks["links"]) => {
    const res = await fetch(`${url}/links`, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user.id, ...changeReasonHeader(url) }, body: JSON.stringify({ links }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `Not saved (${res.status})`);
    setGot({ url, view: body as TargetDetailsView });
  };

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <PlaceTabs label="Results framework" here="/progress/targets" tabs={FRAMEWORK_TABS} />
        <h1 className="mt-4 font-display text-3xl tracking-tight">{t("td.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("td.intro")}</p>
        <Why>A target says where the project is going. A baseline says where it started. Without the starting figure nobody can show the project changed anything, and a final report with no baseline is the weakest kind.</Why>
        {v && v.targets.length > 0 && (() => {
          const missing = v.targets.filter((x) => x.baseline === null).length;
          return missing ? (
            <p role="status" className="mt-3 border-s-[6px] border-ochre bg-ochre-soft px-3 py-2 text-sm">
              <span className="font-mono font-bold">{missing}</span> of {v.targets.length} targets have no baseline yet. Record it before the first results come in: a baseline measured after the work starts is no longer a baseline.
            </p>
          ) : (
            <p className="mt-3 font-mono text-xs text-leaf">Every target has a baseline.</p>
          );
        })()}
        {!project.saved && <p className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">{t("td.demo")}</p>}
        {error && <ErrorNote>{error}</ErrorNote>}
        {project.saved && !v && !error && <p className="mt-10 text-center text-sm text-muted">{t("load.wait")}</p>}
        {v && v.can.edit && project.saved && project.stage !== "Design" && project.stage !== "Develop" && (
          <div className="mt-4">
            <SignedOffBanner code={project.id} stage={project.stage} />
          </div>
        )}
        {v && !v.can.edit && <p className="mt-4 rounded-xl bg-sunken px-4 py-3 text-sm">{t("td.readOnly")}</p>}
        {v && v.targets.length === 0 && <p className="mt-6 text-sm text-muted">{t("td.empty")}</p>}
        {v && <LinkSuggestions key={url} view={v} apply={applyLinks} className="mt-6" />}
        {v && (
          <div className="mt-4 space-y-4">
            {v.targets.map((x) => (
              <TargetForm key={`${url}:${x.code}:${JSON.stringify([x.baseline, x.breakdown, x.verification, x.budgetRef, x.workplanCode, x.inQuarterlyReport, x.measure])}`} x={x} v={v} save={save} justSaved={saved === x.code} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function TargetForm({ x, v, save, justSaved }: { x: Target; v: TargetDetailsView; save: (a: TargetDetailsPatch) => Promise<void>; justSaved: boolean }) {
  const { t } = useT();
  // The form starts from the saved facts. Its key holds them, so it starts again only when this target's own saved facts change; typing in other targets is left alone.
  const [f, setF] = useState({ baseline: x.baseline === null ? "" : String(x.baseline), breakdown: x.breakdown as Breakdown[], verification: x.verification, budgetRef: x.budgetRef, workplanCode: x.workplanCode, inQuarterlyReport: x.inQuarterlyReport, measure: x.measure });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Digits with a point and at most two decimals. A comma is refused, not guessed at: "12,5" and "12,500" mean different things.
  const typed = f.baseline.trim();
  const badNumber = typed !== "" && !/^-?\d{1,12}(\.\d{1,2})?$/.test(typed);
  const baseline = typed === "" || badNumber ? null : Number(typed);
  const dirty = badNumber || baseline !== x.baseline || JSON.stringify(BREAKDOWNS.filter((b) => f.breakdown.includes(b))) !== JSON.stringify(x.breakdown) || f.verification.trim() !== x.verification || f.budgetRef !== x.budgetRef || f.workplanCode !== x.workplanCode || f.inQuarterlyReport !== x.inQuarterlyReport || f.measure !== x.measure;
  const off = !v.can.edit;
  const help = "mt-1 block text-xs text-muted";
  return (
    <section id={`target-${x.code}`} className="scroll-mt-20 rounded-2xl border border-line bg-surface p-4" aria-label={x.name}>
      <h2 className="text-base font-semibold">
        <span className="font-mono text-xs text-muted">{x.donorCode ?? x.code}</span> {x.name} <span className="font-normal text-muted">({x.unit})</span>
      </h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          {t("td.baseline")}
          <input inputMode="decimal" className={input} value={f.baseline} disabled={off} onChange={(e) => setF({ ...f, baseline: e.target.value })} aria-invalid={badNumber} />
          <span className={badNumber ? "mt-1 block text-xs text-clay" : help}>{badNumber ? t("td.baseline.bad") : t("td.baseline.help")}</span>
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
        <fieldset className="text-sm sm:col-span-2">
          <legend>How the figure is worked out</legend>
          <div className="mt-1 space-y-2">
            {MEASURES.map((m) => (
              <label key={m} className="flex min-h-10 items-start gap-2">
                <input type="radio" name={`measure-${x.code}`} className="mt-0.5 h-5 w-5" checked={f.measure === m} disabled={off} onChange={() => setF({ ...f, measure: m })} />
                <span>
                  {MEASURE_TEXT[m].label}
                  <span className={help}>{MEASURE_TEXT[m].help}</span>
                </span>
              </label>
            ))}
          </div>
          {f.measure === "change" && baseline === null && <span className="mt-1 block text-xs text-clay">Record the baseline above: until then the report shows &quot;Baseline needed&quot; in place of the figure.</span>}
          {f.measure === "change" && baseline === 0 && isPercentUnit(x.unit) && <span className="mt-1 block text-xs text-clay">A percent change needs a baseline above zero.</span>}
        </fieldset>
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
            save({ indicator: x.code, baseline, breakdown: BREAKDOWNS.filter((b) => f.breakdown.includes(b)), verification: f.verification.trim(), budgetRef: f.budgetRef, workplanCode: f.workplanCode, inQuarterlyReport: f.inQuarterlyReport, measure: f.measure })
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
