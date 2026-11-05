"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/app/i18n";
import { Pill, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { kindTone } from "@/components/tasks/row";
import { userById } from "@/lib/demo";
import type { DonorInfo } from "@/lib/progress";
import { formatById } from "@/lib/report-formats";
import { isOverdue, type Row } from "@/lib/work-items";

/**
 * A task or milestone opened: when, who, its notes (what the person doing it needs: context,
 * links, where the files are), and where in the app the related work is. Full screen on phones.
 */

const URL = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

/** Notes as text, with web links made clickable. */
function Linked({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {text.split(URL).map((part, i) =>
        i % 2 ? (
          <a key={i} href={part} target="_blank" rel="noreferrer" className="text-forest underline underline-offset-2">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

export function TaskDetail({
  row,
  canEdit,
  donor,
  projectCode,
  hasField,
  onToggle,
  onSaveNotes,
  onClose,
}: {
  row: Row;
  canEdit: boolean;
  donor: DonorInfo | null;
  projectCode: string;
  hasField: boolean;
  onToggle: (id: string, done: boolean) => void;
  onSaveNotes: (id: string, notes: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t, date } = useT();
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(row.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const id = row.id!;
  const long = { weekday: "short", day: "numeric", month: "short", year: "numeric" } as const;
  const person = (p: string | null | undefined) => (p ? (userById(p)?.name ?? p) : null);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSaveNotes(id, notes);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const facts: [string, React.ReactNode][] = [];
  if (row.kind === "milestone") {
    facts.push([t("detail.when"), row.end ? `${date(row.date, long)} – ${date(row.end, long)}` : date(row.date, long)]);
    if (row.automatic) facts.push([t("detail.from"), row.donorName ? t("detail.fromDonor", { donor: row.donorName }) : t("tasks.fromSettings")]);
    else if (row.createdBy && userById(row.createdBy)) facts.push([t("detail.addedBy"), person(row.createdBy)]);
  } else {
    facts.push([t("detail.due"), row.date ? date(row.date, long) : t("detail.noDate")]);
    facts.push([t("detail.who"), person(row.assignee) ?? t("tasks.anyone")]);
    if (row.createdBy && row.createdBy !== row.assignee && userById(row.createdBy)) facts.push([t("detail.askedBy"), person(row.createdBy)]);
    if (row.done && row.doneAt) facts.push([t("detail.doneBy"), `${person(row.doneBy) ?? "?"}, ${date(row.doneAt.slice(0, 10), long)}`]);
  }

  // Where the related work is done in the app.
  const links: { href: string; label: string; before?: () => void }[] = [];
  if (row.kind === "milestone" && row.milestoneKind === "report_deadline")
    links.push({
      href: "/progress",
      label: donor ? t("detail.openReportFor", { donor: donor.name }) : t("detail.openReport"),
      before: () => {
        // Progress opens with this donor chosen.
        try {
          if (donor) localStorage.setItem(`rop-donor-${projectCode}`, JSON.stringify(donor.id));
        } catch {}
      },
    });
  if (row.kind === "milestone" && (row.milestoneKind === "harvest_window" || row.milestoneKind === "field_activity") && hasField)
    links.push({ href: "/work?source=field", label: t("detail.openField") });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-y-auto bg-paper p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-w-lg sm:rounded-2xl sm:border sm:border-line"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {row.kind === "milestone" ? <Pill tone={kindTone[row.milestoneKind]}>{t(`milestone.kind.${row.milestoneKind}`)}</Pill> : <Pill tone="forest">{t("detail.task")}</Pill>}
              {row.kind === "task" && row.done && <Pill tone="muted">{t("detail.done")}</Pill>}
              {isOverdue(row) && <span className="font-semibold text-clay">{t("detail.overdue")}</span>}
            </p>
            <h2 id="detail-title" className="mt-2 font-display text-2xl leading-snug">
              {row.title}
            </h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("detail.close")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl text-muted hover:bg-sunken">
            ×
          </button>
        </div>

        <dl className="mt-4 divide-y divide-line rounded-2xl border border-line bg-surface px-4">
          {facts.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[7rem_1fr] gap-3 py-2.5 text-sm">
              <dt className="text-muted">{k}</dt>
              <dd className="min-w-0">{v}</dd>
            </div>
          ))}
        </dl>

        {donor && row.kind === "milestone" && row.milestoneKind === "report_deadline" && (
          <section className="mt-4 rounded-2xl bg-sunken p-4 text-sm">
            <p className="font-medium">{t("detail.reportFor", { donor: donor.name })}</p>
            <p className="mt-1 text-muted">{t("detail.reportFormat", { format: t(formatById(donor.reportFormat).label) })}</p>
            {Object.keys(donor.indicatorRefs).length > 0 && <p className="mt-1 text-muted">{t("detail.reportIndicators", { n: Object.keys(donor.indicatorRefs).length })}</p>}
          </section>
        )}

        <section className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("detail.notes")}</h3>
            {canEdit && !editing && (
              <button type="button" onClick={() => setEditing(true)} className="text-sm font-semibold text-forest hover:underline">
                {row.notes ? t("detail.editNotes") : t("detail.addNotes")}
              </button>
            )}
          </div>
          {editing ? (
            <div className="mt-2">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={6}
                maxLength={4000}
                autoFocus
                placeholder={t("detail.notesHelp")}
                className="w-full rounded-xl border border-line bg-surface px-3 py-3 text-base"
                aria-label={t("detail.notes")}
              />
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => void save()} disabled={busy} className={`${primaryBtn} px-5 py-2.5`}>
                  {busy ? t("settings.saving") : t("detail.saveNotes")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNotes(row.notes ?? "");
                    setEditing(false);
                  }}
                  className={quietBtn}
                >
                  {t("detail.cancel")}
                </button>
              </div>
            </div>
          ) : row.notes ? (
            <div className="mt-2 rounded-2xl border border-line bg-surface p-4">
              <Linked text={row.notes} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">{canEdit ? t("detail.noNotes") : t("detail.noNotesReadOnly")}</p>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm text-clay">
              {error}
            </p>
          )}
        </section>

        {(links.length > 0 || (row.kind === "task" && canEdit)) && (
          <div className="mt-5 flex flex-wrap gap-2">
            {row.kind === "task" && canEdit && (
              <button
                type="button"
                onClick={() => {
                  onToggle(id, !row.done);
                  onClose();
                }}
                className={primaryBtn}
              >
                {row.done ? t("detail.reopen") : t("detail.markDone")}
              </button>
            )}
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={l.before} className={row.kind === "task" && canEdit ? quietBtn : primaryBtn}>
                {l.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
