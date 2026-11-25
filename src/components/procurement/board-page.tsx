"use client";

import { plainError } from "@/lib/plain-error";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { Board, cardClass } from "@/components/workspace/board";
import { Pill, TopBar, usePersistentState } from "@/components/workspace/ui";
import { Empty, PageHead } from "@/components/workspace/ledger";
import { STUCK_DAYS, isStuck, procurementColumns, type ProcCard } from "@/lib/boards";
import { realToday } from "@/lib/clock";
import { daysSince } from "@/lib/grants";
import type { MessageKey } from "@/lib/i18n";

/** Large procurements in every project the person works on, one column per stage (lib/boards.ts). */
export function ProcurementBoardPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { t } = useT();
  const [medium, setMedium] = usePersistentState("rop-proc-board-medium", () => false);
  const [data, setData] = useState<{ cards: ProcCard[]; limit: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ready || !user) return;
    let live = true;
    setData(null);
    setError("");
    fetch(`/api/boards/procurements${medium ? "?medium=1" : ""}`, { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((body as { error?: string }).error ?? plainError(r.status));
        if (live) setData(body as { cards: ProcCard[]; limit: number });
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [ready, user, medium]);

  if (!user) return null;
  const today = realToday();
  const columns = data
    ? procurementColumns(data.cards).map((c) => ({
        id: c.id,
        title: t(`bd.proc.stage.${c.id}` as MessageKey),
        count: c.items.length,
        folded: c.id === "done",
        cards: c.items.map((p) => {
          const stuck = p.stage >= 0 && isStuck(p.since, today);
          return (
            <Link key={`${p.project.code}/${p.id}`} href={`/work?source=procurement&open=${encodeURIComponent(p.id)}&project=${encodeURIComponent(p.project.code)}`} className={cardClass(stuck)}>
              <span className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted">
                {p.id} · {p.project.code}
                {p.project.sandbox && <Pill tone="sky">{t("bd.sandbox")}</Pill>}
              </span>
              <span className="block font-semibold">{p.title}</span>
              <span className="mt-0.5 block text-xs text-muted">
                ${Math.round(p.value).toLocaleString("en-US")} · {p.level} · {p.stepTitle}
              </span>
              {p.waitingOn && <span className="mt-1 block text-xs">{t("bd.proc.waiting", { who: p.waitingOn })}</span>}
              {p.stage >= 0 && p.since && <span className={`mt-1 block text-xs ${stuck ? "font-semibold text-warn" : "text-muted"}`}>{t(stuck ? "bd.stuck" : "bd.days", { n: daysSince(p.since, today) })}</span>}
            </Link>
          );
        }),
      }))
    : [];

  return (
    <div className="min-h-screen">
      {/* The organization's view across projects: not this project's Procurement tab. */}
      <TopBar />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <PageHead
          back={{ href: "/organization", label: t("nav.organization") }}
          title={t("bd.proc.title")}
          actions={
            <label className="flex min-h-12 items-center gap-2 font-mono text-xs">
              <input type="checkbox" className="h-5 w-5 accent-forest" checked={medium} onChange={(e) => setMedium(e.target.checked)} />
              {t("bd.proc.medium")}
            </label>
          }
        >
          {data && <span className="block">{t("bd.proc.help", { limit: `$${data.limit.toLocaleString("en-US")}`, days: STUCK_DAYS })}</span>}
          <span className="mt-1 block text-xs">{t("bd.help")}</span>
        </PageHead>
        {error && (
          <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {!data && !error && <p className="mt-6 text-sm text-muted">{t("bd.loading")}</p>}
        {data && data.cards.length === 0 && <Empty className="mt-6">{t("bd.proc.none")}</Empty>}
        {data && data.cards.length > 0 && <Board columns={columns} label={t("bd.proc.title")} />}
      </main>
    </div>
  );
}
