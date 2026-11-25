"use client";

import { field } from "@/components/setup/question";
import { MEASURES, MEASURE_TEXT, type Measure } from "@/lib/measure";
import type { IndicatorInput } from "@/lib/project-setup";
import { DOC_BREAKDOWNS, MAX_INDICATORS } from "@/lib/setup-design";

/**
 * The part of an indicator that reports depend on and that the agreement and the logframe usually
 * give: its baseline, breakdowns, means of verification, the result it measures and how its
 * results become its figure. Filled from the documents (lib/setup-design) or by hand; checked and
 * corrected here before anything is saved. Target details changes the same facts later.
 */

const BREAKDOWN_WORDS: Record<string, string> = { sex: "Sex", age: "Age", province: "Province", district: "District", village: "Village", place: "Place", crop: "Crop" };

export function IndicatorDetails({ i, onChange }: { i: IndicatorInput; onChange: (patch: Partial<IndicatorInput>) => void }) {
  const chosen = i.disaggregation ?? [];
  const offered = [...DOC_BREAKDOWNS, ...chosen.filter((b) => !(DOC_BREAKDOWNS as readonly string[]).includes(b))];
  const toggle = (b: string) => onChange({ disaggregation: chosen.includes(b) ? chosen.filter((x) => x !== b) : [...chosen, b] });
  const filled = i.baseline != null || chosen.length > 0 || !!i.verification || !!i.result || !!i.docSource;
  return (
    <>
      {i.target === 0 && <p className="mt-2 rounded-xl bg-sunken px-3 py-2 text-xs text-muted">No number target yet. Enter it when it is set, for example after the baseline survey.</p>}
      <details className="mt-3 rounded-xl border border-line px-3 py-2" open={filled}>
        <summary className="cursor-pointer text-xs font-semibold text-muted">Baseline, breakdowns and proof{i.docSource ? ` (from ${i.docSource})` : ""}</summary>
        {i.frequencyAsWritten && <p className="mt-2 text-xs text-muted">The documents say it is reported {i.frequencyAsWritten}.</p>}
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="text-xs text-muted">
            Baseline
            <input
              type="number"
              step="any"
              value={i.baseline ?? ""}
              onChange={(e) => onChange({ baseline: e.target.value === "" ? null : Number(e.target.value) })}
              className={field}
            />
          </label>
          <label className="text-xs text-muted">
            Baseline year
            <input
              type="number"
              min={1900}
              max={2100}
              step={1}
              value={i.baselineYear ?? ""}
              onChange={(e) => onChange({ baselineYear: e.target.value === "" ? null : Math.trunc(Number(e.target.value)) })}
              className={field}
            />
          </label>
          <label className="text-xs text-muted">
            How results become the figure
            <select value={i.measure ?? ""} onChange={(e) => onChange({ measure: (e.target.value || undefined) as Measure | undefined })} className={field}>
              <option value="">Usual for its source</option>
              {MEASURES.map((m) => (
                <option key={m} value={m}>
                  {MEASURE_TEXT[m].label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="mt-3">
          <legend className="text-xs text-muted">Broken down by</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {offered.map((b) => (
              <label key={b} className="flex min-h-11 items-center gap-2 rounded-full border border-line px-3 text-sm">
                <input type="checkbox" checked={chosen.includes(b)} onChange={() => toggle(b)} />
                {BREAKDOWN_WORDS[b] ?? b}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="mt-3 block text-xs text-muted">
          Means of verification
          <input value={i.verification ?? ""} onChange={(e) => onChange({ verification: e.target.value })} maxLength={500} className={field} placeholder="e.g. Attendance sheets; endline survey" />
        </label>
        <label className="mt-3 block text-xs text-muted">
          The result it measures (outcome or output wording)
          <textarea value={i.result ?? ""} onChange={(e) => onChange({ result: e.target.value })} maxLength={1000} rows={2} className={field} />
        </label>
      </details>
    </>
  );
}

/** More indicators than a project keeps: all are shown so the person removes some before saving. */
export function TooManyIndicators({ n }: { n: number }) {
  if (n <= MAX_INDICATORS) return null;
  return (
    <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
      {n} indicators: a project keeps at most {MAX_INDICATORS}. Remove {n - MAX_INDICATORS} that the project does not report on before going on.
    </p>
  );
}
