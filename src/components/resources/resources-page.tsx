"use client";

import { useT } from "@/components/app/i18n";
import { useRequireUser } from "@/components/app/session";
import { Pill, TopBar } from "@/components/workspace/ui";
import type { MessageKey } from "@/lib/i18n";

/** The resource library. Categories only for now; their content comes later. */

const CATEGORIES: { id: string; label: MessageKey; icon: string }[] = [
  { id: "craft", label: "resources.craft", icon: "M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5ZM8 7h6M8 11h6" },
  { id: "templates", label: "resources.templates", icon: "M7 3h7l5 5v13H7V3Zm7 0v5h5M10 13h6M10 17h6" },
  { id: "viability", label: "resources.viability", icon: "M9 12l2 2 4-4M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" },
  { id: "dirty-dozen", label: "resources.dirtyDozen", icon: "M12 4 2.5 20h19L12 4Zm0 6v4m0 3h.01" },
];

export function ResourcesPage() {
  const { user } = useRequireUser();
  const { t } = useT();
  if (!user) return null;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="font-display text-4xl tracking-tight">{t("resources.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("resources.intro")}</p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <li key={c.id} className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-mist text-forest">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-6 w-6">
                  <path d={c.icon} />
                </svg>
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-lg">{t(c.label)}</h2>
                <Pill tone="muted">{t("resources.soon")}</Pill>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
