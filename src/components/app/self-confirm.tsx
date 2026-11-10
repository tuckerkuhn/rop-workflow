"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import type { SelfConfirm } from "@/lib/solo";

/**
 * Solo sign-off (server/solo.ts): whether this project allows the same person to prepare and
 * approve, and the short statement they confirm each time, with an optional note. The server
 * checks again; this only decides what to offer.
 */

export type { SelfConfirm };

/** True when solo mode is on and no donor rule on this project needs a second person. */
export function useSolo(code: string | null | undefined, user: string | null | undefined) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!code || !user) return;
    let live = true;
    fetch(`/api/projects/${code}/solo`, { headers: { "x-demo-user": user } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { on: boolean; blocked: string | null } | null) => live && setOk(!!d?.on && !d.blocked))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [code, user]);
  return ok;
}

export function SelfConfirmSheet({ what, onConfirm, onCancel }: { what?: string; onConfirm: (self: SelfConfirm) => void | Promise<void>; onCancel: () => void }) {
  const { t } = useT();
  const [sure, setSure] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center" onClick={onCancel} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={t("so.confirmTitle")} className="w-full rounded-t-2xl bg-paper p-4 text-start shadow-xl sm:max-w-md sm:rounded-2xl sm:p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-xl">{t("so.confirmTitle")}</h2>
        {what && <p className="mt-1 text-sm text-muted">{what}</p>}
        <label className="mt-4 flex min-h-12 items-start gap-3 rounded-xl border border-line bg-surface p-3 text-sm font-semibold">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-forest" />
          <span>{t("so.statement")}</span>
        </label>
        <label className="mt-3 block text-sm">
          <span className="font-semibold">{t("so.note")}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={2} placeholder={t("so.notePh")} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none" />
        </label>
        <p className="mt-2 text-xs text-muted">{t("so.marked")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className={`${primaryBtn} min-h-12 flex-1`}
            disabled={!sure || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm({ confirm: true, note: note.trim() });
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("so.approve")}
          </button>
          <button type="button" className={`${quietBtn} min-h-12`} onClick={onCancel}>
            {t("so.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
