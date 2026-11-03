"use client";

import { Arrow } from "@/components/app/arrow";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { KoboConnect, KoboDone, KoboForms, KoboMap } from "@/components/setup/kobo-steps";
import { Question, field } from "@/components/setup/question";
import { TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { TODAY, canEditProject } from "@/lib/demo";
import { localeOf, type MessageKey } from "@/lib/i18n";
import { COUNTRIES, projectDesignSchema, type IndicatorInput, type ProjectDesign } from "@/lib/project-setup";

/**
 * Project setup: one question per screen. New projects answer the design questions, are
 * created at the review screen, then connect KoboToolbox. Existing projects open here from
 * Home to edit any answer.
 */

const DESIGN_STEPS = ["name", "country", "crop", "dates", "goal", "indicators", "donors", "review"] as const;
const KOBO_STEPS = ["kobo-connect", "kobo-forms", "kobo-map", "done"] as const;
type Step = (typeof DESIGN_STEPS)[number] | (typeof KOBO_STEPS)[number];

const empty: ProjectDesign = { name: "", country: "AF", crop: "", startDate: TODAY, endDate: TODAY, goal: "", indicators: [], donors: [] };

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
  return <Wizard key={creating ? "new" : project.id} code={creating ? null : project.id} first={(q.get("step") as Step | null) ?? (creating ? "name" : "review")} />;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <TopBar active="design" />
      <main className="mx-auto max-w-xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

function Wizard({ code: initialCode, first }: { code: string | null; first: Step }) {
  const { t } = useT();
  const { user } = useSession();
  const router = useRouter();
  const { reload: reloadProjects, setProject } = useCurrentProject();
  const code = initialCode;
  const [draft, setDraft] = useState<ProjectDesign>(empty);
  const [loaded, setLoaded] = useState(!initialCode);
  const [step, setStep] = useState<Step>(first);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Editing: start from the saved design.
  useEffect(() => {
    if (!initialCode || !user) return;
    fetch(`/api/projects/${initialCode}`, { headers: { "x-demo-user": user.id } })
      .then((r) => r.json())
      .then((d: ProjectDesign & { error?: string }) => {
        if (d.error) setError(d.error);
        else setDraft({ ...empty, ...d, crop: d.crop ?? "", goal: d.goal ?? "", startDate: d.startDate ?? TODAY, endDate: d.endDate ?? TODAY, donors: [] });
        setLoaded(true);
      })
      .catch((e) => setError(String(e)));
  }, [initialCode, user]);

  // New projects skip the donor question once created; existing ones manage donors in settings.
  const steps: Step[] = [...DESIGN_STEPS.filter((s) => s !== "donors" || !code), ...KOBO_STEPS];
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
        headers: { "Content-Type": "application/json", "x-demo-user": user?.id ?? "" },
        body: JSON.stringify(parsed.data),
      });
      const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      await reloadProjects();
      if (!code && body.code) {
        // Now an existing project: reopen setup on it, at the KoboToolbox step.
        setProject(body.code);
        router.replace("/setup?step=kobo-connect");
        return;
      }
      go("kobo-connect");
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
    indicators: draft.indicators.every((i) => i.name.trim() && i.unit.trim() && i.target > 0),
  };

  return (
    <Frame>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">{t(code ? "setup.editTitle" : "setup.newTitle")}</p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div className="h-full rounded-full bg-forest transition-all" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted">{t("setup.stepOf", { n: index + 1, total: steps.length })}</p>

      <div className="mt-6">
        {step === "name" && (
          <Question title={t("setup.q.name")} help={t("setup.h.name")}>
            <input value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} autoFocus className={field} aria-label={t("setup.q.name")} />
          </Question>
        )}
        {step === "country" && <CountryQuestion value={draft.country} onChange={(country) => set({ country })} />}
        {step === "crop" && (
          <Question title={t("setup.q.crop")} help={t("setup.h.crop")}>
            <input value={draft.crop} onChange={(e) => set({ crop: e.target.value })} list="crops" maxLength={100} autoFocus className={field} aria-label={t("setup.q.crop")} />
            <datalist id="crops">
              {["Maize", "Wheat", "Grapes", "Pomegranates", "Onions", "Saffron", "Almonds", "Coffee", "Cacao", "Rice"].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
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
        {step === "indicators" && <IndicatorsQuestion list={draft.indicators} onChange={(indicators) => set({ indicators })} />}
        {step === "donors" && <DonorsQuestion list={draft.donors ?? []} onChange={(donors) => set({ donors })} />}
        {step === "review" && <Review draft={draft} editing={!!code} onEdit={go} />}
        {step === "kobo-connect" && code && <KoboConnect code={code} onDone={next} onSkip={() => go("done")} />}
        {step === "kobo-forms" && code && <KoboForms code={code} onDone={next} />}
        {step === "kobo-map" && code && <KoboMap code={code} onDone={next} />}
        {step === "done" && code && <KoboDone code={code} name={draft.name} />}
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

function IndicatorsQuestion({ list, onChange }: { list: IndicatorInput[]; onChange: (l: IndicatorInput[]) => void }) {
  const { t } = useT();
  const update = (k: number, patch: Partial<IndicatorInput>) => onChange(list.map((i, j) => (j === k ? { ...i, ...patch } : i)));
  const add = (i: IndicatorInput) => onChange([...list, i]);
  const unused = SUGGESTIONS.filter((s) => !list.some((i) => i.name === t(s.name)));
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
      <ul className="mt-4 space-y-3">
        {list.map((i, k) => (
          <li key={i.code ?? `new-${k}`} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-start gap-2">
              <label className="min-w-0 flex-1 text-xs text-muted">
                {i.code ?? t("setup.newIndicator")}
                <input value={i.name} onChange={(e) => update(k, { name: e.target.value })} maxLength={200} className={field} aria-label={t("report.col.indicator")} />
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
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs text-muted">
                {t("report.col.target")}
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
            </div>
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

function Review({ draft, editing, onEdit }: { draft: ProjectDesign; editing: boolean; onEdit: (s: Step) => void }) {
  const { t, lang, date } = useT();
  const country = new Intl.DisplayNames([localeOf(lang)], { type: "region" }).of(draft.country) ?? draft.country;
  const rows: { step: Step; label: string; value: string }[] = [
    { step: "name", label: t("setup.r.name"), value: draft.name },
    { step: "country", label: t("setup.r.country"), value: country },
    { step: "crop", label: t("setup.r.crop"), value: draft.crop || "—" },
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
          <button type="button" onClick={() => onEdit("kobo-connect")} className="font-semibold text-forest hover:underline">
            {t("setup.koboLink")} <Arrow />
          </button>
          <Link href="/design" className="font-semibold text-forest hover:underline">
            {t("setup.marketLink")} <Arrow />
          </Link>
          <Link href="/settings" className="font-semibold text-forest hover:underline">
            {t("home.settings")} <Arrow />
          </Link>
        </p>
      )}
    </Question>
  );
}
