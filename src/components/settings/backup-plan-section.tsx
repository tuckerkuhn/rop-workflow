"use client";

import { useCallback, useEffect, useState } from "react";
import { primaryBtn } from "@/components/workspace/ui";
import { plainError } from "@/lib/plain-error";

type Status = { plan: null | { byName: string; at: string; dailyBackups: boolean; note: string }; due: boolean; exportKept: boolean; lastExport: null | { at: string; kept: boolean } };

/** ISS-25: the weekly export and the backup plan, confirmed by an administrator every 90 days. */
export function BackupPlanSection({ userId }: { userId: string }) {
  const [s, setS] = useState<Status | null>(null);
  const [daily, setDaily] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const r = await fetch("/api/admin/backup-plan", { cache: "no-store", headers: { "x-demo-user": userId } });
    if (r.ok) setS(await r.json());
  }, [userId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!s) return null;
  return (
    <div className="mt-4 text-sm">
      <p>
        <span className="font-semibold">Weekly export: </span>
        {s.exportKept ? "runs every Sunday and is kept in file storage." : "runs every Sunday, but is not kept: file storage is off. Download the records below, or switch file storage on."}
        {s.lastExport ? ` Last run ${s.lastExport.at.slice(0, 10)}${s.lastExport.kept ? "" : " (not kept)"}.` : " Not run yet."}
      </p>
      <p className={`mt-1 ${s.due ? "font-semibold text-warn" : ""}`}>
        <span className="font-semibold">Backup plan: </span>
        {s.plan ? `confirmed by ${s.plan.byName} on ${s.plan.at.slice(0, 10)}: daily backups ${s.plan.dailyBackups ? "on" : "NOT on"}. ${s.plan.note}` : "not confirmed yet."}
        {s.due ? " Confirm it now (every 90 days)." : ""}
      </p>
      {s.due && (
        <div className="mt-2 space-y-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} />
            The database service&apos;s daily backups are on (I checked in its dashboard)
          </label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked, and where" className="w-full rounded-lg border border-line bg-surface px-3 py-2" />
          <button
            type="button"
            disabled={note.trim().length < 5}
            className={primaryBtn}
            onClick={async () => {
              setError("");
              const r = await fetch("/api/admin/backup-plan", { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": userId }, body: JSON.stringify({ dailyBackups: daily, note }) });
              const b = await r.json().catch(() => ({}));
              if (!r.ok) return setError(b.error ?? plainError(r.status));
              setS(b);
            }}
          >
            Confirm the backup plan
          </button>
          {error && <p className="text-clay">{error}</p>}
        </div>
      )}
    </div>
  );
}
