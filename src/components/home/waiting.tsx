"use client";

import Link from "next/link";
import { useT } from "@/components/app/i18n";
import { itemText } from "@/components/progress/preflight-page";
import { BUCKETS, waitingCount, type WaitingRow } from "@/lib/home-buckets";
import type { Bucket } from "@/server/home-store";

/**
 * Everything waiting on this person, in three groups: Approve, Fix and Due. One row is one line
 * and one tap to the place to act. A group with nothing in it is not shown.
 */

const TONE: Record<Bucket, string> = { approve: "text-forest", fix: "text-clay", due: "text-ochre" };

export function WaitingOnYou({ rows }: { rows: Record<Bucket, WaitingRow[]> }) {
  const { t, date } = useT();
  if (!waitingCount(rows))
    return (
      <section aria-labelledby="waiting" className="rounded-2xl border border-line bg-surface p-4">
        <h2 id="waiting" className="font-display text-xl">
          {t("home.b.title")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("home.b.none")}</p>
      </section>
    );
  const words = (r: WaitingRow) => {
    if (r.item) return itemText(t, r.item);
    if (r.due) return r.due.what === "report" ? t("home.b.reportDue", { report: r.due.label, date: date(r.due.date, { day: "numeric", month: "long" }) }) : t("home.b.reviewDue", { review: r.due.label, date: date(r.due.date, { day: "numeric", month: "long" }) });
    return r.text ?? "";
  };
  const when = (days: number) => (days < 0 ? t("home.b.late", { n: -days }) : days === 0 ? t("home.b.today") : t("home.b.days", { n: days }));
  return (
    <section aria-labelledby="waiting" className="rounded-2xl border border-line bg-surface p-4">
      <h2 id="waiting" className="font-display text-xl">
        {t("home.b.title")}
      </h2>
      {BUCKETS.filter((b) => rows[b].length).map((b) => (
        <div key={b} className="mt-3">
          <h3 className={`text-xs font-semibold uppercase tracking-[0.12em] ${TONE[b]}`}>
            {t(`home.b.${b}`)} <span className="tabular-nums text-muted">({rows[b].length})</span>
          </h3>
          <ul className="mt-1 divide-y divide-line">
            {rows[b].map((r) => (
              <li key={r.key}>
                <Link href={r.href} className="flex min-h-12 items-center gap-3 py-2 text-sm hover:text-forest">
                  <span className="min-w-0 flex-1">
                    {r.item?.blocks && <span className="me-1 font-semibold text-clay">{t("home.b.blocks")}</span>}
                    {words(r)}
                  </span>
                  {r.due ? (
                    <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${r.due.days <= 7 ? "bg-clay-soft text-clay" : "bg-sunken text-muted"}`}>{when(r.due.days)}</span>
                  ) : (
                    r.urgent && !r.item && <span className="shrink-0 rounded-full bg-clay-soft px-2 py-0.5 text-xs font-semibold text-clay">{t("home.b.now")}</span>
                  )}
                  <span aria-hidden className="shrink-0 text-muted rtl:rotate-180">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
