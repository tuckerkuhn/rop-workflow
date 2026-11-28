"use client";

import { CROP_NAMES, densityOf, suggestedPlan, type CropPlan } from "@/lib/crops";

import { Arrow } from "@/components/app/arrow";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useProjectModules } from "@/components/app/project-modules";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { KoboApprovalSetting } from "@/components/setup/kobo-approval";
import { DeadlinesStep, RulesStep } from "@/components/setup/agreement-steps";
import { BudgetStep, WorkplanStep } from "@/components/setup/plan-steps";
import { VoucherCodingStep } from "@/components/setup/voucher-coding-step";
import { Question, field } from "@/components/setup/question";
import { TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { canEditProject } from "@/lib/demo";
import { localeOf, type MessageKey } from "@/lib/i18n";
import { SignedOffBanner, changeReasonHeader } from "@/components/setup/change-reason";
import { FromDocuments } from "@/components/setup/from-documents";
import { SetupLinkSuggestions } from "@/components/progress/link-suggestions";
import { IndicatorDetails, TooManyIndicators } from "@/components/setup/indicator-details";
import { MAX_INDICATORS } from "@/lib/setup-design";
import { FromProposalPanel, useFromProposal, type FromRecord } from "@/components/setup/from-proposal";
import { askConfirm } from "@/components/app/dialogs";
import { LIBRARY, THEMES, THEME_LABEL } from "@/lib/indicator-library";
import { COUNTRIES, projectDesignSchema, type IndicatorInput, type ProjectDesign } from "@/lib/project-setup";
import { projectYears } from "@/lib/progress";
import { realToday } from "@/lib/clock";

/**
 * Project setup: one question per screen. New projects answer the design questions, are
 * created at the review screen, then connect KoboToolbox. Existing projects open here from
 * Home to edit any answer.
 */

const DESIGN_STEPS = ["name", "country", "crop", "dates", "goal", "indicators", "donors", "review"] as const;
const PLAN_STEPS = ["budget", "coding", "deadlines", "rules", "workplan"] as const;
/** Field data is captured in the app's own forms (Kobo removed, 28 Nov): the last step names who checks it. */
const KOBO_STEPS = ["field-approval", "done"] as const;
type Step = (typeof DESIGN_STEPS)[number] | (typeof PLAN_STEPS)[number] | (typeof KOBO_STEPS)[number];

const empty: ProjectDesign = { name: "", country: "AF", crop: "", startDate: realToday(), endDate: realToday(), goal: "", indicators: [], donors: [] };

export function SetupPage() {
  const { user } = useRequireUser();
  const { t } = useT();
  const q = useSearchParams();
  const creating = q.get("new") === "1";
  const { project } = useCurrentProject();

  if (!user) return null;
  if (!canEditProject(user))
    return (
      <Frame>
        <p className="text-center text-muted">{t("setup.notAllowed")}</p>
      </Frame>
    );
  if (!creating && !project.saved)
    return (
      <Frame>
        <p className="text-center text-muted">{t("setup.browserOnly")}</p>
        <p className="mt-4 text-center">
          <Link href="/setup?new=1" className={primaryBtn}>
            {t("setup.newProject")}
          </Link>
        </p>
      </Frame>
    );
  // A new project from a won proposal (or a matched opportunity) opens with its details filled in.
  const from: FromRecord | null = creating ? { proposal: q.get("proposal"), opportunity: q.get("opportunity"), name: q.get("name") } : null;
  return <Wizard key={creating ? "new" : project.id} code={creating ? null : project.id} first={(q.get("step") as Step | null) ?? (creating ? "name" : "review")} from={from} />;
}

function Frame({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen">
      <TopBar active="design" />
      <main className={`mx-auto px-4 py-8 sm:px-6 ${wide ? "max-w-6xl" : "max-w-xl"}`}>{children}</main>
    </div>
  );
}

function Wizard({ code: initialCode, first, from }: { code: string | null; first: Step; from: FromRecord | null }) {
  const { t } = useT();
  const { user } = useSession();
  const router = useRouter();
  const { reload: reloadProjects, setProject, projects } = useCurrentProject();
  const code = initialCode;
  const stage = projects.find((p) => p.id === code)?.stage ?? "Design";
  const signedOff = !!code && stage !== "Design" && stage !== "Develop";
  const [draft, setDraft] = useState<ProjectDesign>(from?.name ? { ...empty, name: from.name } : empty);
  const origin = useFromProposal(from ?? { proposal: null, opportunity: null, name: null }, user?.id, setDraft);
  const [loaded, setLoaded] = useState(!initialCode);
  const [step, setStep] = useState<Step>(first);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fromDocs, setFromDocs] = useState<string[] | null>(null);
  const [docSources, setDocSources] = useState<string[]>([]);
  // Whether the crop plan was changed by hand: then picking another crop no longer replaces it.
  const [planEdited, setPlanEdited] = useState(!!initialCode);

  // Editing: start from the saved design.
  useEffect(() => {
    if (!initialCode || !user) return;
    fetch(`/api/projects/${initialCode}`, { headers: { "x-demo-user": user.id } })
      .then((r) => r.json())
      .then((d: ProjectDesign & { error?: string }) => {
        if (d.error) setError(d.error);
        else {
          // A project made before crop plans starts from its crop's suggested plan, to confirm and save.
          const suggested = !d.cropPlan && d.crop ? suggestedPlan(d.crop) : null;
          const { note: _note, ...plan } = suggested ?? { by: "area" as const };
          void _note;
          setDraft({ ...empty, ...d, ...(suggested ? { cropPlan: plan } : {}), crop: d.crop ?? "", goal: d.goal ?? "", startDate: d.startDate ?? realToday(), endDate: d.endDate ?? realToday(), donors: [] });
        }
        setLoaded(true);
      })
      .catch((e) => setError(String(e)));
  }, [initialCode, user]);

  // New projects skip the donor question once created; existing ones manage donors in settings.
  // Budget and workplan need the saved project, so they come after it is created.
  const steps: Step[] = [...DESIGN_STEPS.filter((s) => s !== "donors" || !code), ...(code ? PLAN_STEPS : []), ...KOBO_STEPS];
  const designSteps = steps.filter((s) => (DESIGN_STEPS as readonly string[]).includes(s));
  const index = steps.indexOf(step);
  const go = (s: Step) => {
    setError("");
    setStep(s);
    window.scrollTo({ top: 0 });
  };
  const next = () => go(steps[Math.min(index + 1, steps.length - 1)]);
  const back = () => go(steps[Math.max(index - 1, 0)]);
  const set = (patch: Partial<ProjectDesign>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    const parsed = projectDesignSchema.safeParse({ ...draft, donors: code ? undefined : draft.donors?.filter((d) => d.trim()) });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? t("setup.invalid"));
    setBusy(true);
    setError("");
    try {
      const res = await fetch(code ? `/api/projects/${code}` : "/api/projects", {
        method: code ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "x-demo-user": user?.id ?? "", ...(code ? changeReasonHeader(`/api/projects/${code}`) : {}) },
        // From a won proposal: which one and the award as confirmed here (the server links both ways).
        body: JSON.stringify(!code && origin.choice ? { ...parsed.data, origin: origin.choice } : parsed.data),
      });
      const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string; warning?: string };
      if (!res.ok) throw new Error(body.error ?? t("setup.saveFailed"));
      if (body.warning) await askConfirm({ message: body.warning, confirm: "OK" });
      await reloadProjects();
      if (!code && body.code) {
        // Now an existing project: reopen setup on it, at the budget.
        setProject(body.code);
        router.replace("/setup?step=budget");
        return;
      }
      go("budget");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded)
    return (
      <Frame>
        <p className="text-center text-sm text-muted">{error || t("setup.loading")}</p>
      </Frame>
    );

  const inDesign = designSteps.includes(step);
  const valid: Partial<Record<Step, boolean>> = {
    name: !!draft.name.trim(),
    dates: !!draft.startDate && !!draft.endDate && draft.endDate >= draft.startDate,
    // A target of 0 is "no number target yet" (often an outcome measured by survey): kept, not blocked.
    indicators: draft.indicators.length <= MAX_INDICATORS && draft.indicators.every((i) => i.name.trim() && i.unit.trim() && Number.isFinite(i.target) && i.target >= 0),
  };

  return (
    <Frame wide={step === "budget" || step === "workplan"}>
      {signedOff && code && <SignedOffBanner code={code} stage={stage} />}
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warn">{t(code ? "setup.editTitle" : "setup.newTitle")}</p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div className="h-full rounded-full bg-forest transition-all" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted">{t("setup.stepOf", { n: index + 1, total: steps.length })}</p>

      <div className="mt-6">
        {!code && (step === "name" || step === "review") && <FromProposalPanel defaults={origin.defaults} choice={origin.choice} onChange={origin.setChoice} error={origin.error} />}
        {step === "name" && !code && user && (
          <FromDocuments
            user={user.id}
            onProposal={(patch, questions, sources) => {
              set(patch);
              setFromDocs(questions);
              setDocSources(sources);
            }}
          />
        )}
        {fromDocs && (
          <div className="mb-6 rounded-2xl border border-line bg-surface p-4 text-sm">
            <p className="font-semibold">Filled in from the documents: check each step before saving.</p>
            {docSources.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-muted">{t("ag.sources")}</summary>
                <ul className="mt-1 list-disc ps-5 text-xs text-muted">
                  {docSources.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </details>
            )}
            {fromDocs.length > 0 && (
              <>
                <p className="mt-2 text-muted">To settle:</p>
                <ul className="mt-1 list-disc ps-5">
                  {fromDocs.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {step === "name" && (
          <Question title={t("setup.q.name")} help={t("setup.h.name")}>
            <input value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} autoFocus className={field} aria-label={t("setup.q.name")} />
          </Question>
        )}
        {step === "country" && <CountryQuestion value={draft.country} onChange={(country) => set({ country })} />}
        {step === "crop" && (
          <Question title={t("setup.q.crop")} help={t("setup.h.crop")}>
            <input
              value={draft.crop}
              onChange={(e) => {
                // A crop from the list brings its suggested plan, until the manager changes the plan themselves.
                const s = suggestedPlan(e.target.value);
                const { note: _note, ...plan } = s ?? { by: "area" as const };
                void _note;
                set({ crop: e.target.value, ...(!planEdited && s ? { cropPlan: plan } : {}) });
              }}
              list="crops"
              maxLength={100}
              autoFocus
              className={field}
              aria-label={t("setup.q.crop")}
            />
            <datalist id="crops">
              {CROP_NAMES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {draft.crop.trim() && (
              <CropPlanForm
                crop={draft.crop}
                plan={draft.cropPlan}
                onChange={(cropPlan) => {
                  setPlanEdited(true);
                  set({ cropPlan });
                }}
              />
            )}
          </Question>
        )}
        {step === "dates" && (
          <Question title={t("setup.q.dates")}>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-medium">
                {t("setup.start")}
                <input type="date" value={draft.startDate} onChange={(e) => set({ startDate: e.target.value })} className={field} />
              </label>
              <label className="text-sm font-medium">
                {t("setup.end")}
                <input type="date" value={draft.endDate} min={draft.startDate} onChange={(e) => set({ endDate: e.target.value })} className={field} />
              </label>
            </div>
          </Question>
        )}
        {step === "goal" && (
          <Question title={t("setup.q.goal")} help={t("setup.h.goal")}>
            <textarea value={draft.goal} onChange={(e) => set({ goal: e.target.value })} maxLength={500} rows={4} autoFocus className={field} aria-label={t("setup.q.goal")} />
          </Question>
        )}
        {step === "indicators" && <IndicatorsQuestion list={draft.indicators} years={projectYears(draft.startDate, draft.endDate)} onChange={(indicators) => set({ indicators })} />}
        {step === "donors" && <DonorsQuestion list={draft.donors ?? []} onChange={(donors) => set({ donors })} />}
        {step === "review" && <Review draft={draft} code={code} onEdit={go} />}
        {step === "budget" && code && <BudgetStep code={code} onDone={next} />}
        {step === "coding" && code && <VoucherCodingStep code={code} onDone={next} />}
        {step === "deadlines" && code && <DeadlinesStep code={code} start={draft.startDate} end={draft.endDate} onDone={next} />}
        {step === "rules" && code && <RulesStep code={code} onDone={next} />}
        {step === "workplan" && code && <WorkplanStep code={code} projectStart={draft.startDate} onDone={next} />}
        {step === "field-approval" && code && (
          <Question title={t("setup.q.fieldApproval")} help={t("setup.h.fieldApproval")}>
            <KoboApprovalSetting code={code} />
            <button type="button" onClick={next} className={`${primaryBtn} mt-6 w-full`}>
              {t("setup.next")}
            </button>
          </Question>
        )}
        {step === "done" && code && (
          <Question title={t("setup.q.done", { name: draft.name })} help={t("setup.h.done")}>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/home" className={quietBtn}>
                {t("nav.home")}
              </Link>
              <Link href="/work?source=field" className={`${primaryBtn} flex-1 text-center`}>
                {t("setup.fieldLink")}
              </Link>
            </div>
          </Question>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
          {error}
        </p>
      )}

      {inDesign && (
        <div className="mt-8 flex gap-3">
          {index > 0 && (
            <button type="button" onClick={back} className={quietBtn}>
              {t("setup.back")}
            </button>
          )}
          {step === "review" ? (
            <button type="button" onClick={() => void save()} disabled={busy} className={`${primaryBtn} flex-1`}>
              {busy ? t("settings.saving") : t(code ? "setup.saveChanges" : "setup.create")}
            </button>
          ) : (
            <button type="button" onClick={next} disabled={valid[step] === false} className={`${primaryBtn} flex-1`}>
              {t("setup.next")}
            </button>
          )}
        </div>
      )}
      {!inDesign && code && step !== "done" && (
        <p className="mt-6 text-sm">
          <button type="button" onClick={() => go("review")} className="text-muted hover:text-ink">
            <Arrow back /> {t("setup.backToDesign")}
          </button>
        </p>
      )}
    </Frame>
  );
}


function CountryQuestion({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t, lang } = useT();
  const names = new Intl.DisplayNames([localeOf(lang)], { type: "region" });
  const list = [...COUNTRIES].sort((a, b) => (names.of(a) ?? a).localeCompare(names.of(b) ?? b, localeOf(lang)));
  return (
    <Question title={t("setup.q.country")}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={field} aria-label={t("setup.q.country")}>
        {list.map((c) => (
          <option key={c} value={c}>
            {names.of(c)}
          </option>
        ))}
      </select>
    </Question>
  );
}

const LEVELS: { id: IndicatorInput["level"]; label: MessageKey }[] = [
  { id: "goal", label: "setup.level.goal" },
  { id: "outcome", label: "setup.level.outcome" },
  { id: "output", label: "setup.level.output" },
];
const FREQUENCIES: { id: IndicatorInput["frequency"]; label: MessageKey }[] = [
  { id: "monthly", label: "setup.freq.monthly" },
  { id: "quarterly", label: "setup.freq.quarterly" },
  { id: "end_of_season", label: "setup.freq.end_of_season" },
];

/** Common starting points; the team edits names and targets after adding. */
const SUGGESTIONS: { name: MessageKey; unit: MessageKey; level: IndicatorInput["level"]; frequency: IndicatorInput["frequency"] }[] = [
  { name: "setup.sug.trained", unit: "setup.unit.farmers", level: "output", frequency: "monthly" },
  { name: "setup.sug.inputs", unit: "setup.unit.farmers", level: "output", frequency: "monthly" },
  { name: "setup.sug.adopting", unit: "setup.unit.farmers", level: "outcome", frequency: "quarterly" },
  { name: "setup.sug.hectares", unit: "setup.unit.hectares", level: "outcome", frequency: "end_of_season" },
  { name: "setup.sug.income", unit: "setup.unit.pct", level: "goal", frequency: "end_of_season" },
];

function IndicatorsQuestion({ list, years, onChange }: { list: IndicatorInput[]; years: number[]; onChange: (l: IndicatorInput[]) => void }) {
  const { t } = useT();
  const update = (k: number, patch: Partial<IndicatorInput>) => onChange(list.map((i, j) => (j === k ? { ...i, ...patch } : i)));
  const add = (i: IndicatorInput) => onChange([...list, i]);
  const unused = SUGGESTIONS.filter((s) => !list.some((i) => i.name === t(s.name)));
  const fromLibrary = LIBRARY.filter((l) => !list.some((i) => i.name === t(l.name)));
  return (
    <Question title={t("setup.q.indicators")} help={t("setup.h.indicators")}>
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {unused.map((s) => (
            <button
              key={s.name}
              type="button"
              onClick={() => add({ name: t(s.name), unit: t(s.unit), target: 1, level: s.level, frequency: s.frequency })}
              className="rounded-full border border-dashed border-line px-3 py-1.5 text-sm hover:border-forest hover:text-forest"
            >
              + {t(s.name)}
            </button>
          ))}
        </div>
      )}
      {fromLibrary.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{t("setup.library")}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {THEMES.map((th) => {
              const items = fromLibrary.filter((l) => l.theme === th);
              if (!items.length) return null;
              return (
                <div key={th} className="rounded-xl border border-line px-3 py-2">
                  <p className="text-xs font-semibold">{t(THEME_LABEL[th])}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {items.map((l) => (
                      <button
                        key={l.name}
                        type="button"
                        onClick={() => add({ name: t(l.name), unit: t(l.unit), target: 1, level: l.level, frequency: l.frequency, theme: l.theme })}
                        className="rounded-full border border-dashed border-line px-3 py-1 text-xs hover:border-forest hover:text-forest"
                      >
                        + {t(l.name)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <TooManyIndicators n={list.length} />
      <ul className="mt-4 space-y-3">
        {list.map((i, k) => (
          <li key={i.code ?? `new-${k}`} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-start gap-2">
              <label className="min-w-0 flex-1 text-xs text-muted">
                {i.code ?? t("setup.newIndicator")}
                <input value={i.name} onChange={(e) => update(k, { name: e.target.value })} maxLength={200} className={field} aria-label={t("setup.col.target")} />
              </label>
              <button
                type="button"
                onClick={() => onChange(list.filter((_, j) => j !== k))}
                aria-label={t("tasks.delete", { title: i.name || t("setup.newIndicator") })}
                className="mt-6 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-clay-soft hover:text-clay"
              >
                ×
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <label className="text-xs text-muted">
                {t("pw.howMany")}
                <input type="number" min={0} step="any" value={Number.isFinite(i.target) ? i.target : ""} onChange={(e) => update(k, { target: Number(e.target.value) })} className={field} />
              </label>
              <label className="text-xs text-muted">
                {t("report.col.unit")}
                <input value={i.unit} onChange={(e) => update(k, { unit: e.target.value })} maxLength={50} className={field} />
              </label>
              <label className="text-xs text-muted">
                {t("setup.level")}
                <select value={i.level} onChange={(e) => update(k, { level: e.target.value as IndicatorInput["level"] })} className={field}>
                  {LEVELS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {t(l.label)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted">
                {t("setup.frequency")}
                <select value={i.frequency} onChange={(e) => update(k, { frequency: e.target.value as IndicatorInput["frequency"] })} className={field}>
                  {FREQUENCIES.map((f) => (
                    <option key={f.id} value={f.id}>
                      {t(f.label)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted">
                {t("setup.theme")}
                <select value={i.theme ?? ""} onChange={(e) => update(k, { theme: (e.target.value || null) as IndicatorInput["theme"] })} className={field}>
                  <option value="">{t("setup.theme.none")}</option>
                  {THEMES.map((th) => (
                    <option key={th} value={th}>
                      {t(THEME_LABEL[th])}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <IndicatorDetails i={i} onChange={(patch) => update(k, patch)} />
            {years.length > 1 && (
              <fieldset className="mt-3">
                <legend className="text-xs text-muted">{t("setup.forecast")}</legend>
                <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {years.map((y, n) =>
                    n === years.length - 1 ? (
                      <p key={y} className="text-xs text-muted">
                        {y}
                        <span className="mt-2 block rounded-xl bg-sunken px-3 py-3 text-base text-ink">
                          {Number.isFinite(i.target) ? i.target : "—"} <span className="text-xs text-muted">{t("setup.forecastIsTarget")}</span>
                        </span>
                      </p>
                    ) : (
                      <label key={y} className="text-xs text-muted">
                        {y}
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={i.forecast?.[String(y)] ?? ""}
                          onChange={(e) => {
                            const next = { ...(i.forecast ?? {}) };
                            if (e.target.value === "") delete next[String(y)];
                            else next[String(y)] = Number(e.target.value);
                            update(k, { forecast: next });
                          }}
                          className={field}
                        />
                      </label>
                    ),
                  )}
                </div>
              </fieldset>
            )}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => add({ name: "", unit: t("setup.unit.farmers"), target: 1, level: "output", frequency: "monthly" })} className="mt-3 text-sm font-semibold text-forest hover:underline">
        + {t("setup.addIndicator")}
      </button>
    </Question>
  );
}

function DonorsQuestion({ list, onChange }: { list: string[]; onChange: (l: string[]) => void }) {
  const { t } = useT();
  const rows = list.length ? list : [""];
  return (
    <Question title={t("setup.q.donors")} help={t("setup.h.donors")}>
      <ul className="space-y-2">
        {rows.map((d, k) => (
          <li key={k}>
            <input value={d} onChange={(e) => onChange(rows.map((x, j) => (j === k ? e.target.value : x)))} maxLength={200} className={field} aria-label={t("settings.name")} placeholder={t("settings.name")} />
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => onChange([...rows, ""])} className="mt-3 text-sm font-semibold text-forest hover:underline">
        + {t("settings.addDonor")}
      </button>
    </Question>
  );
}

function Review({ draft, code, onEdit }: { draft: ProjectDesign; code: string | null; onEdit: (s: Step) => void }) {
  const editing = !!code;
  const { t, lang, date } = useT();
  // Market windows are offered only to a project that uses them (Settings, "What this project uses").
  const modules = useProjectModules();
  const country = new Intl.DisplayNames([localeOf(lang)], { type: "region" }).of(draft.country) ?? draft.country;
  const rows: { step: Step; label: string; value: string }[] = [
    { step: "name", label: t("setup.r.name"), value: draft.name },
    { step: "country", label: t("setup.r.country"), value: country },
    { step: "crop", label: t("setup.r.crop"), value: draft.crop ? `${draft.crop}${draft.cropPlan?.by === "count" && densityOf(draft.cropPlan) ? ` · ${draft.cropPlan.rowM} m × ${draft.cropPlan.plantM} m, ${densityOf(draft.cropPlan)!.toLocaleString("en-US")} ${draft.cropPlan.unit} per ha${draft.cropPlan.trellis ? ", trellised" : ""}` : draft.cropPlan?.by === "area" ? " · sown by area" : ""}` : "—" },
    { step: "dates", label: t("setup.r.dates"), value: `${date(draft.startDate, { day: "numeric", month: "short", year: "numeric" })} – ${date(draft.endDate, { day: "numeric", month: "short", year: "numeric" })}` },
    { step: "goal", label: t("setup.r.goal"), value: draft.goal || "—" },
    { step: "indicators", label: t("setup.r.indicators"), value: draft.indicators.map((i) => `${i.name} (${i.target} ${i.unit})`).join("; ") || "—" },
    ...(editing ? [] : [{ step: "donors" as Step, label: t("setup.r.donors"), value: (draft.donors ?? []).filter((d) => d.trim()).join(", ") || "—" }]),
  ];
  return (
    <Question title={t(editing ? "setup.q.reviewEdit" : "setup.q.review")} help={editing ? t("setup.h.reviewEdit") : t("setup.h.review")}>
      <dl className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {rows.map((r) => (
          <div key={r.step} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <dt className="text-xs text-muted">{r.label}</dt>
              <dd className="mt-0.5 text-sm">{r.value}</dd>
            </div>
            <button type="button" onClick={() => onEdit(r.step)} className="shrink-0 text-sm font-semibold text-forest hover:underline">
              {t("setup.change")}
            </button>
          </div>
        ))}
      </dl>
      {editing && (
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <button type="button" onClick={() => onEdit("field-approval")} className="btn-link">
            {t("setup.fieldApprovalLink")} <Arrow />
          </button>
          {modules.market && (
            <Link href="/design" className="btn-link">
              {t("setup.marketLink")} <Arrow />
            </Link>
          )}
          <Link href="/settings#donors" className="btn-link">
            {t("nav.donorSettings")} <Arrow />
          </Link>
        </p>
      )}
      {/* Once targets and the workplan are both saved: their suggested links, to confirm here or on Target details. */}
      {code && <SetupLinkSuggestions code={code} />}
    </Question>
  );
}

/**
 * How the project's crop is planted (lib/crops), asked once at initiation. A crop planted by the
 * tree or vine takes its spacing, and the app works out the planting density from it, so at
 * planting only the number planted is typed and the hectares follow.
 */
function CropPlanForm({ crop, plan, onChange }: { crop: string; plan: CropPlan | undefined; onChange: (p: CropPlan) => void }) {
  const p: CropPlan = plan ?? { by: "area" };
  const s = suggestedPlan(crop);
  const density = densityOf(p);
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const input = "mt-1 block w-28 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal";
  return (
    <div className="mt-5 space-y-4 rounded-xl border border-line bg-paper p-4 text-sm">
      <fieldset>
        <legend className="font-medium">How is it planted?</legend>
        {(
          [
            ["count", "Counted one by one: trees, vines or seedlings", "Grapes, pomegranates, almonds, coffee. Field records how many were planted; the hectares follow from the spacing."],
            ["area", "Sown over an area: seed", "Maize, wheat, onions. Field records the area planted."],
          ] as const
        ).map(([v, label, help]) => (
          <label key={v} className="mt-2 flex items-start gap-2">
            <input type="radio" name="crop-by" checked={p.by === v} onChange={() => onChange(v === "count" ? { ...(s?.by === "count" ? s : {}), ...p, by: "count" } : { by: "area" })} className="mt-1" />
            <span>
              {label}
              <span className="block text-xs text-muted">{help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {p.by === "count" && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold">
              Counted as
              <input value={p.unit ?? ""} onChange={(e) => onChange({ ...p, unit: e.target.value })} placeholder="vines" maxLength={40} className={input} />
            </label>
            <label className="text-xs font-semibold">
              Between rows (m)
              <input type="number" min={0} step="any" inputMode="decimal" value={p.rowM ?? ""} onChange={(e) => onChange({ ...p, rowM: num(e.target.value) })} className={input} />
            </label>
            <label className="text-xs font-semibold">
              Between plants (m)
              <input type="number" min={0} step="any" inputMode="decimal" value={p.plantM ?? ""} onChange={(e) => onChange({ ...p, plantM: num(e.target.value) })} className={input} />
            </label>
            <label className="text-xs font-semibold">
              Years to first harvest
              <input type="number" min={0} max={30} step={1} value={p.yearsToHarvest ?? ""} onChange={(e) => onChange({ ...p, yearsToHarvest: num(e.target.value) })} className={input} />
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!p.trellis} onChange={(e) => onChange({ ...p, trellis: e.target.checked })} />
            Grown on a trellis the project installs
          </label>
          <p className={density ? "text-ink" : "text-muted"}>
            {density ? `${density.toLocaleString("en-US")} ${p.unit || "plants"} per hectare.` : "Enter both spacings to work out the planting density."}
            {s?.by === "count" && s.rowM && ` Suggested for ${crop}: ${s.rowM} m × ${s.plantM} m.`} Confirm the spacing with the technical team for the variety and site.
          </p>
        </>
      )}
    </div>
  );
}
