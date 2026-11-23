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
  const { project, projects, setProject } = useCurrentProject();
  const { t } = useT();
  const router = useRouter();
  const groups = useProjectPlaces();
  const donor = ready && !!user && user.kind !== "employee";
  useEffect(() => {
    if (donor) router.replace("/progress");
  }, [donor, router]);
  if (!user || donor) return null;
  // "All projects" (the portfolio) is listed for the people who may open it, and only with more than one project.
  const allProjects = groups.find((g) => g.id === "across")?.places.find((pl) => pl.href === "/portfolio");
  const shown = groups.map((g) => (g.id === "across" && allProjects ? { ...g, places: g.places.filter((pl) => pl !== allProjects) } : g)).filter((g) => g.places.length);
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">{t("nav.projects")}</p>
        <h1 className="mt-1 font-display text-4xl tracking-tight">{project.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {projects.length > 1 && (
            <label className="flex items-center gap-2">
              <span className="font-semibold">{t("hub.changeProject")}</span>
              <select value={project.id} onChange={(e) => setProject(e.target.value)} className="max-w-[16rem] truncate rounded-full border border-line bg-surface py-1.5 ps-3 pe-8 text-sm">
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {allProjects && (
            <Link href={allProjects.href} className="font-semibold text-forest hover:underline">
              {t(allProjects.label)} →
            </Link>
          )}
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted">{t("hub.intro")}</p>
        <div className="mt-6 grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((g) => (
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
