"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/components/app/session";
import { useT } from "@/components/app/i18n";
import { Assistant } from "@/components/app/assistant";
import { LogoMark } from "@/components/logo";
import type { MessageKey } from "@/lib/i18n";

/**
 * The four main sections. A bottom tab bar on phones, a left sidebar from lg up.
 * Field activities and procurement live inside Tasks; project design opens from Home.
 */

type Section = { id: string; href: string; label: MessageKey; also: string[]; icon: React.ReactNode; staffOnly?: boolean };

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-6 w-6 shrink-0">
    <path d={d} />
  </svg>
);

const SECTIONS: Section[] = [
  { id: "home", href: "/home", label: "nav.home", also: ["/design", "/settings", "/setup", "/people", "/timesheets", "/payroll", "/expenses"], icon: icon("M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9") },
  { id: "tasks", href: "/tasks", label: "nav.tasks", also: ["/field"], icon: icon("M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"), staffOnly: true },
  { id: "progress", href: "/progress", label: "nav.progress", also: [], icon: icon("M4 20V10M10 20V4M16 20v-7M22 20H2") },
  { id: "resources", href: "/resources", label: "nav.resources", also: [], icon: icon("M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm0 16a2 2 0 0 1 2-2h13v2"), staffOnly: true },
];

function useSections() {
  const { user } = useSession();
  const path = usePathname();
  const shown = SECTIONS.filter((s) => !s.staffOnly || user?.kind === "employee");
  const isActive = (s: Section) => [s.href, ...s.also].some((p) => path === p || path.startsWith(`${p}/`));
  return { shown, isActive };
}

export function AppFrame({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const { t } = useT();
  const { shown, isActive } = useSections();
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
