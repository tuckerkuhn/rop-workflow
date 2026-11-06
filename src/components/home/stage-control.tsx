"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useSession } from "@/components/app/session";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import { STAGES, userById, type ProjectInfo, type Stage } from "@/lib/demo";
import type { StageChange } from "@/server/stage-store";

/**
 * A database project's stage on Home: who signed it off and when, and for plan approvers the
 * button to move it on. Leaving Design is the plan and budget sign-off.
 */
export function StageControl({ project, stage }: { project: ProjectInfo; stage: Stage }) {
  const { user } = useSession();
  const { reload } = useCurrentProject();
  const { t, date } = useT();
  const [history, setHistory] = useState<StageChange[]>([]);
  const [mayChange, setMayChange] = useState(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/projects/${project.id}/stage`;
  const headers = useCallback((): HeadersInit => ({ "content-type": "application/json", "x-demo-user": user?.id ?? "" }), [user]);

  useEffect(() => {
    if (!user || !project.saved) return;
    fetch(url, { cache: "no-store", headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { history: StageChange[]; mayChange: boolean } | null) => {
        setHistory(d?.history ?? []);
        setMayChange(!!d?.mayChange);
      })
      .catch(() => {});
  }, [url, user, project.saved, headers]);

  if (!project.saved) return null;
  const next = STAGES[STAGES.indexOf(stage) + 1] as Stage | undefined;
  const last = history[0];
  const signing = stage === "Design" && next === "Execute";
  const name = (id: string) => userById(id)?.name ?? id;

  const submit = async () => {
    if (!next) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(url, { method: "POST", headers: headers(), body: JSON.stringify({ to: next, note: note.trim() || undefined }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Not saved.");
      setHistory(d.history);
      setOpen(false);
      setNote("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 text-sm">
      {last && (
        <p className="text-xs text-muted">
          {last.signedOff
            ? t("stage.signedOff", { name: name(last.by), date: date(last.at.slice(0, 10), { day: "numeric", month: "short", year: "numeric" }) })
            : t("stage.moved", { stage: t(`stage.${last.to}`), name: name(last.by), date: date(last.at.slice(0, 10), { day: "numeric", month: "short", year: "numeric" }) })}
        </p>
      )}
      {mayChange && next && !open && (
        <button type="button" className={`${quietBtn} mt-2 py-1.5`} onClick={() => setOpen(true)}>
          {signing ? t("stage.signOff") : t("stage.moveTo", { stage: t(`stage.${next}`) })}
        </button>
      )}
      {open && next && (
        <div className="mt-2 rounded-xl border border-line bg-paper p-3">
          <p className="text-sm">{signing ? t("stage.signOffWhat") : t("stage.moveWhat")}</p>
          <label className="mt-2 block text-sm">
            {t("stage.note")}
            <textarea className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && (
            <p role="alert" className="mt-2 text-sm text-clay">
              {error}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} className={primaryBtn} onClick={() => void submit()}>
              {t("stage.confirm")}
            </button>
            <button type="button" className={quietBtn} onClick={() => setOpen(false)}>
              {t("stage.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
