"use client";

import { useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { projects } from "@/lib/demo";

/**
 * The project the four sections show. A ?project= link picks it; otherwise the last one picked in
 * this browser, else the first project.
 */

type Project = (typeof projects)[number];
type CurrentProject = { project: Project; setProject: (id: string) => void };

const KEY = "rop-current-project";
const Ctx = createContext<CurrentProject | null>(null);
const byId = (id: string | null | undefined) => projects.find((p) => p.id === id);

function remember(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {}
}

export function CurrentProjectProvider({ children }: { children: React.ReactNode }) {
  const asked = byId(useSearchParams().get("project"));
  const [saved, setSaved] = useState<Project | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {}
    setSaved(byId(stored) ?? projects[0]);
  }, []);

  // A link's choice becomes the remembered one.
  useEffect(() => {
    if (!asked) return;
    setSaved(asked);
    remember(asked.id);
  }, [asked]);

  const setProject = useCallback((next: string) => {
    const p = byId(next);
    if (!p) return;
    setSaved(p);
    remember(p.id);
    // Drop a stale ?project= so it does not override the new choice.
    const url = new URL(window.location.href);
    if (url.searchParams.has("project")) {
      url.searchParams.delete("project");
      history.replaceState(null, "", url);
    }
  }, []);

  const project = asked ?? saved;
  // Wait for the stored choice so pages never flash the wrong project.
  if (!project) return null;
  return <Ctx.Provider value={{ project, setProject }}>{children}</Ctx.Provider>;
}

export function useCurrentProject() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCurrentProject must be used inside CurrentProjectProvider");
  return c;
}
