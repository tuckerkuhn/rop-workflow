"use client";

import { useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useSession } from "@/components/app/session";
import { localeOf } from "@/lib/i18n";
import { projects as demoProjects, type ProjectInfo } from "@/lib/demo";
import type { ProjectSummary } from "@/lib/project-setup";
import { setDemoClock } from "@/lib/clock";
import { setProcurementRules } from "@/lib/procurement";
import type { Value } from "@/lib/policy";

/**
 * The project the four sections show, and every project there is: the demo projects plus
 * projects created in setup. A ?project= link picks it; otherwise the last one picked in this
 * browser, else the first project.
 */

/** `rulesFor` changes once a project's rules have loaded, so screens that read them draw again. */
type CurrentProject = { project: ProjectInfo; setProject: (id: string) => void; projects: ProjectInfo[]; reload: () => Promise<void>; rulesFor: string | null };

const KEY = "rop-current-project";
const Ctx = createContext<CurrentProject | null>(null);

function remember(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {}
}

export function CurrentProjectProvider({ children }: { children: React.ReactNode }) {
  const { user, ready } = useSession();
  const { lang } = useT();
  const askedId = useSearchParams().get("project");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [stored, setStored] = useState<ProjectSummary[] | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/projects", { cache: "no-store", headers: { "x-demo-user": user.id } });
      setStored(res.ok ? ((await res.json()) as { projects: ProjectSummary[] }).projects : []);
    } catch {
      setStored([]);
    }
  }, [user]);

  useEffect(() => {
    if (ready && user) void reload();
  }, [ready, user, reload]);

  const projects = useMemo(() => {
    const names = new Intl.DisplayNames([localeOf(lang)], { type: "region" });
    const fromDb = (stored ?? []).filter((p) => !demoProjects.some((d) => d.id === p.code));
    return [
      ...demoProjects.map((d) => ({ ...d, saved: (stored ?? []).some((p) => p.code === d.id) })),
      ...fromDb.map(
        (p): ProjectInfo => ({
          id: p.code,
          name: p.name,
          country: names.of(p.country) ?? p.country,
          season: p.startDate && p.endDate ? `${p.startDate.slice(0, 4)}–${p.endDate.slice(0, 4)}` : "",
          orgId: "rop",
          status: "Active",
          stage: "Design",
          note: p.goal ?? "",
          // Procurement runs from the budget and calendar saved in setup.
          workflows: ["procurement"],
          crop: p.crop ?? undefined,
          saved: true,
        }),
      ),
    ];
  }, [stored, lang]);
  const byId = useCallback((id: string | null | undefined) => projects.find((p) => p.id === id), [projects]);

  useEffect(() => {
    let id: string | null = null;
    try {
      id = localStorage.getItem(KEY);
    } catch {}
    setSavedId(id ?? demoProjects[0].id);
  }, []);

  // A link's choice becomes the remembered one, once that project is known.
  useEffect(() => {
    if (askedId && byId(askedId)) {
      setSavedId(askedId);
      remember(askedId);
    }
  }, [askedId, byId]);

  const setProject = useCallback((next: string) => {
    setSavedId(next);
    remember(next);
    // Drop a stale ?project= so it does not override the new choice.
    const url = new URL(window.location.href);
    if (url.searchParams.has("project")) {
      url.searchParams.delete("project");
      history.replaceState(null, "", url);
    }
  }, []);

  // A project created in setup (linked or remembered) waits for the project list instead of showing another one first.
  const waiting = savedId === null || (stored === null && !!user && ((!!askedId && !byId(askedId)) || !byId(savedId)));
  const project = byId(askedId) ?? byId(savedId) ?? projects[0];

  // The rules this project follows (its organization's policy combined with its donor's): procurement reads them.
  const [rulesFor, setRulesFor] = useState<string | null>(null);
  const projectId = project?.id;
  const projectSaved = !!project?.saved;
  // Saved projects run on the real date; demo projects on their fixed date. Set before children render.
  setDemoClock(!!project && !projectSaved);
  useEffect(() => {
    if (!user || !projectId) return;
    if (!projectSaved) {
      setProcurementRules(null);
      setRulesFor(projectId);
      return;
    }
    let live = true;
    fetch(`/api/projects/${projectId}/policy`, { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: { lines: { key: string; value: Value; conflict: string | null; decision: unknown }[] } | null) => {
        if (!live) return;
        // An undecided conflict leaves that rule at the organization's own value until an administrator decides.
        setProcurementRules(v ? Object.fromEntries(v.lines.filter((l) => !l.conflict || l.decision).map((l) => [l.key, l.value])) : null);
        setRulesFor(projectId);
      })
      .catch(() => live && setRulesFor(projectId));
    return () => {
      live = false;
    };
  }, [user, projectId, projectSaved]);

  if (waiting) return null;
  return <Ctx.Provider value={{ project, setProject, projects, reload, rulesFor }}>{children}</Ctx.Provider>;
}

export function useCurrentProject() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCurrentProject must be used inside CurrentProjectProvider");
  return c;
}
