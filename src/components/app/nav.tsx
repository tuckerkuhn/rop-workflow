"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/app/session";
import { useT } from "@/components/app/i18n";
import { Assistant } from "@/components/app/assistant";
import { LogoMark } from "@/components/logo";
import type { MessageKey } from "@/lib/i18n";
import { HR_ACCESS_ROLES } from "@/lib/hr";
import { holdsType } from "@/lib/authority";

/**
 * The four main sections. A bottom tab bar on phones, a left sidebar from lg up.
 * Field activities and procurement live inside Work; project design opens from Home.
 */

type Section = { id: string; href: string; label: MessageKey; also: string[]; icon: React.ReactNode; staffOnly?: boolean; hrOnly?: boolean; places?: { href: string; label: MessageKey }[] };

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-6 w-6 shrink-0">
    <path d={d} />
  </svg>
);

const SECTIONS: Section[] = [
  { id: "home", href: "/home", label: "nav.home", also: ["/design", "/settings", "/setup", "/people", "/timesheets", "/payroll", "/expenses", "/onboarding", "/offboarding", "/leave", "/portfolio"], icon: icon("M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9") },
  {
    id: "work",
    href: "/work",
    label: "nav.work",
    also: ["/field", "/procurement"],
    // Places within Work, as opposed to actions (those are under "+ New").
    places: [
      { href: "/work/activities", label: "nav.activities" },
      { href: "/work/plan", label: "nav.procCalendar" },
      { href: "/work/opportunities", label: "nav.opportunities" },
    ],
    icon: icon("M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM18 9a9 9 0 0 1-9 9"), staffOnly: true },
  { id: "progress", href: "/progress", label: "nav.progress", also: [], icon: icon("M4 20V10M10 20V4M16 20v-7M22 20H2") },
  // The HR record, for anyone holding an HR role, so HR never needs Home to reach it.
  { id: "people", href: "/people", label: "nav.people", also: ["/payroll", "/onboarding", "/offboarding"], icon: icon("M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM22 19v-1a4 4 0 0 0-3-3.87M16 4.13a3 3 0 0 1 0 5.74"), staffOnly: true, hrOnly: true },
  { id: "resources", href: "/resources", label: "nav.resources", also: [], icon: icon("M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm0 16a2 2 0 0 1 2-2h13v2"), staffOnly: true },
];

function useSections() {
  const { user } = useSession();
  const path = usePathname();
  const hr = !!user && HR_ACCESS_ROLES.some((r) => holdsType(user.id, r));
  const shown = SECTIONS.filter((s) => (!s.staffOnly || user?.kind === "employee") && (!s.hrOnly || hr));
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
  if (!user) return <>{children}</>;
  return (
    <>
      <aside className="fixed inset-y-0 start-0 z-40 hidden w-56 flex-col border-e border-line bg-surface lg:flex">
        <Link href="/home" className="flex items-center gap-2 px-5 py-4">
          <LogoMark className="h-7 w-7" />
          <span className="font-display text-sm">Roots of Peace</span>
        </Link>
        <nav aria-label={t("nav.label")} className="mt-2 flex flex-col gap-1 px-3">
          {shown.map((s) => {
            const on = isActive(s);
            return (
              <Link
                key={s.id}
                href={s.href}
                aria-current={on ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${on ? "bg-mist font-semibold text-forest" : "text-muted hover:bg-sunken hover:text-ink"}`}
              >
                {s.icon}
                {t(s.label)}
              </Link>
            );
          }).flatMap((link, k) => {
            const s = shown[k];
            if (!s.places || user.kind !== "employee") return [link];
            return [
              link,
              ...s.places.map((pl) => {
                const here = path === pl.href || path.startsWith(`${pl.href}/`);
                return (
                  <Link key={pl.href} href={pl.href} aria-current={here ? "page" : undefined} className={`ms-9 rounded-lg px-3 py-1.5 text-sm ${here ? "font-semibold text-forest" : "text-muted hover:bg-sunken hover:text-ink"}`}>
                    {t(pl.label)}
                  </Link>
                );
              }),
            ];
          })}
        </nav>
      </aside>

      {/* Room at the bottom for the tab bar and, for staff, the assistant button, so they never cover the last row. */}
      <div className={user.kind === "employee" ? "pb-[calc(9rem+env(safe-area-inset-bottom))] lg:ps-56 lg:pb-24" : "pb-[calc(4rem+env(safe-area-inset-bottom))] lg:ps-56 lg:pb-0"}>{children}</div>

      <nav
        aria-label={t("nav.label")}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
          {shown.map((s) => {
            const on = isActive(s);
            return (
              <li key={s.id}>
                <Link
                  href={s.href}
                  aria-current={on ? "page" : undefined}
                  className={`flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] ${on ? "font-semibold text-forest" : "text-muted"}`}
                >
                  {s.icon}
                  {t(s.label)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* The assistant works on project data, so it is for staff, not donors. */}
      {user.kind === "employee" && <Assistant />}
    </>
  );
}
