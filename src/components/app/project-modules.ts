"use client";

import { useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useSession } from "@/components/app/session";
import { ALL_MODULES, type Modules } from "@/lib/project-modules";

/**
 * The parts of the app the current project uses, read once per project and shared by the menus.
 * Until it loads, and when it cannot be read, every part shows: a page is never hidden by a failed load.
 */

const cache = new Map<string, Modules>();
// One read per project at a time, however many menus ask for it.
const reading = new Map<string, Promise<void>>();
// Whose parts are kept: another person signing in on this tab reads them afresh.
let keptFor = "";
const CHANGED = "rop-modules-changed";

/** Called after a save, so every menu on screen follows at once. */
export function modulesSaved(project: string, m: Modules) {
  cache.set(project, m);
  window.dispatchEvent(new CustomEvent(CHANGED));
}

export function useProjectModules(): Modules {
  const { user, ready } = useSession();
  const { project } = useCurrentProject();
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener(CHANGED, on);
    return () => window.removeEventListener(CHANGED, on);
  }, []);
  const userId = user?.id ?? "";
  if (userId !== keptFor) {
    cache.clear();
    reading.clear();
    keptFor = userId;
  }
  const employee = user?.kind === "employee";
  useEffect(() => {
    if (!ready || !userId || !employee || !project.saved || cache.has(project.id) || reading.has(project.id)) return;
    const id = project.id;
    const read = fetch(`/api/projects/${encodeURIComponent(id)}/modules`, { cache: "no-store", headers: { "x-demo-user": userId } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { modules?: Modules } | null) => {
        if (d?.modules && keptFor === userId) modulesSaved(id, { ...ALL_MODULES, ...d.modules });
      })
      .catch(() => undefined)
      .finally(() => {
        if (reading.get(id) === read) reading.delete(id);
      });
    reading.set(id, read);
  }, [ready, userId, employee, project.id, project.saved]);
  return cache.get(project.id) ?? ALL_MODULES;
}
