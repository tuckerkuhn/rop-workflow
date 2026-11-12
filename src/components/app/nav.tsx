"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/app/session";
import { useT } from "@/components/app/i18n";
import { Assistant } from "@/components/app/assistant";
import { LogoMark } from "@/components/logo";
import type { MessageKey } from "@/lib/i18n";
import { orgAreasFor } from "@/lib/org-areas";
import { holdsType } from "@/lib/authority";

/**
 * The four main sections. A bottom tab bar on phones, a left sidebar from lg up.
 * Field activities and procurement live inside Work; project design opens from Home.
 */

type Section = { id: string; href: string; label: MessageKey; also: string[]; icon: React.ReactNode; staffOnly?: boolean; orgOnly?: boolean; wideOnly?: boolean; places?: { href: string; label: MessageKey }[] };

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-6 w-6 shrink-0">
    <path d={d} />
  </svg>
);

/**
 * The reporting loop first: Record what happened, Check it, Report it. Running the organization
 * (HR, pay, procurement, suppliers) sits apart, for the people whose role needs it.
 */
const SECTIONS: Section[] = [
  { id: "home", href: "/home", label: "nav.home", also: ["/design", "/settings", "/setup", "/people/me", "/timesheets", "/expenses", "/leave"], icon: icon("M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9") },
  {
    id: "record",
    href: "/work",
    label: "nav.record",
    also: ["/field", "/procurement"],
    places: [
      { href: "/work/activities", label: "nav.activities" },
      { href: "/work/grants", label: "nav.grants" },
    ],
    icon: icon("M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"),
    staffOnly: true,
  },
  {
    id: "check",
    href: "/progress",
    label: "nav.check",
    also: [],
    places: [
      { href: "/progress/results", label: "nav.results" },
      { href: "/progress/review", label: "nav.review" },
      { href: "/progress/budget", label: "nav.budget" },
    ],
    icon: icon("M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"),
  },
  {
    id: "report",
    href: "/progress/report",
    label: "nav.report",
    also: ["/progress/weekly", "/progress/annual", "/progress/learning", "/progress/face", "/progress/stories", "/progress/photos"],
    places: [
      { href: "/progress/weekly", label: "nav.weekly" },
      { href: "/progress/report", label: "nav.quarterly" },
      { href: "/progress/annual", label: "nav.annual" },
      { href: "/progress/stories", label: "nav.stories" },
      { href: "/progress/photos", label: "nav.photos" },
      { href: "/progress/face", label: "nav.face" },
    ],
    icon: icon("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h5"),
    staffOnly: true,
  },
  {
    id: "organization",
    href: "/organization",
    label: "nav.organization",
    also: ["/people", "/payroll", "/onboarding", "/offboarding", "/work/plan", "/work/procurements", "/work/suppliers", "/work/bills", "/work/opportunities", "/work/closeout", "/portfolio", "/settings/organization", "/settings/people", "/settings/policy", "/settings/health"],
    icon: icon("M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01"),
    staffOnly: true,
    orgOnly: true,
  },
  { id: "resources", href: "/resources", label: "nav.resources", also: [], icon: icon("M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm0 16a2 2 0 0 1 2-2h13v2"), staffOnly: true, wideOnly: true },
];

function useSections() {
  const { user } = useSession();
  const path = usePathname();
  const org = orgAreasFor(user ?? null, (r) => !!user && holdsType(user.id, r)).length > 0;
  const shown = SECTIONS.filter((s) => (!s.staffOnly || user?.kind === "employee") && (!s.orgOnly || org));
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
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${shown.filter((x) => !x.wideOnly).length}, minmax(0, 1fr))` }}>
          {shown.filter((x) => !x.wideOnly).map((s) => {
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
