"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useRequireUser } from "@/components/app/session";
import { MoneySentence } from "@/components/donor/money";
import { quarterLabel, useDonorView } from "@/components/donor/use-donor-view";
import { TopBar } from "@/components/workspace/ui";
import type { DonorView } from "@/server/donor-view-store";

/**
 * A donor's Reports: every annual or final report Roots of Peace has released, then every
 * quarterly report, newest first, with how the grant is being spent as the latest quarterly
 * report gave it and the date of the next one. Staff can open the same page to see what a donor
 * sees (from Project settings, under Donors).
 */

const LONG: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };

/** Staff are told whose view this is, and can change donor where the project has several. */
export function PreviewNote({ view, onPick }: { view: Pick<DonorView, "preview" | "donor" | "donors">; onPick: (id: string) => void }) {
  const { tx } = useT();
  if (!view.preview) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl bg-mist px-4 py-3 text-sm">
      <p className="min-w-0 flex-1">
        {view.donor ? tx("You are looking at what {donor} sees. Donors see released reports only, never a draft.", { donor: view.donor.name }) : tx("This project has no donor yet, so nobody sees this page.")}
      </p>
      {view.donors.length > 1 && (
        <label className="text-xs text-muted">
          {tx("Donor")}
          <select value={view.donor?.id ?? ""} onChange={(e) => onPick(e.target.value)} className="ms-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink">
            {view.donors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export function DonorReportsPage() {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const asked = useSearchParams().get("donor");
  const router = useRouter();
  const { tx, date } = useT();
  const { data, error } = useDonorView(project.saved ? project.id : null, asked);
  if (!user) return null;
  const withDonor = asked ? `?donor=${encodeURIComponent(asked)}` : "";
  const latest = data?.reports[0];
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {data && <PreviewNote view={data} onPick={(id) => router.replace(`/progress/released?donor=${encodeURIComponent(id)}`)} />}
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warn">{data?.project.name ?? project.name}</p>
        <h1 className="mt-1 font-display text-4xl tracking-tight">{tx("Reports")}</h1>
        <p className="mt-2 text-muted">{tx("Each quarterly, annual and final report appears here once Roots of Peace has signed it off and released it. Every figure in a quarterly report opens the records behind it.")}</p>
        {error && (
          <p role="alert" className="mt-4 text-sm text-clay">
            {error}
          </p>
        )}
        {!project.saved && <p className="mt-6 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">{tx("This example project keeps no released reports.")}</p>}
        {project.saved && !data && !error && <p className="mt-6 text-sm text-muted">{tx("Loading…")}</p>}

        {data && (
          <>
            {data.next && (
              <p className="mt-6 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
                <span className="font-semibold">{tx("Next report")}: </span>
                {data.next.title ? tx("{title}, due {date}.", { title: data.next.title, date: date(data.next.date, LONG) }) : tx("due {date}.", { date: date(data.next.date, LONG) })}
              </p>
            )}

            <h2 className="mt-8 font-display text-2xl">{tx("Released reports")}</h2>
            {data.reports.length === 0 && data.periods.length === 0 ? (
              <p className="mt-3 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">{tx("No report has been released yet. The first one appears here when Roots of Peace signs it off.")}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {data.periods.map((r) => (
                  <li key={r.slug}>
                    <Link href={`/progress/released/${r.slug}${withDonor}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-5 hover:border-forest">
                      <span>
                        <span className="block text-xl font-semibold">{tx(r.label)}</span>
                        <span className="mt-1 block text-sm text-muted">{tx("Released {date}", { date: date(r.releasedAt.slice(0, 10), LONG) })}</span>
                      </span>
                      <span className="text-sm font-semibold text-forest">{tx("Read the report")} →</span>
                    </Link>
                  </li>
                ))}
                {data.reports.map((r, k) => (
                  <li key={r.quarter}>
                    <Link href={`/progress/released/${r.quarter}${withDonor}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-5 hover:border-forest">
                      <span>
                        <span className="block text-xl font-semibold">{tx("Quarterly progress report, {quarter}", { quarter: quarterLabel(r.quarter) })}</span>
                        <span className="mt-1 block text-sm text-muted">
                          {tx("Released {date}", { date: date(r.releasedAt.slice(0, 10), LONG) })}
                          {k === 0 && data.reports.length > 1 ? ` · ${tx("the latest")}` : ""}
                        </span>
                      </span>
                      <span className="text-sm font-semibold text-forest">{tx("Read the report")} →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {latest && (
              <>
                <h2 className="mt-8 font-display text-2xl">{tx("How the grant is being spent")}</h2>
                {data.money ? (
                  <p className="mt-3 rounded-2xl border border-line bg-surface p-5">
                    <MoneySentence money={data.money} />{" "}
                    <Link href={`/progress/released/${latest.quarter}${withDonor}#money`} className="font-semibold text-forest hover:underline">
                      {tx("See every budget line")} →
                    </Link>
                  </p>
                ) : (
                  <p className="mt-3 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">
                    {data.moneyNote === "notSet"
                      ? data.preview
                        ? tx("Spending is not shown to this donor yet: nobody has said which budget lines this grant pays for. Set it in Project settings, under Donors.")
                        : tx("Spending is not shown yet: Roots of Peace is still setting which budget lines your grant pays for.")
                      : tx("No grant is recorded for this organization on this project.")}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
