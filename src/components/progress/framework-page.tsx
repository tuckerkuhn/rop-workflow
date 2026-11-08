"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import type { FrameworkAction } from "@/lib/framework";
import { indicatorStatus } from "@/components/progress/indicator-table";
import type { FrameworkView, TreeNode } from "@/server/framework-store";

/**
 * The results framework as a tree: the goal, each outcome and output, the activities under them,
 * and on each activity its indicators (this year's progress) and ROP's sub-activities (status).
 */

const TIMING: Record<string, string> = { late: "late", due_now: "due this quarter", done: "done", cancelled: "cancelled", upcoming: "later", unscheduled: "no quarter planned" };
const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });

async function call(url: string, user: string, init?: RequestInit): Promise<FrameworkView> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as FrameworkView;
}

function Wording({ k, level, text, source, suggested, canEdit, save }: { k: string; level: string; text: string | null; source: string | null; suggested: { text: string; source: string } | null; canEdit: boolean; save: (a: FrameworkAction) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [t, setT] = useState(text ?? suggested?.text ?? "");
  const [s, setS] = useState(source ?? suggested?.source ?? "");
  if (editing)
    return (
      <form
        className="mt-1 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ key: k, text: t, source: s }).then(() => setEditing(false));
        }}
      >
        <textarea value={t} onChange={(e) => setT(e.target.value)} rows={2} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" aria-label={`${level} statement`} />
        <input value={s} onChange={(e) => setS(e.target.value)} placeholder="Where the wording comes from (document and page)" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs" />
        <div className="flex gap-2">
          <button type="submit" className={primaryBtn}>
            Save
          </button>
          <button type="button" className={quietBtn} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </form>
    );
  return (
    <div>
      {text ? (
        <p className="text-sm">{text}</p>
      ) : suggested ? (
        <p className="text-sm italic text-muted">Suggested: {suggested.text}</p>
      ) : (
        <p className="text-sm italic text-muted">Not worded yet.</p>
      )}
      <p className="text-[11px] text-muted">
        {source ?? (suggested ? `From ${suggested.source}` : "")}
        {canEdit && (
          <>
            {" "}
            {suggested && !text && (
              <button type="button" className="font-semibold text-forest hover:underline" onClick={() => void save({ key: k, text: suggested.text, source: suggested.source })}>
                Accept
              </button>
            )}{" "}
            <button type="button" className="font-semibold text-forest hover:underline" onClick={() => setEditing(true)}>
              {text || suggested ? "Edit" : "Word it"}
            </button>
          </>
        )}
      </p>
    </div>
  );
}

function Node({ node, canEdit, save, year }: { node: TreeNode; canEdit: boolean; save: (a: FrameworkAction) => Promise<void>; year: number | string }) {
  const depth = node.key.split(".").length;
  const wrap = depth === 1 ? "mt-6 rounded-2xl border border-line bg-surface p-4" : depth === 2 ? "mt-4 border-s-2 border-forest/40 ps-4" : "mt-3 rounded-xl bg-paper p-3";
  return (
    <section className={wrap} aria-label={`${node.level} ${node.key}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ochre">
        {node.level} {node.key}
      </p>
      {node.level === "Activity" ? <p className="text-sm font-semibold">{node.text ?? "—"}</p> : <Wording k={node.key} level={node.level} text={node.text} source={node.source} suggested={node.suggested} canEdit={canEdit} save={save} />}
      {node.indicators.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {node.indicators.map((i) => {
            const st = indicatorStatus(i);
            return (
              <li key={i.code} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-mono text-xs text-muted">{i.donorCode}</span>
                <Link href={`/progress/results?indicator=${i.code}`} className="min-w-0 flex-1 hover:text-forest">
                  {i.name}
                </Link>
                <span className="tabular-nums text-xs">
                  {n(i.year)} of {n(i.yearTarget)} {i.unit} in {year}
                </span>
                <Pill tone={st.tone}>{st.text}</Pill>
              </li>
            );
          })}
        </ul>
      )}
      {node.activities.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          ROP&rsquo;s work:{" "}
          {node.activities.map((a, k) => (
            <span key={a.code}>
              {k > 0 && " · "}
              <Link href="/work/activities" className="hover:text-forest">
                {a.code} {TIMING[a.timing] ?? a.status}
                {a.owner ? ` (${a.owner})` : ""}
              </Link>
            </span>
          ))}
        </p>
      )}
      {node.children.map((c) => (
        <Node key={c.key} node={c} canEdit={canEdit} save={save} year={year} />
      ))}
    </section>
  );
}

export function FrameworkPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const [v, setV] = useState<FrameworkView | null>(null);
  const [error, setError] = useState("");
  const url = `/api/projects/${project.id}/framework`;
  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call(url, user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, url]);
  useEffect(() => {
    if (ready && user && project.saved) void load();
  }, [ready, user, project.saved, load]);
  if (!user) return null;
  const save = async (a: FrameworkAction) => {
    setError("");
    try {
      setV(await call(url, user.id, { method: "POST", body: JSON.stringify(a) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <Link href="/progress" className="text-sm text-muted hover:text-ink">
          ← Progress
        </Link>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Results framework</h1>
        <p className="mt-1 text-sm text-muted">From the goal down to each indicator and ROP&rsquo;s activities, with this year&rsquo;s progress. The tree follows the donor&rsquo;s codes; each statement says where its wording comes from.</p>
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {!project.saved && <p className="mt-6 text-sm text-muted">This project has no saved results framework.</p>}
        {!v && project.saved && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {v && (
          <>
            <section className="mt-6 rounded-2xl bg-mist p-4" aria-label="Goal">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-forest">Goal</p>
              <Wording k="goal" level="Goal" text={v.goal.text} source={v.goal.source} suggested={v.goal.suggested} canEdit={v.can.edit} save={save} />
            </section>
            {v.outcomes.map((o) => (
              <Node key={o.key} node={o} canEdit={v.can.edit} save={save} year={v.year} />
            ))}
          </>
        )}
      </main>
    </div>
  );
}
