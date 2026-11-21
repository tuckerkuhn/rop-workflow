"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "@/components/app/session";
import { useT } from "@/components/app/i18n";
import { Assistant } from "@/components/app/assistant";
import { useNewActions } from "@/components/app/new-menu";
import { placeIsOpen, useProjectPlaces } from "@/components/app/project-places";
import { Logo } from "@/components/logo";
import type { MessageKey } from "@/lib/i18n";
import { orgAreasFor } from "@/lib/org-areas";
import { holdsType } from "@/lib/authority";

/**
 * The main sections. A bottom tab bar on phones, a left sidebar from lg up.
 *
 * Two places for everyone: Home (what is waiting on you, and how the project stands) and
 * Projects (the work, progress against targets, the reports built from both, the project's
 * set-up, and what runs across projects). In the sidebar Projects lists its groups, and one
 * group at a time lists its places: a short list to read, not every page of the app at once. Starting
 * something new is an action, not a place: the "+" in the middle of the phone's tab bar, and
 * "+ New" in the top bar on a wide screen. The assistant and a person's own pages are in the
 * top bar, on every screen.
 */

type Section = { id: string; href: string; label: MessageKey; also: string[]; icon: React.ReactNode; staffOnly?: boolean; donorOnly?: boolean; orgOnly?: boolean };

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-6 w-6 shrink-0">
    <path d={d} />
  </svg>
);

/**
 * Running the organization (HR, pay, procurement, suppliers) sits apart, for the people whose
 * role needs it: in the sidebar on a wide screen and a fourth tab on a phone, because for HR and
 * Finance staff it is where their records are. Resources is in the sidebar and, on a phone, in
 * the person menu.
 */
const SECTIONS: Section[] = [
  { id: "home", href: "/home", label: "nav.home", also: ["/people/me", "/timesheets", "/expenses", "/leave"], icon: icon("M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9") },
  { id: "project", href: "/project", label: "nav.projects", also: ["/work", "/field", "/procurement", "/progress", "/setup", "/settings", "/design", "/portfolio"], icon: icon("M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z") },
  // A donor's third place: the reports Roots of Peace has released to them, with how their grant is being spent.
  { id: "released", href: "/progress/released", label: "hub.reports", also: [], icon: icon("M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"), donorOnly: true },
  {
    id: "organization",
    href: "/organization",
    label: "nav.organization",
    also: ["/people", "/payroll", "/onboarding", "/offboarding", "/work/plan", "/work/procurements", "/work/suppliers", "/work/bills", "/work/closeout", "/settings/organization", "/settings/people", "/settings/health", "/resources"],
    icon: icon("M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01"),
    staffOnly: true,
    orgOnly: true,
  },
];

function useSections() {
  const { user } = useSession();
  const path = usePathname();
  const org = orgAreasFor(user ?? null, (r) => !!user && holdsType(user.id, r)).length > 0;
  const shown = SECTIONS.filter((s) => (!s.staffOnly || user?.kind === "employee") && (!s.donorOnly || user?.kind === "donor") && (!s.orgOnly || org));
  // The section with the longest matching path wins, so /people opens People, not Home, for HR.
  const score = (s: Section) => Math.max(-1, ...[s.href, ...s.also].filter((p) => path === p || path.startsWith(`${p}/`)).map((p) => p.length));
  const best = Math.max(...shown.map(score));
  // On a tie (People's pages are also listed under Home), the more specific section wins.
  const tied = shown.filter((x) => best >= 0 && score(x) === best);
  const activeId = (tied.find((x) => x.id !== "home") ?? tied[0])?.id;
  const isActive = (s: Section) => s.id === activeId;
  return { shown, isActive };
}

