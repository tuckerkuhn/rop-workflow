"use client";

import { useEffect, useState } from "react";
import { useRequireUser } from "@/components/app/session";
import { TopBar, Loading, primaryBtn } from "@/components/workspace/ui";
import { Empty, Fig, Figures, LedgerRow, LedgerTable, PageHead, SectionHead, StatusBlock } from "@/components/workspace/ledger";
import type { health } from "@/server/limits";

type Health = Awaited<ReturnType<typeof health>>;

const ERRS = "9rem 1fr";
const MORE = "9rem 1fr";

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
        <PageHead back={{ href: "/settings", label: "Settings" }} title="System health and backups" />
        {error && <p className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {!h && !error && <Loading className="mt-6" />}
        {h && (
          <>
            <Figures
              className="mt-6"
              items={[
                { label: "Server errors, last 24 hours", value: h.errorsToday, tone: h.errorsToday ? "clay" : undefined },
                {
                  label: "AI runs, last 24 hours",
                  value: (
                    <>
                      {h.ai.lastDay} <span className="text-sm font-normal text-muted">of {h.ai.perDay}</span>
                    </>
                  ),
                },
                {
                  label: "Database space",
                  value: (
                    <>
                      {h.storage.usedMb} MB <span className="text-sm font-normal text-muted">of {h.storage.limitMb} MB</span>
                    </>
                  ),
                  tone: h.storage.level === "critical" ? "clay" : h.storage.level === "warning" ? "warn" : undefined,
                },
              ]}
            />
            <LedgerTable cols={MORE} head={["What", "Detail"]} label="System health">
              <LedgerRow cols={MORE} className="text-sm">
                <span className="font-mono text-xs text-muted">AI runs</span>
                <span>
                  <Fig className="text-start">{h.ai.perPersonHour}</Fig> per person per hour
                </span>
              </LedgerRow>
              <LedgerRow cols={MORE} className="text-sm">
                <span className="font-mono text-xs text-muted">Database space</span>
                <span>
                  Proof files: <Fig className="text-start">{h.storage.filesMb} MB</Fig> in <Fig className="text-start">{h.storage.files}</Fig> files, kept in the database so they can never be altered.
                  {h.storage.level !== "good" && " Nearing the limit: decide whether to move photos to separate file storage or buy more space."}
                </span>
              </LedgerRow>
              <LedgerRow cols={MORE} className="text-sm">
                <span className="font-mono text-xs text-muted">Daily email</span>
                <span>
                  <StatusBlock tone={h.email.configured ? "forest" : "ochre"}>{h.email.configured ? "Switched on" : "Not set up"}</StatusBlock>
                  {!h.email.configured && (
                    <>
                      <span className="mt-1 block text-xs text-muted">Your technical administrator needs to switch on the email service.</span>
                      <details className="mt-1 text-xs text-muted">
                        <summary className="cursor-pointer">For your technical administrator</summary>
                        <p className="mt-1">
                          Set <code>RESEND_API_KEY</code> and <code>CRON_SECRET</code> on the server.
                        </p>
                      </details>
                    </>
                  )}
                </span>
              </LedgerRow>
            </LedgerTable>
            <section>
              <SectionHead>Errors this week</SectionHead>
              {h.errors.length === 0 ? (
                <Empty>None.</Empty>
              ) : (
                <LedgerTable cols={ERRS} head={["When (UTC)", "Error"]} label="Errors this week">
                  {h.errors.map((e, i) => (
                    <LedgerRow key={i} cols={ERRS} className="text-sm">
                      <Fig className="text-start text-muted">{e.at.replace("T", " ").slice(0, 16)}</Fig>
                      <div className="min-w-0 break-words">
                        {e.why && <p className="font-medium">{e.why}</p>}
                        <p>{e.message}</p>
                        {e.cause && <p className="mt-1 text-xs text-muted">Reason given by the {e.from === "AI service" ? "AI service" : "database"}: {e.cause}</p>}
                      </div>
                    </LedgerRow>
                  ))}
                </LedgerTable>
              )}
            </section>
            <section>
              <SectionHead>Copy of the records</SectionHead>
              <p className="mt-1 text-sm text-muted">
                The database service keeps backups; daily backups need its paid plan. Ask your technical administrator to confirm they are on, and keep the records export below as your own copy. The
                button downloads the project records as one file to keep in SharePoint; participants&rsquo; names, the HR book and KoboToolbox access keys are left out.
              </p>
              <details className="mt-2 text-xs text-muted">
                <summary className="cursor-pointer">For your technical administrator</summary>
                <p className="mt-1">
                  How backups and recovery work, and what to check in the database service: <code>docs/BACKUP-AND-RECOVERY.md</code>.
                </p>
              </details>
              <button
                type="button"
                className={`mt-3 ${primaryBtn}`}
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
