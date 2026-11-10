"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import type { MessageKey } from "@/lib/i18n";
import { OTHER_MIN, OVERSPEND_REASONS, type OverspendReason } from "@/lib/overspend";

export type ReasonValue = { reason: OverspendReason | null; note: string; text: string };

const field = "mt-1 block w-full min-h-12 rounded-xl border border-line bg-paper px-3 py-2 text-base";

/**
 * Why a budget line is over budget (lib/overspend.ts): a reason from the list and an optional note.
 * The same on Budget and on the quarterly report, because the reason belongs to the line.
 * A reason saved before the list existed shows as its text until someone picks one.
 */
export function OverspendReasonPicker({ saved, mayWrite, onSave }: { saved: ReasonValue; mayWrite: boolean; onSave: (r: { reason: OverspendReason | null; note: string }) => Promise<void> }) {
  const { t } = useT();
  const [reason, setReason] = useState<OverspendReason | "">(saved.reason ?? "");
  const [note, setNote] = useState(saved.note);
  const [state, setState] = useState<"" | "saving" | "saved" | string>("");
  // A saved change (here or on the other page) replaces what is shown.
  useEffect(() => {
    setReason(saved.reason ?? "");
    setNote(saved.note);
  }, [saved.reason, saved.note]);

  const label = (r: OverspendReason) => t(`os.reason.${r}` as MessageKey);
  if (!mayWrite)
    return <span className="mt-2 block text-xs text-muted">{saved.text ? `${t("os.reads")} ${saved.reason ? label(saved.reason) : saved.text}${saved.reason && saved.note ? `: ${saved.note}` : ""}` : t("os.who")}</span>;

  const dirty = reason !== (saved.reason ?? "") || note.trim() !== saved.note;
  const short = reason === "other" && note.trim().length < OTHER_MIN;
  const save = (r: { reason: OverspendReason | null; note: string }) => {
    setState("saving");
    onSave(r).then(
      () => setState("saved"),
      (e) => setState(e instanceof Error ? e.message : String(e)),
    );
  };
  return (
    <span className="mt-2 block text-xs">
      {!saved.reason && saved.text && (
        <span className="mb-1 block text-muted">
          {t("os.reads")} {saved.text}
        </span>
      )}
      <label className="block font-semibold">
        {t("os.label")}
        <select className={field} value={reason} onChange={(e) => (setReason(e.target.value as OverspendReason | ""), setState(""))}>
          <option value="">{t("os.choose")}</option>
          {OVERSPEND_REASONS.map((r) => (
            <option key={r} value={r}>
              {label(r)}
            </option>
          ))}
        </select>
      </label>
      {reason && (
        <label className="mt-2 block font-semibold">
          {reason === "other" ? t("os.noteOther") : t("os.note")}
          <input className={field} maxLength={500} value={note} onChange={(e) => (setNote(e.target.value), setState(""))} />
        </label>
      )}
      {reason && short && note.trim() && <span className="mt-1 block text-muted">{t("os.short")}</span>}
      <span className="mt-2 flex flex-wrap gap-2">
        {reason && dirty && (
          <button type="button" className={`${primaryBtn} min-h-12`} disabled={short || state === "saving"} onClick={() => save({ reason: reason as OverspendReason, note: note.trim() })}>
            {t("os.save")}
          </button>
        )}
        {!reason && saved.reason && (
          <button type="button" className={`${quietBtn} min-h-12`} disabled={state === "saving"} onClick={() => save({ reason: null, note: "" })}>
            {t("os.clear")}
          </button>
        )}
      </span>
      {state === "saved" && (
        <span role="status" className="mt-1 block text-forest">
          {t("os.saved")}
        </span>
      )}
      {state && state !== "saving" && state !== "saved" && (
        <span role="alert" className="mt-1 block text-clay">
          {state}
        </span>
      )}
    </span>
  );
}
