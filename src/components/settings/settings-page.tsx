"use client";

import Link from "next/link";

import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useRequireUser } from "@/components/app/session";
import { useProgress } from "@/components/app/use-project-data";
import { PasswordSection } from "@/components/settings/password-section";
import { SectionLabel, TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { canEditProject } from "@/lib/demo";
import type { DonorInfo, DonorInput, IndicatorProgress } from "@/lib/progress";
import { FORMATS, formatById } from "@/lib/report-formats";
import { today } from "@/lib/clock";

/** Project settings. For now: the donors, their report format, deadlines and indicator codes. */
export function SettingsPage() {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const { t, date } = useT();
  const progress = useProgress(project.id);
  const [editing, setEditing] = useState<DonorInfo | "new" | null>(null);
  const close = useCallback(() => setEditing(null), []);

  if (!user) return null;
  const data = progress.data;
  const canEdit = canEditProject(user) && !!data?.saved;

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <h1 className="font-display text-4xl tracking-tight">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-muted">{project.name}</p>

        <PasswordSection />

        <p className="mt-4 text-sm">
          <Link href="/settings/policy" className="font-semibold text-forest hover:underline">
            Rules this project follows: organization and donor policy
          </Link>
        </p>
        {user?.admin && (
          <p className="mt-2 text-sm">
            <Link href="/settings/people" className="font-semibold text-forest hover:underline">
              People and roles: who can sign in and what they may do
            </Link>
          </p>
        )}
        <section className="mt-8" aria-labelledby="donors-heading">
          <div className="flex items-center justify-between gap-3">
            <span id="donors-heading">
              <SectionLabel>{t("settings.donors")}</SectionLabel>
            </span>
            {canEdit && (
              <button type="button" onClick={() => setEditing("new")} className={`${primaryBtn} px-5 py-2.5`}>
                + {t("settings.addDonor")}
              </button>
            )}
          </div>
          {data && !data.saved && <p className="mt-4 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">{t("settings.notSaved")}</p>}
          {data?.saved && !canEditProject(user) && <p className="mt-3 text-sm text-muted">{t("settings.readOnly")}</p>}
          {progress.error && (
            <p role="alert" className="mt-4 text-sm text-clay">
              {progress.error}
            </p>
          )}
          {data?.saved && data.donors.length === 0 && <p className="mt-4 text-sm text-muted">{t("settings.none")}</p>}
          <ul className="mt-3 space-y-3">
            {data?.donors.map((d) => {
              const next = d.deadlines.find((x) => x.date >= today());
              const body = (
                <>
                  <p className="font-display text-xl">{d.name}</p>
                  <p className="mt-1 text-sm text-muted">
                    {t(formatById(d.reportFormat).label)} · {t("settings.tracks", { n: Object.keys(d.indicatorRefs).length || data.indicators.length })} ·{" "}
                    {t("settings.deadlineCount", { n: d.deadlines.length })}
                  </p>
                  {next && <p className="mt-1 text-sm">{t("settings.next", { title: next.title, date: date(next.date) })}</p>}
                </>
              );
              return (
                <li key={d.id}>
                  {canEdit ? (
                    <button type="button" onClick={() => setEditing(d)} className="w-full rounded-2xl border border-line bg-surface p-5 text-start hover:border-forest">
                      {body}
                    </button>
                  ) : (
                    <div className="rounded-2xl border border-line bg-surface p-5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </main>
      {editing && data && (
        <DonorSheet
          donor={editing === "new" ? null : editing}
          indicators={data.indicators}
          onSave={(input) => progress.saveDonor(editing === "new" ? null : editing.id, input)}
          onDelete={editing === "new" ? undefined : () => progress.deleteDonor(editing.id)}
          onClose={close}
        />
      )}
    </div>
  );
}

const field = "mt-1 w-full rounded-xl border border-line bg-surface px-3 py-3 text-base";
const label = "block text-sm font-medium";
type DraftDeadline = { key: string; id?: string; title: string; date: string };

function DonorSheet({
  donor,
  indicators,
  onSave,
  onDelete,
  onClose,
}: {
  donor: DonorInfo | null;
  indicators: IndicatorProgress[];
  onSave: (input: DonorInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(donor?.name ?? "");
  const [format, setFormat] = useState(donor?.reportFormat ?? "baseline");
  const [deadlines, setDeadlines] = useState<DraftDeadline[]>(donor?.deadlines.map((d) => ({ key: d.id, ...d })) ?? []);
  const [refs, setRefs] = useState<Record<string, string>>(donor?.indicatorRefs ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const ready = name.trim() && deadlines.every((d) => d.title.trim() && d.date);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    void run(() =>
      onSave({
        name: name.trim(),
        reportFormat: format,
        indicatorRefs: Object.fromEntries(Object.entries(refs).filter(([, v]) => v.trim())),
        deadlines: deadlines.map((d) => ({ id: d.id, title: d.title.trim(), date: d.date })),
      }),
    );
  };
  const setDeadline = (key: string, patch: Partial<DraftDeadline>) => setDeadlines((all) => all.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="donor-title"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full flex-col overflow-y-auto bg-paper p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-w-lg sm:rounded-2xl sm:border sm:border-line"
      >
        <h2 id="donor-title" className="font-display text-2xl">
          {t(donor ? "settings.editDonor" : "settings.addDonor")}
        </h2>

        <div className="mt-5 space-y-5">
          <label className={label}>
            {t("settings.name")}
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required autoFocus className={field} />
          </label>

          <label className={label}>
            {t("settings.format")}
            <select value={format} onChange={(e) => setFormat(e.target.value)} className={field}>
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {t(f.label)}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend className="text-sm font-medium">{t("settings.deadlines")}</legend>
            <p className="text-xs text-muted">{t("settings.deadlinesHelp")}</p>
            <ul className="mt-2 space-y-2">
              {deadlines.map((d) => (
                <li key={d.key} className="flex items-end gap-2">
                  <label className="min-w-0 flex-1 text-xs text-muted">
                    {t("settings.deadlineTitle")}
                    <input value={d.title} onChange={(e) => setDeadline(d.key, { title: e.target.value })} maxLength={200} required className={field} />
                  </label>
                  <label className="w-40 shrink-0 text-xs text-muted">
                    {t("settings.deadlineDate")}
                    <input type="date" value={d.date} onChange={(e) => setDeadline(d.key, { date: e.target.value })} required className={field} />
                  </label>
                  <button
                    type="button"
                    onClick={() => setDeadlines((all) => all.filter((x) => x.key !== d.key))}
                    aria-label={t("settings.removeDeadline", { title: d.title || t("settings.deadlineTitle") })}
                    className="mb-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-clay-soft hover:text-clay"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setDeadlines((all) => [...all, { key: crypto.randomUUID(), title: "", date: "" }])}
              className="mt-2 text-sm font-semibold text-forest hover:underline"
            >
              + {t("settings.addDeadline")}
            </button>
          </fieldset>

          {indicators.length > 0 && (
            <fieldset>
              <legend className="text-sm font-medium">{t("settings.codes")}</legend>
              <p className="text-xs text-muted">{t("settings.codesHelp")}</p>
              <ul className="mt-2 space-y-2">
                {indicators.map((i) => (
                  <li key={i.code}>
                    <label className="block text-xs text-muted">
                      {i.code} · {i.name}
                      <input value={refs[i.code] ?? ""} onChange={(e) => setRefs({ ...refs, [i.code]: e.target.value })} maxLength={200} className={field} />
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-clay">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button type="submit" disabled={!ready || busy} className={`${primaryBtn} flex-1`}>
            {busy ? t("settings.saving") : t("settings.save")}
          </button>
          <button type="button" onClick={onClose} className={quietBtn}>
            {t("settings.cancel")}
          </button>
          {onDelete &&
            (confirming ? (
              <div role="alert" className="w-full rounded-xl bg-clay-soft p-3 text-sm">
                <p>{t("settings.confirmDelete", { name: donor!.name, n: donor!.deadlines.length })}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void run(onDelete)} className={dangerBtn}>
                    {t("settings.delete")}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className={quietBtn}>
                    {t("settings.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="w-full py-2 text-sm font-semibold text-clay hover:underline">
                {t("settings.delete")}
              </button>
            ))}
        </div>
      </form>
    </div>
  );
}
