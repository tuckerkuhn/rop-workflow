"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/app/i18n";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import { users, type AppUser } from "@/lib/demo";
import { MILESTONE_KINDS, type MilestoneKind, type NewWorkItem } from "@/lib/work-items";

/** Adds a task or a milestone. Full screen on phones, a dialog on wider screens. */

const field = "mt-1 w-full rounded-xl border border-line bg-surface px-3 py-3 text-base";
const label = "block text-sm font-medium";

export function AddSheet({ user, onAdd, onClose }: { user: AppUser; onAdd: (item: NewWorkItem) => Promise<void>; onClose: () => void }) {
  const { t } = useT();
  const [type, setType] = useState<"task" | "milestone">("task");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [kind, setKind] = useState<MilestoneKind>("field_activity");
  const [assignee, setAssignee] = useState(user.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const ranged = type === "milestone" && kind === "harvest_window";
  const ready = title.trim() && (type === "task" || date) && (!ranged || !endDate || endDate >= date);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    const item: NewWorkItem =
      type === "task"
        ? { type, title: title.trim(), date: date || null, assignee: assignee || null }
        : { type, title: title.trim(), date, endDate: ranged && endDate ? endDate : null, milestoneKind: kind };
    try {
      await onAdd(item);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-title"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full flex-col overflow-y-auto bg-paper p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-2xl sm:border sm:border-line"
      >
        <h2 id="add-title" className="font-display text-2xl">
          {t("add.title")}
        </h2>

        <div role="radiogroup" aria-label={t("add.type")} className="mt-4 grid grid-cols-2 rounded-full bg-sunken p-1 text-sm">
          {(["task", "milestone"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={type === k}
              onClick={() => setType(k)}
              className={`rounded-full py-2 ${type === k ? "bg-surface font-semibold shadow-sm" : "text-muted"}`}
            >
              {t(k === "task" ? "add.task" : "add.milestone")}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-4">
          <label className={label}>
            {t(type === "task" ? "add.taskTitle" : "add.milestoneTitle")}
            <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required className={field} />
          </label>

          {type === "milestone" && (
            <label className={label}>
              {t("add.kind")}
              <select value={kind} onChange={(e) => setKind(e.target.value as MilestoneKind)} className={field}>
                {MILESTONE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`milestone.kind.${k}`)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className={ranged ? "grid grid-cols-2 gap-3" : ""}>
            <label className={label}>
              {t(type === "task" ? "add.due" : ranged ? "add.start" : "add.date")}
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required={type === "milestone"} className={field} />
            </label>
            {ranged && (
              <label className={label}>
                {t("add.end")}
                <input type="date" value={endDate} min={date || undefined} onChange={(e) => setEndDate(e.target.value)} className={field} />
              </label>
            )}
          </div>

          {type === "task" && (
            <label className={label}>
              {t("add.assignee")}
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field}>
                <option value="">{t("tasks.anyone")}</option>
                {users
                  .filter((p) => p.kind === "employee")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-clay">
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button type="submit" disabled={!ready || busy} className={`${primaryBtn} flex-1`}>
            {busy ? t("add.saving") : t("add.save")}
          </button>
          <button type="button" onClick={onClose} className={quietBtn}>
            {t("add.cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}
