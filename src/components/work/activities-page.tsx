"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { ACTIVITY_STATUSES, STATUS_LABEL, type ActivityAction, type ActivityStatus, type Timing } from "@/lib/activities";
import type { ActivitiesView } from "@/server/activities-store";

/**
 * Execute: ROP's workplan activities as they are carried out. Each has an owner, a status with the
 * dates it actually started and finished, what is in the way, and the tasks made for it. Late
 * means its last planned quarter has ended and it is not done.
 */

type Row = ActivitiesView["rows"][number];
type Filter = "all" | "mine" | "late" | "due_now" | "unowned";

const TIMING: Record<Timing, { tone: "clay" | "ochre" | "forest" | "muted" | "sky"; text: string }> = {
  late: { tone: "clay", text: "Late" },
  due_now: { tone: "ochre", text: "Due this quarter" },
  upcoming: { tone: "sky", text: "Later" },
  done: { tone: "forest", text: "Done" },
  cancelled: { tone: "muted", text: "Cancelled" },
  unscheduled: { tone: "muted", text: "No quarter planned" },
};
const quarterLabel = (q: string) => `Q${Math.floor((Number(q.slice(5, 7)) - 1) / 3) + 1} ${q.slice(0, 4)}`;
const field = "rounded-lg border border-line bg-surface px-3 py-2 text-sm";

async function call(url: string, user: string, init?: RequestInit): Promise<ActivitiesView> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as ActivitiesView;
}

