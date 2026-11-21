"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useProjectPlaces } from "@/components/app/project-places";
import { useRequireUser } from "@/components/app/session";
import { TopBar } from "@/components/workspace/ui";

/**
 * Projects: every place of the current project on one page, in groups (the work, progress against
 * targets, reports, set-up for the people who may change it, and what runs across projects for
 * the roles that open it). On a phone this is how each place is reached; a donor has one place,
 * Progress, and goes straight there.
 */
export function ProjectHub() {
  const { user, ready } = useRequireUser();
  const { project } = useCurrentProject();
  const { t } = useT();
  const router = useRouter();
  const groups = useProjectPlaces();
  const donor = ready && !!user && user.kind !== "employee";
  useEffect(() => {
    if (donor) router.replace("/progress");
  }, [donor, router]);
  if (!user || donor) return null;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <h1 className="font-display text-4xl tracking-tight">{t("nav.projects")}</h1>
        <p className="mt-2 font-semibold">{project.name}</p>
        <p className="max-w-2xl text-sm text-muted">{t("hub.intro")}</p>
        <div className="mt-6 grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <section key={g.id} aria-labelledby={`hub-${g.id}`} className="rounded-2xl border border-line bg-surface p-4">
              <h2 id={`hub-${g.id}`} className="text-xl font-semibold">
                {t(g.label)}
              </h2>
              <ul className="mt-1 divide-y divide-line">
                {g.places.map((pl) => (
                  <li key={pl.href}>
                    <Link href={pl.href} className="flex min-h-12 items-center gap-3 py-2 text-sm hover:text-forest">
                      <span className="min-w-0 flex-1">{t(pl.label)}</span>
                      <span aria-hidden className="shrink-0 text-muted rtl:rotate-180">
                        ›
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
