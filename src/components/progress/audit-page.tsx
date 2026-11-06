"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser } from "@/components/app/session";
import { TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { quarterRange } from "@/lib/results";

/** The project's audit trail for a period, with a CSV export for auditors (e.g. UNDP's HACT spot checks). */

type Row = { at: string; who: string; what: string; action: string; entity: string; entityId: string };

const thisQuarter = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
};
const field = "mt-1 block rounded-xl border border-line bg-surface px-3 py-2 text-sm";

export function AuditPage() {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const start = quarterRange(thisQuarter());
  const [from, setFrom] = useState(start.from);
  const [to, setTo] = useState(start.to);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const url = (csv: boolean) => `/api/projects/${project.id}/audit?from=${from}&to=${to}${csv ? "&format=csv" : ""}`;

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    try {
      const r = await fetch(url(false), { cache: "no-store", headers: { "x-demo-user": user.id } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not load the audit trail.");
      setRows(d.rows);
    } catch (e) {
      setRows(null);
      setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, project.id, from, to]);

  useEffect(() => {
    if (project.saved) void load();
  }, [load, project.saved]);

  const download = async () => {
    if (!user) return;
    const r = await fetch(url(true), { headers: { "x-demo-user": user.id } });
    if (!r.ok) return setError("Could not export the audit trail.");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob());
    a.download = `audit-${project.id}-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!user) return null;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <h1 className="font-display text-4xl tracking-tight">Audit trail</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Every result recorded, accepted or queried, proof added, report edit, AI draft and release, spending import and stage sign-off for {project.name}, with who and when. Entries cannot be edited.
        </p>
        {!project.saved ? (
          <p className="mt-6 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">This demo project is kept in this browser only; its audit trail is on the project page.</p>
        ) : (
          <>
            <div className="mt-5 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                From
                <input type="date" className={field} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="text-sm">
                To
                <input type="date" className={field} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
              </label>
              <button type="button" className={quietBtn} onClick={() => void load()}>
                Show
              </button>
              <button type="button" className={primaryBtn} disabled={!rows?.length} onClick={() => void download()}>
                Download CSV
              </button>
            </div>
            {error && (
              <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
                {error}
              </p>
            )}
            {rows && (
              <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-surface">
                {rows.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted">Nothing recorded in this period.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-start text-xs uppercase tracking-[0.12em] text-muted">
                      <tr>
                        <th className="px-4 py-3 text-start font-semibold">When</th>
                        <th className="px-4 py-3 text-start font-semibold">Who</th>
                        <th className="px-4 py-3 text-start font-semibold">What</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {rows.map((r, i) => (
                        <tr key={`${r.at}-${i}`}>
                          <td className="whitespace-nowrap px-4 py-2 align-top tabular-nums text-muted">{r.at.replace("T", " ").slice(0, 16)}</td>
                          <td className="whitespace-nowrap px-4 py-2 align-top">{r.who}</td>
                          <td className="px-4 py-2 align-top">{r.what}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
