"use client";

import Link from "next/link";
import { useT } from "@/components/app/i18n";
import { MoneySentence } from "@/components/donor/money";
import { quarterLabel, useDonorView } from "@/components/donor/use-donor-view";

/**
 * A donor's Home, below the results against targets: the latest released report, how the grant
 * is being spent as that report gave it, and when to expect the next one. Three lines, each
 * opening the page behind it.
 */

const LONG: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };

export function DonorReportsCard({ code }: { code: string }) {
  const { tx, date } = useT();
  const { data, error } = useDonorView(code);
  const latest = data?.reports[0];
  const row = "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-3 first:border-0 first:pt-0 last:pb-0";
  return (
    <section className="rounded-2xl border border-line bg-surface p-5" aria-labelledby="donor-reports">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p id="donor-reports" className="font-semibold">
          {tx("Reports and spending")}
        </p>
        <Link href="/progress/released" className="btn-link">
          {tx("All reports")} →
        </Link>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-clay">
          {error}
        </p>
      )}
      {!data && !error && <p className="mt-2 text-sm text-muted">{tx("Loading…")}</p>}
      {data && (
        <div className="mt-3 text-sm">
          <div className={row}>
            <p>
              <span className="font-semibold">{tx("Latest report")}: </span>
              {latest
                ? tx("{quarter}, released {date}.", { quarter: quarterLabel(latest.quarter), date: date(latest.releasedAt.slice(0, 10), LONG) })
                : tx("none released yet. It appears here once Roots of Peace signs it off. Every figure in it opens its proof.")}
            </p>
            {latest && (
              <Link href={`/progress/released/${latest.quarter}`} className="font-semibold text-forest hover:underline">
                {tx("Read the report")} →
              </Link>
            )}
          </div>
          {latest && (
            <div className={row}>
              <p>
                <span className="font-semibold">{tx("Your grant")}: </span>
                {data.money ? (
                  <MoneySentence money={data.money} />
                ) : data.moneyNote === "noDonor" ? (
                  tx("no grant is recorded for your organization on this project.")
                ) : (
                  tx("spending is not shown yet. Roots of Peace is still setting which budget lines your grant pays for.")
                )}
              </p>
              {data.money && (
                <Link href={`/progress/released/${latest.quarter}#money`} className="font-semibold text-forest hover:underline">
                  {tx("See every budget line")} →
                </Link>
              )}
            </div>
          )}
          {data.next && (
            <div className={row}>
              <p>
                <span className="font-semibold">{tx("Next report")}: </span>
                {data.next.title ? tx("{title}, due {date}.", { title: data.next.title, date: date(data.next.date, LONG) }) : tx("due {date}.", { date: date(data.next.date, LONG) })}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
