"use client";

import { useState } from "react";
import { modulesSaved, useProjectModules } from "@/components/app/project-modules";
import { useSession } from "@/components/app/session";
import { SectionLabel } from "@/components/workspace/ui";
import { MODULES, type ModuleId } from "@/lib/project-modules";

/**
 * Project settings: the parts of the app this project uses. Switching one off takes its pages out
 * of the menus for everyone on the project and deletes nothing.
 */
export function ProjectModulesSection({ code, canEdit }: { code: string; canEdit: boolean }) {
  const { user } = useSession();
  const modules = useProjectModules();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<ModuleId | null>(null);
  const set = async (id: ModuleId, on: boolean) => {
    if (!user) return;
    setBusy(id);
    setError("");
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(code)}/modules`, { method: "PUT", headers: { "Content-Type": "application/json", "x-demo-user": user.id }, body: JSON.stringify({ [id]: on }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? "Not saved.");
      modulesSaved(code, d.modules);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="mt-10" aria-labelledby="modules-heading">
      <div id="modules-heading">
        <SectionLabel>What this project uses</SectionLabel>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted">Switch off what this project does not do and its pages leave the menus. Nothing is deleted, and it can be switched back on at any time.</p>
      {error && (
        <p role="alert" className="mt-2 bg-clay-soft px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}
      <ul className="mt-2 border-t-2 border-ink">
        {MODULES.map((m) => (
          <li key={m.id} className="border-b border-line">
            <label className={`flex min-h-12 items-start gap-3 px-2 py-3 ${canEdit ? "cursor-pointer hover:bg-ochre-soft" : ""}`}>
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={modules[m.id]} disabled={!canEdit || busy === m.id} onChange={(e) => void set(m.id, e.target.checked)} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{m.label}</span>
                <span className="block text-sm text-muted">{m.help}</span>
              </span>
              <span className={`shrink-0 font-mono text-xs uppercase ${modules[m.id] ? "text-leaf" : "text-muted"}`}>{modules[m.id] ? "On" : "Off"}</span>
            </label>
          </li>
        ))}
      </ul>
      {!canEdit && <p className="mt-2 text-xs text-muted">The project manager and plan approvers change this.</p>}
    </section>
  );
}
