"use client";

import { useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useSession } from "@/components/app/session";
import { FormatLine } from "@/components/progress/report-calendar";
import type { ObligationFormat } from "@/app/api/projects/[code]/obligations/route";

/**
 * Next to a report: the format each donor asks for in its agreement (lib/obligations), with the
 * template's link when there is one. Nothing when the agreement names no format.
 */
export function FormatAskedFor({ frequencies }: { frequencies: string[] }) {
  const { user, ready } = useSession();
  const { project } = useCurrentProject();
  const [list, setList] = useState<ObligationFormat[]>([]);
  useEffect(() => {
    if (!ready || !user || user.kind !== "employee" || !project.saved) return;
    let live = true;
    fetch(`/api/projects/${project.id}/obligations`, { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { obligations?: ObligationFormat[] } | null) => live && setList(d?.obligations ?? []))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [ready, user, project.id, project.saved]);
  const shown = list.filter((o) => o.format && frequencies.includes(o.frequency));
  if (!shown.length) return null;
  return (
    <ul className="mt-3 border-y border-line font-ledger" aria-label="Formats the donors ask for">
      {shown.map((o) => (
        <li key={`${o.donor ?? ""}|${o.name}`} className="flex flex-wrap items-baseline gap-x-3 border-b border-line px-3 py-1.5 last:border-b-0">
          <span className="font-mono text-xs text-muted">
            {o.name}
            {o.donor ? `, ${o.donor}` : ""}
          </span>
          <FormatLine format={o.format!} />
        </li>
      ))}
    </ul>
  );
}
