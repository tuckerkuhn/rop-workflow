"use client";

import { ProjectModulesSection } from "@/components/settings/project-modules";
import Link from "next/link";

import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useRequireUser } from "@/components/app/session";
import { useProgress } from "@/components/app/use-project-data";
import { DonorFundingSection } from "@/components/settings/donor-funding";
import { ProjectOriginRow } from "@/components/settings/project-origin";
import { PasswordSection } from "@/components/settings/password-section";
import { NotifySection } from "@/components/settings/notify-section";
import { AwaySection } from "@/components/settings/away-section";
import { TwoStepSettings } from "@/components/app/two-step";
import { TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { Empty, LedgerRow, LedgerTable, PageHead, SectionHead } from "@/components/workspace/ledger";
import { canEditProject } from "@/lib/demo";
import { nextReportDue, type DonorInfo, type DonorInput, type IndicatorProgress } from "@/lib/progress";
import { FORMATS, formatById } from "@/lib/report-formats";
import { today } from "@/lib/clock";

// Ruled rows: a donor (name, what it tracks, the next deadline) and its reporting format.
const DONOR = "minmax(0,2fr) minmax(0,1fr)";
// A group of links as ruled rows, the last ruled in ink.
const links = "border-t border-ink font-ledger [&>*:last-child]:border-ink";
const linkRow = "flex min-h-12 items-center justify-between gap-3 border-b border-line px-3 py-2.5 text-sm font-semibold text-forest hover:bg-ochre-soft";

/** Settings: you (password, notifications), then this project (donors and report dates), then the organization. */
export function SettingsPage() {
  const { user, mode } = useRequireUser();
  const { project } = useCurrentProject();
  const { t, date } = useT();
  const progress = useProgress(project.id);
  const [editing, setEditing] = useState<DonorInfo | "new" | null>(null);
  const close = useCallback(() => setEditing(null), []);
  // The page draws only once the person is known, after the browser's own jump to #you or #donors
  // has found nothing, so go to the section named in the address once it is on screen.
  const ready = !!user;
  useEffect(() => {
    if (!ready) return;
    const go = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [ready]);

  if (!user) return null;
  const data = progress.data;
  const canEdit = canEditProject(user) && !!data?.saved;

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <PageHead kicker={project.name} title="Settings" />

        {/* You: how you sign in and what reaches you. */}
        <SectionHead id="you" className="mt-8 [&>h2]:scroll-mt-24">
          You: password and notifications
        </SectionHead>
        <PasswordSection />
        <NotifySection />
        <AwaySection />
        {mode === "live" && (
          <div className="mt-6">
            <TwoStepSettings />
          </div>
        )}

        {/* This project: its donors and the rules it follows. */}
        <SectionHead id="donors" className="mt-10 [&>h2]:scroll-mt-24">
          {project.name}: donors and report dates
        </SectionHead>
        <div className={`mt-3 ${links}`}>
          <Link href="/settings/policy" className={linkRow}>
            Rules this project follows: organization and donor policy
            <span aria-hidden>→</span>
          </Link>
          {data?.saved && <ProjectOriginRow code={project.id} className={linkRow} />}
        </div>
        <section className="mt-8" aria-labelledby="donors-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span id="donors-heading" className="font-mono text-xs uppercase tracking-[0.12em] text-muted">
              {t("settings.donors")}
            </span>
            {canEdit && (
              <button type="button" onClick={() => setEditing("new")} className={primaryBtn}>
                + {t("settings.addDonor")}
              </button>
            )}
          </div>
          {data && !data.saved && <p className="mt-4 bg-sunken px-4 py-3 text-sm text-muted">{t("settings.notSaved")}</p>}
          {data?.saved && !canEditProject(user) && <p className="mt-3 text-sm text-muted">{t("settings.readOnly")}</p>}
          {progress.error && (
            <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
              {progress.error}
            </p>
          )}
          {data?.saved && data.donors.length === 0 && <Empty>{t("settings.none")}</Empty>}
          {!!data?.donors.length && (
            <LedgerTable cols={DONOR} head={[t("settings.name"), t("settings.format")]} label={t("settings.donors")}>
              {data.donors.map((d) => {
                // The same next report as the donor's Home and Progress (lib/progress nextReportDue, ISS-20).
                const next = nextReportDue(d, today(), data.project.startDate, data.project.endDate);
                return (
                  <LedgerRow key={d.id} cols={DONOR} onClick={canEdit ? () => setEditing(d) : undefined} className="text-sm">
                    <span className="min-w-0">
                      <span className="block text-lg font-bold">{d.name}</span>
                      <span className="mt-0.5 block text-muted">
                        {t("settings.tracks", { n: Object.keys(d.indicatorRefs).length || data.indicators.length })} · {t("settings.deadlineCount", { n: d.deadlines.length })}
                      </span>
                      {next && <span className="mt-0.5 block">{t("settings.next", { title: next.title, date: date(next.date) })}</span>}
                    </span>
                    <span className="min-w-0">{t(formatById(d.reportFormat).label)}</span>
                  </LedgerRow>
                );
              })}
            </LedgerTable>
          )}
        </section>
        {data?.saved && user.kind === "employee" && <ProjectModulesSection code={project.id} canEdit={canEdit} />}
        {data?.saved && user.kind === "employee" && <DonorFundingSection code={project.id} canEdit={canEdit} donorsKey={data.donors.map((d) => d.id).join(",")} />}

        {/* The organization: administrators' tools. */}
        <SectionHead className="mt-10">Roots of Peace</SectionHead>
        <div className={`mt-3 ${links}`}>
          <Link href="/settings/organization" className={linkRow}>
            Organization settings: the rules by department, and presets
            <span aria-hidden>→</span>
          </Link>
          {user.admin && (
            <>
              <Link href="/settings/people" className={linkRow}>
                People and roles: who can sign in and what they may do
                <span aria-hidden>→</span>
              </Link>
              <Link href="/settings/health" className={linkRow}>
                System health and backups: errors, AI use, email and a copy of the records
                <span aria-hidden>→</span>
              </Link>
            </>
          )}
        </div>
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

const field = "mt-1 min-h-12 w-full border border-line bg-paper px-3 py-3 text-base focus:border-forest focus:outline-none";
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
        className="flex max-h-full w-full flex-col overflow-y-auto border-t-2 border-ink bg-paper p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-w-lg"
      >
        <SectionHead id="donor-title" className="">
          {t(donor ? "settings.editDonor" : "settings.addDonor")}
        </SectionHead>

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
                  <label className="w-40 shrink-0 font-mono text-xs text-muted">
                    {t("settings.deadlineDate")}
                    <input type="date" value={d.date} onChange={(e) => setDeadline(d.key, { date: e.target.value })} required className={`${field} font-mono`} />
                  </label>
                  <button
                    type="button"
                    onClick={() => setDeadlines((all) => all.filter((x) => x.key !== d.key))}
                    aria-label={t("settings.removeDeadline", { title: d.title || t("settings.deadlineTitle") })}
                    className="mb-0.5 grid h-11 w-11 shrink-0 place-items-center text-muted hover:bg-clay-soft hover:text-clay"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setDeadlines((all) => [...all, { key: crypto.randomUUID(), title: "", date: "" }])}
              className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-forest hover:underline"
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
                      <span className="font-mono">{i.code}</span> · {i.name}
                      <input value={refs[i.code] ?? ""} onChange={(e) => setRefs({ ...refs, [i.code]: e.target.value })} maxLength={200} className={field} />
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
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
              <div role="alert" className="w-full bg-clay-soft p-3 text-sm">
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
              <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="min-h-11 w-full py-2 text-sm font-semibold text-clay hover:underline">
                {t("settings.delete")}
              </button>
            ))}
        </div>
      </form>
    </div>
  );
}
