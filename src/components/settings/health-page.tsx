"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRequireUser } from "@/components/app/session";
import { TopBar } from "@/components/workspace/ui";
import type { health } from "@/server/limits";

type Health = Awaited<ReturnType<typeof health>>;

/** Administrators: is the app healthy? Errors this week, AI use, email, and the records export. */
export function HealthPage() {
  const { user } = useRequireUser();
  const [h, setH] = useState<Health | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!user) return;
    fetch("/api/admin/health", { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not load.");
        setH(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [user]);
  if (!user) return null;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <Link href="/settings" className="text-sm text-muted hover:text-ink">
          ← Settings
        </Link>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Health</h1>
        {error && <p className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {h && (
          <>
            <ul className="mt-6 grid gap-3 sm:grid-cols-3">
              <li className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-xs text-muted">Server errors, last 24 hours</p>
                <p className={`font-display text-3xl ${h.errorsToday ? "text-clay" : ""}`}>{h.errorsToday}</p>
              </li>
              <li className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-xs text-muted">AI runs, last 24 hours</p>
                <p className="font-display text-3xl">
                  {h.ai.lastDay} <span className="text-base text-muted">of {h.ai.perDay}</span>
                </p>
                <p className="text-xs text-muted">{h.ai.perPersonHour} per person per hour</p>
              </li>
              <li className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-xs text-muted">Daily email</p>
                <p className="font-display text-xl">{h.email.configured ? "Switched on" : "Not set up"}</p>
                {!h.email.configured && <p className="text-xs text-muted">Needs RESEND_API_KEY and CRON_SECRET on the server.</p>}
              </li>
              <li className="rounded-2xl border border-line bg-surface p-4 sm:col-span-3">
                <p className="text-xs text-muted">Database space</p>
                <p className={`font-display text-3xl ${h.storage.level === "critical" ? "text-clay" : h.storage.level === "warning" ? "text-ochre" : ""}`}>
                  {h.storage.usedMb} MB <span className="text-base text-muted">of {h.storage.limitMb} MB</span>
                </p>
                <p className="text-xs text-muted">
                  Proof files: {h.storage.filesMb} MB in {h.storage.files} files, kept in the database so they can never be altered.
                  {h.storage.level !== "good" && " Nearing the limit: decide whether to move photos to file storage or raise the plan."}
                </p>
              </li>
            </ul>
            <section className="mt-8">
              <h2 className="font-display text-2xl">Errors this week</h2>
              {h.errors.length === 0 ? (
                <p className="mt-2 text-sm text-muted">None.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface px-4 text-sm">
                  {h.errors.map((e, i) => (
                    <li key={i} className="py-2">
                      <span className="text-xs text-muted">{e.at.replace("T", " ").slice(0, 16)} UTC</span>
                      <p className="break-words">{e.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="mt-8">
              <h2 className="font-display text-2xl">Copy of the records</h2>
              <p className="mt-1 text-sm text-muted">
                The database is backed up by Supabase. This downloads the project records as one file to keep in SharePoint as well; participants&rsquo; names, the HR book and KoboToolbox tokens are left out. See docs/BACKUP-AND-RECOVERY.md.
              </p>
              <button
                type="button"
                className="mt-3 rounded-full bg-forest px-4 py-2 text-sm font-semibold text-paper"
                onClick={async () => {
                  const r = await fetch("/api/admin/export", { headers: { "x-demo-user": user.id } });
                  if (!r.ok) return setError((await r.json().catch(() => ({}))).error ?? "Export failed.");
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(await r.blob());
                  a.download = `rop-workflow-export-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >
                Download the records
              </button>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