export function AppFrame({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const { t } = useT();
  const { shown, isActive } = useSections();
  const path = usePathname();
  const source = useSearchParams().get("source");
  const groups = useProjectPlaces();
  const actions = useNewActions();
  const [adding, setAdding] = useState(false);
  // The sidebar opens the group the page on screen belongs to; a person can open another ("" is all closed).
  const [picked, setPicked] = useState<string | null>(null);
  const current = groups.find((g) => g.places.some((pl) => placeIsOpen(pl, path, source)))?.id ?? null;
  const openGroup = picked ?? current;
  // A new page closes the New sheet and goes back to that page's own group. Escape closes the sheet too.
  useEffect(() => {
    setAdding(false);
    setPicked(null);
  }, [path, source]);
  useEffect(() => {
    if (!adding) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAdding(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [adding]);
  if (!user) return <>{children}</>;
  const staff = user.kind === "employee";
  // For a donor the project is two places, Progress and Reports, so Projects opens Progress directly.
  const hrefOf = (s: Section) => (s.id === "project" && !staff ? "/progress" : s.href);
  const labelOf = (s: Section): MessageKey => (s.id === "project" && !staff ? "nav.progress" : s.label);
  // The phone tab bar: Home, Projects, then Organization for the people whose role opens part of
  // it. A donor has three tabs: Home, Progress and Reports. Staff with something to start get a
  // round "+" just above the bar, at the end, under the thumb.
  const tabs = shown.filter((x) => x.id === "home" || x.id === "project" || x.id === "released" || x.id === "organization");
  const canAdd = staff && actions.length > 0;
  const tab = (s: Section) => {
    const on = isActive(s) && !adding;
    return (
      <li key={s.id}>
        <Link href={hrefOf(s)} aria-current={on ? "page" : undefined} className={`flex h-16 flex-col items-center justify-center gap-0.5 text-xs ${on ? "font-semibold text-forest" : "text-muted"}`}>
          {s.icon}
          {t(labelOf(s))}
        </Link>
      </li>
    );
  };
  return (
    <>
      <aside className="fixed inset-y-0 start-0 z-40 hidden w-56 flex-col overflow-y-auto border-e border-line bg-surface lg:flex">
        <Link href="/home" className="flex flex-col items-start gap-3 px-6 pb-4 pt-7">
          <Logo className="w-[150px]" />
          <span className="text-xs font-medium text-muted">Workflow</span>
        </Link>
        <nav aria-label={t("nav.label")} className="mt-2 flex flex-col gap-1 px-3 pb-6">
          {shown.flatMap((s) => {
            const on = isActive(s);
            const link = (
              <Link
                key={s.id}
                href={hrefOf(s)}
                aria-current={on ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${on ? "bg-mist font-semibold text-forest" : "text-muted hover:bg-sunken hover:text-ink"}`}
              >
                {s.icon}
                {t(labelOf(s))}
              </Link>
            );
            // Only the open section lists its groups, and only the open group lists its places.
            if (s.id !== "project" || !on) return [link];
            return [
              link,
              ...groups.flatMap((g) => {
                const open = openGroup === g.id;
                return [
                  <button
                    key={`group-${g.id}`}
                    type="button"
                    onClick={() => setPicked(open ? "" : g.id)}
                    aria-expanded={open}
                    className={`ms-9 flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-start text-sm hover:bg-sunken hover:text-ink ${current === g.id ? "font-semibold text-ink" : "text-muted"}`}
                  >
                    {t(g.label)}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-90" : "rtl:rotate-180"}`}>
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>,
                  ...(open
                    ? g.places.map((pl) => {
                        const here = placeIsOpen(pl, path, source);
                        return (
                          <Link key={pl.href} href={pl.href} aria-current={here ? "page" : undefined} className={`ms-12 rounded-lg px-3 py-1.5 text-sm ${here ? "font-semibold text-forest" : "text-muted hover:bg-sunken hover:text-ink"}`}>
                            {t(pl.label)}
                          </Link>
                        );
                      })
                    : []),
                ];
              }),
            ];
          })}
        </nav>
      </aside>

      {/* Room at the bottom for the tab bar and, on a wide screen for staff, the assistant button, so they never cover the last row. */}
      <div className={canAdd ? "pb-[calc(9rem+env(safe-area-inset-bottom))] lg:ps-56 lg:pb-24" : staff ? "pb-[calc(5rem+env(safe-area-inset-bottom))] lg:ps-56 lg:pb-24" : "pb-[calc(4rem+env(safe-area-inset-bottom))] lg:ps-56 lg:pb-0"}>{children}</div>

      <nav aria-label={t("nav.label")} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map(tab)}
        </ul>
      </nav>

      {/* Starting something new is one tap from every screen: a round button just above the tab bar, under the thumb. */}
      {canAdd && (
        <button
          type="button"
          onClick={() => setAdding(!adding)}
          aria-expanded={adding}
          aria-controls="new-sheet"
          aria-label={t("nav.newTitle")}
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] end-4 z-[46] grid h-14 w-14 place-items-center rounded-full bg-forest text-forest-ink shadow-lg shadow-black/30 active:scale-95 lg:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden className={`h-7 w-7 transition-transform ${adding ? "rotate-45" : ""}`}>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}

      {adding && (
        // Above the header, and ending at the tab bar so the tabs stay visible and usable.
        <div className="fixed inset-x-0 top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[45] lg:hidden" onClick={() => setAdding(false)}>
          <div aria-hidden className="absolute inset-0 bg-black/30" />
          <section
            id="new-sheet"
            role="dialog"
            aria-label={t("nav.newTitle")}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 max-h-[85%] overflow-y-auto rounded-t-2xl border border-line bg-paper px-4 pb-24 pt-3 shadow-[0_-20px_40px_-20px_rgb(19_32_26/0.5)]"
          >
            <p className="px-2 pb-1 text-sm font-semibold">{t("nav.newTitle")}</p>
            <ul className="divide-y divide-line">
              {actions.map((a) => (
                <li key={a.key}>
                  {a.external ? (
                    <a href={a.href} target="_blank" rel="noopener noreferrer" onClick={() => setAdding(false)} className="flex min-h-12 items-center px-2 text-base">
                      {t(a.label)}&nbsp;<span aria-hidden>↗</span>
                    </a>
                  ) : (
                    <Link href={a.href} onClick={() => setAdding(false)} className="flex min-h-12 items-center px-2 text-base">
                      {t(a.label)}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {/* The assistant works on project data, so it is for staff, not donors. */}
      {staff && <Assistant />}
    </>
  );
}
