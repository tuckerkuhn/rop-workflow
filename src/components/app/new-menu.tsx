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
import { holdsType } from "@/lib/authority";
import { acrossProjectsFor } from "@/lib/org-areas";
import { procRolesFor } from "@/lib/procurement";

/**
 * "+ New": the actions a person can start on this project, one line each with a one-line hint,
 * in groups, in a fixed order. Places (Activities, the procurement calendar, Opportunities) are in
 * the navigation, not here. Only what this person can actually complete, at this project's stage,
 * is listed: the server checks the same things when they save.
 */

type Group = "work.group.execute" | "work.group.field" | "work.group.procurement" | "work.group.report" | "work.group.develop";
type Action = { key: string; label: MessageKey; href: string; group: Group; hint?: MessageKey; external?: boolean };

/** The actions in their groups, in the order the groups first appear. */
export function groupActions(actions: Action[]): { group: Group; actions: Action[] }[] {
  const out: { group: Group; actions: Action[] }[] = [];
  for (const a of actions) {
    const g = out.find((x) => x.group === a.group);
    if (g) g.actions.push(a);
    else out.push({ group: a.group, actions: [a] });
  }
  return out;
}

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
  const canSeeOpportunities = acrossProjectsFor(user, (r) => holdsType(user.id, r)).some((a) => a.id === "opportunities");
  // A purchase request is started by a budget holder with edit access (procurement workspace, "+ New
  // request"). Other staff who may change Procurement ask from the procurement calendar instead.
  const mayEditProc = proc && user.procurementAccess === "edit";
  const requestHref = !mayEditProc ? null : procRolesFor(user).includes("holder") ? taskHref("procurement", "new=1") : "/work/plan";
  // Recording a bill is given, not assumed: Finance and the people named for bill entry (api/projects/[code]/bills).
  const mayRecordBills = holdsType(user.id, "finance") || holdsType(user.id, "bills") || user.procurement.includes("finance");
  const out: (Action | false)[] = [
    !!project.saved && { key: "task", label: "work.new.task", hint: "work.new.taskHint", href: "/work?new=task", group: "work.group.execute" },
    !!project.saved && user.fieldAccess === "edit" && (project.handRecorded ?? 0) > 0 && { key: "result", label: "new.result", href: "/progress/results?record=1", group: "work.group.execute" },
    !!project.saved && (user.fieldAccess === "edit" || user.project.includes("mel-owner")) && { key: "weekly", label: "new.weekly", href: "/progress/weekly?new=1", group: "work.group.execute" },
    field && { key: "finding", label: "work.new.field", hint: "work.new.fieldHint", href: taskHref("field", "new=1"), group: "work.group.field" },
    // Field activities shows where each farmer is; KoboCollect records the visits.
    field && { key: "step", label: "work.new.farmerStep", hint: "work.new.farmerStepHint", href: taskHref("field"), group: "work.group.field" },
    field && { key: "kobo", label: "new.kobo", hint: "work.new.koboHint", href: kobo, external: true, group: "work.group.field" },
    !!requestHref && { key: "request", label: "work.new.procurement", hint: "work.new.procurementHint", href: requestHref, group: "work.group.procurement" },
    !!project.saved && mayRecordBills && { key: "bill", label: "work.new.bill", hint: "work.new.billHint", href: "/work/bills", group: "work.group.procurement" },
    started && { key: "report", label: "work.new.report", hint: "work.new.reportHint", href: "/progress/report", group: "work.group.report" },
    // Only for the people who can open Opportunities afterwards (lib/org-areas), so nobody records one they cannot find again.
    canSeeOpportunities && { key: "opportunity", label: "new.opportunity", hint: "work.new.opportunityHint", href: "/work/opportunities?new=1", group: "work.group.develop" },
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
        <div role="menu" className={`absolute top-11 z-50 max-h-[75vh] w-72 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-[0_20px_40px_-20px_rgb(19_32_26/0.5)] ${align === "end" ? "end-0" : "start-0"}`}>
          {groupActions(actions).map((g, k) => (
            <div key={g.group} role="group" aria-label={t(g.group)} className={k ? "mt-1 border-t border-line pt-1" : ""}>
              <p aria-hidden className="px-3 pb-0.5 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                {t(g.group)}
              </p>
              {g.actions.map((a) => {
                const body = (
                  <>
                    <span className="block font-medium">
                      {t(a.label)}
                      {a.external && <span aria-hidden> ↗</span>}
                    </span>
                    {a.hint && <span className="block text-xs text-muted">{t(a.hint)}</span>}
                  </>
                );
                return a.external ? (
                  <a key={a.key} role="menuitem" href={a.href} target="_blank" rel="noopener noreferrer" className={item} onClick={() => setOpen(false)}>
                    {body}
                  </a>
                ) : (
                  <Link key={a.key} role="menuitem" href={a.href} className={item} onClick={() => setOpen(false)}>
                    {body}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
