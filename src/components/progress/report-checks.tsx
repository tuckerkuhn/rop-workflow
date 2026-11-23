"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useSession } from "@/components/app/session";
import type { MessageKey } from "@/lib/i18n";
import { usesFace } from "@/lib/report-calendar";
import { daysBetween, OWNERS, periodOf, urgency, type Preflight, type PreflightItem, type ReportKind } from "@/lib/preflight";
import { itemText, OPEN_CHECKS } from "@/components/progress/preflight-page";

/**
 * The three donor reports are one place: this strip moves between them, and each carries its own
 * check (what blocks it, what is worth fixing, what is ready) at #checks instead of a separate page.
 */

const today = () => new Date().toISOString().slice(0, 10);
const KINDS: { kind: ReportKind; href: string; label: MessageKey }[] = [
  { kind: "qpr", href: "/progress/report", label: "nav.quarterly" },
  { kind: "annual", href: "/progress/annual", label: "nav.annual" },
  { kind: "face", href: "/progress/face", label: "nav.face" },
];

/** Pages that are one place share this strip: the page on screen is the dark tab. */
export function PlaceTabs({ label, here, tabs }: { label: string; here: string; tabs: { href: string; label: MessageKey }[] }) {
  const { t } = useT();
  return (
    <nav aria-label={label} className="flex flex-wrap border-b-2 border-ink print:hidden">
      {tabs.map((k) => (
        <Link
          key={k.href}
          href={k.href}
          aria-current={k.href === here ? "page" : undefined}
          className={`inline-flex min-h-11 items-center px-4 font-ledger text-base font-bold ${k.href === here ? "bg-ink text-paper" : "text-ink hover:bg-ochre-soft"}`}
        >
          {t(k.label)}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The three donor reports as one place. The funding request (FACE) tab shows only when one of the
 * project's donors is a UN agency, or when that page is the one on screen. Until the donors load,
 * and when they cannot be read, every tab shows: a report is never hidden by a failed load.
 */
export function ReportKinds({ kind }: { kind: ReportKind }) {
  const { t } = useT();
  const { user, ready } = useSession();
  const { project } = useCurrentProject();
  const [face, setFace] = useState(true);
  useEffect(() => {
    if (!ready || !user || !project.saved) return;
    let live = true;
    fetch(`/api/projects/${project.id}/donors`, { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { donors?: { name: string }[] } | null) => {
        if (live && d?.donors?.length) setFace(usesFace(d.donors.map((x) => x.name)));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ready, user, project.id, project.saved]);
  const tabs = KINDS.filter((k) => k.kind !== "face" || face || kind === "face");
  return <PlaceTabs label={t("hub.reports")} here={KINDS.find((k) => k.kind === kind)!.href} tabs={tabs} />;
}

export const EVIDENCE_TABS: { href: string; label: MessageKey }[] = [
  { href: "/progress/stories", label: "nav.stories" },
  { href: "/progress/photos", label: "nav.photos" },
];
export const FRAMEWORK_TABS: { href: string; label: MessageKey }[] = [
  { href: "/progress/framework", label: "nav.framework" },
  { href: "/progress/targets", label: "td.title" },
];
export const WORK_TABS: { href: string; label: MessageKey }[] = [
  { href: "/work", label: "tasks.all" },
  { href: "/work/activities", label: "nav.activities" },
];
export const REVIEW_TABS: { href: string; label: MessageKey }[] = [
  { href: "/progress/review", label: "nav.review" },
  { href: "/progress/learning", label: "nav.lessons" },
];

const sortByOwner = (list: PreflightItem[]) => [...list].sort((a, b) => OWNERS.indexOf(a.owner) - OWNERS.indexOf(b.owner));

function Rows({ items, start }: { items: PreflightItem[]; start: number }) {
  const { t } = useT();
  return (
    <ol className="border-t border-line">
      {sortByOwner(items).map((i, k) => (
        <li key={i.text} className="border-b border-line">
          <Link href={i.href} className="group flex min-h-12 items-center gap-3 px-2 py-2 hover:bg-ochre-soft focus-visible:bg-ochre-soft">
            <span aria-hidden className="w-6 shrink-0 font-mono text-xs text-muted">
              {String(start + k).padStart(2, "0")}
            </span>
            <span className="min-w-0 flex-1 text-sm">{itemText(t, i)}</span>
            <span className="shrink-0 font-mono text-xs uppercase text-muted">{t(`pf.owner.${i.owner}` as MessageKey)}</span>
            <span aria-hidden className="inline-block text-forest opacity-40 group-hover:opacity-100 rtl:rotate-180">
              →
            </span>
          </Link>
          {/* The lines behind a count: each target, section or budget line, and why, each with its own link. */}
          {i.details?.length ? (
            <details className="pb-2 ps-11 pe-2">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-forest">{t("pf.which", { n: i.details.length })}</summary>
              <ul className="space-y-1">
                {i.details.map((d) => (
                  <li key={d.text}>
                    <Link href={d.href} className="text-sm hover:underline">
                      {itemText(t, d)}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** The report's check, on the report itself. Open when something blocks it or when a link asked for #checks. */
export function ReportChecks({ p }: { p: Preflight | null }) {
  const { t, date } = useT();
  // Each time someone asks for the check (a #checks link, or the Report check button, again and
  // again), it opens and comes into view; reloading the check after a save never moves the page.
  const [asks, setAsks] = useState(0);
  // Opened or closed by hand, for one period: another period starts from its own default.
  const [chosen, setChosen] = useState<{ key: string; open: boolean } | null>(null);
  const handled = useRef(0);
  const key = p ? `${p.report.kind}:${periodOf(p.report)}` : "";
  useEffect(() => {
    const fromLink = () => window.location.hash === "#checks" && setAsks((n) => n + 1);
    const ask = () => setAsks((n) => n + 1);
    fromLink();
    window.addEventListener("hashchange", fromLink);
    window.addEventListener(OPEN_CHECKS, ask);
    return () => {
      window.removeEventListener("hashchange", fromLink);
      window.removeEventListener(OPEN_CHECKS, ask);
    };
  }, []);
  const loaded = !!p;
  useEffect(() => {
    // Only a new ask scrolls: a period loading after one already answered does not.
    if (!loaded || asks <= handled.current) return;
    handled.current = asks;
    setChosen({ key, open: true });
    document.getElementById("checks")?.scrollIntoView({ block: "start" });
  }, [asks, loaded, key]);
  if (!p) return null;
  const blocks = p.items.filter((i) => i.group === "blocks");
  const fix = p.items.filter((i) => i.group === "fix");
  const d = p.deadline;
  const u = urgency(d, today());
  const open = chosen?.key === key ? chosen.open : !p.released && blocks.length > 0;
  const tone = p.released ? "border-leaf" : blocks.length ? "border-clay" : fix.length ? "border-ochre" : "border-leaf";
  return (
    <details id="checks" open={open} onToggle={(e) => e.currentTarget.open !== open && setChosen({ key, open: e.currentTarget.open })} className={`mt-4 scroll-mt-20 border-s-[6px] ${tone} bg-surface print:hidden`}>
      <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
        <span className="font-ledger text-lg font-bold">{t("pf.title")}</span>
        {p.released ? (
          <span className="text-sm text-leaf">{t("pf.released")}</span>
        ) : (
          <span className="font-mono text-sm">
            <span className={blocks.length ? "font-bold text-clay" : "text-leaf"}>
              {t("pf.blocks")} {blocks.length}
            </span>
            {" · "}
            <span className={fix.length ? "text-warn" : "text-muted"}>
              {t("pf.fix")} {fix.length}
            </span>
            {" · "}
            <span className="text-muted">
              {t("pf.ready")} {p.ready.length}
            </span>
          </span>
        )}
        {d.due && <span className="ms-auto font-mono text-xs text-muted">{t("pf.due", { date: date(d.due, { day: "numeric", month: "short", year: "numeric" }) })}</span>}
      </summary>
      <div className="px-3 pb-4">
        <p className="text-sm text-muted">{t("pf.intro")}</p>
        {d.due && d.aim ? (
          <p className="mt-2 text-sm">
            <span className="font-semibold">{t("pf.aim", { date: date(d.aim, { day: "numeric", month: "long" }), days: d.reviewDays })}</span>{" "}
            <span className="text-muted">{d.source?.kind === "milestone" ? t("pf.from.milestone", { title: d.source.title }) : d.source?.kind === "policy" ? t("pf.from.policy", { days: d.source.days }) : ""}</span>
          </p>
        ) : p.report.kind !== "face" ? (
          <p className="mt-2 text-sm text-muted">{t("pf.noDeadline")}</p>
        ) : null}
        {u && !p.released && (
          <p role="status" className={`mt-2 px-3 py-2 text-sm font-semibold ${u === "near" ? "bg-ochre-soft text-warn" : "bg-clay-soft text-clay"}`}>
            <span aria-hidden>⚠ </span>
            {u === "past" ? t("pf.warn.past", { date: date(d.due!, { day: "numeric", month: "long" }) }) : u === "missed-aim" ? t("pf.warn.missedAim", { n: daysBetween(today(), d.due!) }) : t("pf.warn.near", { n: daysBetween(today(), d.aim!) })}
          </p>
        )}
        {!p.released && (
          <>
            <h3 className="mt-4 font-ledger text-base font-bold">
              {t("pf.blocks")} <span className="font-mono text-sm text-muted">({blocks.length})</span>
            </h3>
            {blocks.length ? <Rows items={blocks} start={1} /> : <p className="text-sm text-leaf">{t("pf.noBlocks")}</p>}
            <h3 className="mt-4 font-ledger text-base font-bold">
              {t("pf.fix")} <span className="font-mono text-sm text-muted">({fix.length})</span>
            </h3>
            {fix.length ? <Rows items={fix} start={blocks.length + 1} /> : <p className="text-sm text-muted">{t("pf.noFix")}</p>}
          </>
        )}
        {p.ready.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer font-ledger text-base font-bold">
              {t("pf.ready")} <span className="font-mono text-sm text-muted">({p.ready.length})</span>
            </summary>
            <ul className="mt-1 space-y-1 text-sm">
              {p.ready.map((r) => (
                <li key={r.key}>
                  <span aria-hidden className="me-2 text-leaf">
                    ✓
                  </span>
                  {t(r.key as MessageKey, r.vars)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </details>
  );
}