function ActivityRow({ r, v, act }: { r: Row; v: ActivitiesView; act: (a: ActivityAction) => Promise<void> }) {
  const [open, setOpen] = useState<"status" | "task" | null>(null);
  const [status, setStatus] = useState<ActivityStatus>(r.status === "not_started" ? "in_progress" : r.status);
  const [on, setOn] = useState(v.today);
  const [blocker, setBlocker] = useState(r.blocker);
  const [task, setTask] = useState({ title: "", date: "", assignee: r.owner ?? "" });
  const may = v.can.manage || r.mine;
  const t = TIMING[r.timing];
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className="font-mono text-xs text-muted">{r.code}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{r.title}</p>
          <p className="text-xs text-muted">
            {r.active.length ? r.active.map(quarterLabel).join(", ") : "No quarter in the workplan"}
            {r.target > 0 && r.unit ? ` · target ${r.target.toLocaleString("en-US")} ${r.unit}` : ""}
            {r.startedOn ? ` · started ${r.startedOn}` : ""}
            {r.doneOn ? ` · done ${r.doneOn}` : ""}
          </p>
          {r.blocker && <p className="mt-0.5 text-xs text-clay">{r.blocker}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {r.status !== "done" && r.status !== "not_started" && <Pill tone="muted">{STATUS_LABEL[r.status]}</Pill>}
          <Pill tone={t.tone}>{t.text}</Pill>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {v.can.manage ? (
          <select aria-label={`Owner of ${r.code}`} value={r.owner ?? ""} onChange={(e) => void act({ action: "assign", code: r.code, owner: e.target.value || null })} className={field}>
            <option value="">No owner</option>
            {v.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-muted">{r.ownerName ? `Owner: ${r.ownerName}` : "No owner yet"}</span>
        )}
        {may && (
          <>
            <button type="button" className={quietBtn} onClick={() => setOpen(open === "status" ? null : "status")}>
              Update status
            </button>
            <button type="button" className={quietBtn} onClick={() => setOpen(open === "task" ? null : "task")}>
              + Task
            </button>
          </>
        )}
      </div>
      {open === "status" && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act({ action: "status", code: r.code, status, on, blocker }).then(() => setOpen(null));
          }}
        >
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as ActivityStatus)} className={field}>
            {ACTIVITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <input type="date" aria-label="From" value={on} max={v.today} onChange={(e) => setOn(e.target.value)} className={field} />
          <input placeholder={status === "on_hold" || status === "cancelled" ? "What is in the way (required)" : "Note (optional)"} value={blocker} onChange={(e) => setBlocker(e.target.value)} className={`${field} min-w-0 flex-1`} />
          <button type="submit" className={primaryBtn}>
            Save
          </button>
        </form>
      )}
      {open === "task" && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!task.title.trim()) return;
            void act({ action: "task", code: r.code, title: task.title, date: task.date || null, assignee: task.assignee || null }).then(() => {
              setOpen(null);
              setTask({ title: "", date: "", assignee: r.owner ?? "" });
            });
          }}
        >
          <input placeholder="What needs doing" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} className={`${field} min-w-0 flex-1`} />
          <input type="date" aria-label="Due" value={task.date} onChange={(e) => setTask({ ...task, date: e.target.value })} className={field} />
          <select aria-label="For" value={task.assignee} onChange={(e) => setTask({ ...task, assignee: e.target.value })} className={field}>
            <option value="">Anyone</option>
            {v.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" className={primaryBtn}>
            Add task
          </button>
        </form>
      )}
      {r.tasks.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {r.tasks.map((x) => (
            <li key={x.id} className={x.done ? "text-muted line-through" : ""}>
              {x.title.replace(`${r.code} · `, "")}
              {x.date ? ` · due ${x.date}` : ""}
              {x.assignee ? ` · ${x.assignee}` : ""}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ActivitiesPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const [v, setV] = useState<ActivitiesView | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const url = `/api/projects/${project.id}/activities`;
  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call(url, user.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, url]);
  useEffect(() => {
    if (ready && user && project.saved) void load();
  }, [ready, user, project.saved, load]);
  const groups = useMemo(() => {
    if (!v) return [];
    const keep = v.rows.filter((r) => (filter === "all" ? true : filter === "mine" ? r.mine : filter === "unowned" ? !r.owner && r.timing !== "done" && r.timing !== "cancelled" : r.timing === filter));
    const by = new Map<string, Row[]>();
    for (const r of keep) {
      const k = r.activityCode ? `${r.activityCode} ${r.activity ?? ""}`.trim() : "Other";
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    return [...by.entries()];
  }, [v, filter]);
  if (!user) return null;
  const act = async (a: ActivityAction) => {
    setError("");
    try {
      setV(await call(url, user.id, { method: "POST", body: JSON.stringify(a) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  const chips: [Filter, string, number | undefined][] = v
    ? [
        ["all", "All", v.summary.total],
        ["mine", "Mine", v.rows.filter((r) => r.mine).length],
        ["late", "Late", v.summary.late],
        ["due_now", "Due this quarter", v.summary.dueNow],
        ["unowned", "No owner", v.summary.unowned],
      ]
    : [];

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <Link href="/work" className="text-sm text-muted hover:text-ink">
          ← Work
        </Link>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Activities</h1>
        <p className="mt-1 text-sm text-muted">ROP&rsquo;s workplan for {project.name}, as it is carried out: who owns each activity, where it stands, and the tasks for it.</p>
        {!project.saved && <p className="mt-6 text-sm text-muted">This project has no saved workplan.</p>}
        {v && (
          <p className="mt-4 text-lg">
            {v.summary.done} of {v.summary.total} done · {v.summary.late} late · {v.summary.dueNow} due this quarter{v.summary.unowned ? ` · ${v.summary.unowned} without an owner` : ""}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {v && (
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Show">
            {chips.map(([k, label, n]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${filter === k ? "bg-forest text-paper" : "bg-mist text-forest hover:bg-sunken"}`}>
                {label} {n !== undefined && <span className="tabular-nums opacity-80">{n}</span>}
              </button>
            ))}
          </div>
        )}
        {!v && project.saved && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {v && groups.length === 0 && <p className="mt-6 text-sm text-muted">Nothing here.</p>}
        {groups.map(([g, rows]) => (
          <section key={g} className="mt-6 rounded-2xl border border-line bg-surface px-4">
            <h2 className="border-b border-line py-3 text-sm font-semibold">{g}</h2>
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <ActivityRow key={r.code} r={r} v={v!} act={act} />
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
