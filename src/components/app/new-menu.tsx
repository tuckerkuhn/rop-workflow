"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { hasStarted, useProjectStage } from "@/components/app/project-stage";
import { useSession } from "@/components/app/session";
import { useKoboServer } from "@/components/app/use-project-data";
import { taskHref, taskSources } from "@/components/tasks/sources";
import type { MessageKey } from "@/lib/i18n";

/**
 * "+ New": the actions a person can start on this project, one line each, in a fixed order.
 * Places (Activities, the procurement calendar, Opportunities) are in the navigation, not here.
 * Only what this person may start, at this project's stage, is listed.
 */

type Action = { key: string; label: MessageKey; href: string; external?: boolean };

export function useNewActions(): Action[] {
  const { user } = useSession();
  const { project } = useCurrentProject();
  const stage = useProjectStage(project);
  const sources = user ? taskSources(user, project) : [];
  const field = sources.includes("field");
  const proc = sources.includes("procurement");
  const kobo = useKoboServer(field && project.saved ? project.id : null);
  if (!user || user.kind !== "employee") return [];
  const started = hasStarted(stage);
  const out: (Action | false)[] = [
    !!project.saved && { key: "task", label: "work.new.task", href: "/work?new=task" },
    !!project.saved && user.fieldAccess === "edit" && (project.handRecorded ?? 0) > 0 && { key: "result", label: "new.result", href: "/progress/results?record=1" },
    !!project.saved && (user.fieldAccess === "edit" || user.project.includes("mel-owner")) && { key: "weekly", label: "new.weekly", href: "/progress/weekly?new=1" },
    field && { key: "finding", label: "work.new.field", href: taskHref("field", "new=1") },
    field && { key: "step", label: "work.new.farmerStep", href: taskHref("field") },
    field && { key: "kobo", label: "new.kobo", href: kobo, external: true },
    proc && { key: "request", label: "work.new.procurement", href: taskHref("procurement", "new=1") },
    proc && !!project.saved && { key: "bill", label: "work.new.bill", href: "/work/bills" },
    started && { key: "report", label: "work.new.report", href: "/progress/report" },
    { key: "opportunity", label: "new.opportunity", href: "/work/opportunities?new=1" },
  ];
  return out.filter((a): a is Action => !!a);
}

export function NewMenu({ align = "end" }: { align?: "start" | "end" }) {
  const { t } = useT();
  const actions = useNewActions();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  if (!actions.length) return null;
  const item = "block rounded-lg px-3 py-2 text-sm hover:bg-sunken";
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" className="rounded-full bg-forest px-4 py-1.5 text-sm font-semibold text-paper hover:opacity-90">
        {t("new.button")}
      </button>
      {open && (
        <div role="menu" className={`absolute top-11 z-50 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-[0_20px_40px_-20px_rgb(19_32_26/0.5)] ${align === "end" ? "end-0" : "start-0"}`}>
          {actions.map((a) =>
            a.external ? (
              <a key={a.key} role="menuitem" href={a.href} target="_blank" rel="noopener noreferrer" className={item} onClick={() => setOpen(false)}>
                {t(a.label)} <span aria-hidden>↗</span>
              </a>
            ) : (
              <Link key={a.key} role="menuitem" href={a.href} className={item} onClick={() => setOpen(false)}>
                {t(a.label)}
              </Link>
            ),
          )}
        </div>
      )}
    </div>
  );
}
