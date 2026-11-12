"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, TopBar, primaryBtn } from "@/components/workspace/ui";
import { ACTIVITY_STATUSES, type ActivityAction, type ActivityStatus, type Timing } from "@/lib/activities";
import { resultHref } from "@/lib/connections";
import type { MessageKey } from "@/lib/i18n";
import type { ActKey } from "@/lib/i18n/activities";
import type { ActivitiesPageView as ActivitiesView } from "@/app/api/projects/[code]/activities/route";

/**
 * Execute: ROP's workplan activities as they are carried out. Each has an owner, a status with the
 * dates it actually started and finished, what is in the way, and the tasks made for it. Late
 * means its last planned quarter has ended and it is not done.
 */

type Row = ActivitiesView["rows"][number];
type Filter = "all" | "mine" | "late" | "due_now" | "unowned";

const TIMING: Record<Timing, { tone: "clay" | "ochre" | "forest" | "muted" | "sky"; text: ActKey }> = {
  late: { tone: "clay", text: "act.t.late" },
  due_now: { tone: "ochre", text: "act.t.due" },
  upcoming: { tone: "sky", text: "act.t.later" },
  done: { tone: "forest", text: "act.t.done" },
  cancelled: { tone: "muted", text: "act.t.cancelled" },
  unscheduled: { tone: "muted", text: "act.t.unscheduled" },
};
const quarterLabel = (q: string) => `Q${Math.floor((Number(q.slice(5, 7)) - 1) / 3) + 1} ${q.slice(0, 4)}`;
const field = "rounded-lg border border-line bg-surface px-3 py-2 text-sm";

async function call(url: string, user: string, init?: RequestInit): Promise<ActivitiesView> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as ActivitiesView;
}

/** What serves the activity, each linking to its own record: procurements, grants, updates, and what is spent on its budget lines. */
function Linked({ r, v, project }: { r: Row; v: ActivitiesView; project: string }) {
  const { t, date } = useT();
  const l = r.links;
  const p = encodeURIComponent(project);
  const few = <T,>(xs: T[], n = 3) => ({ shown: xs.slice(0, n), more: Math.max(0, xs.length - n) });
  const procs = few(l.procurements.filter((x) => !x.done).concat(l.procurements.filter((x) => x.done)));
  const grants = few(l.grants.filter((g) => g.status === "open" || g.status === "done"));
  const updates = few(l.updates, 2);
  const money = (n: number) => `${Math.round(n).toLocaleString("en-US")} ${v.budgetCurrency}`;
  const row = "flex flex-wrap gap-x-2 gap-y-0.5";
  const head = "font-semibold text-muted";
  return (
    <div className="mt-2 space-y-1 rounded-xl bg-paper px-3 py-2 text-xs">
      {l.budget.lines.length > 0 && <p className="tabular-nums text-muted">{t("cn.act.spent", { spent: money(l.budget.spent), total: money(l.budget.total), n: l.budget.lines.length })}</p>}
      {procs.shown.length > 0 && (
        <p className={row}>
          <span className={head}>{t("cn.act.procurements")}:</span>
          {procs.shown.map((x) => (
            <Link key={x.id} href={`/work?source=procurement&open=${encodeURIComponent(x.id)}&project=${p}`} className="text-forest hover:underline">
              {x.id} {x.title.slice(0, 40)} · {x.stage}
            </Link>
          ))}
          {procs.more > 0 && <span className="text-muted">{t("cn.act.more", { n: procs.more })}</span>}
        </p>
      )}
      {grants.shown.length > 0 && (
        <p className={row}>
          <span className={head}>{t("cn.act.grants")}:</span>
          {grants.shown.map((g) => (
            <Link key={g.id} href={`/work/grants?project=${p}&open=${g.id}`} className="text-forest hover:underline">
              {g.id} {g.business.slice(0, 40)} · {g.status === "done" ? t("gr.doneTag") : t(`gr.step.${g.step}` as MessageKey)}
            </Link>
          ))}
          {grants.more > 0 && <span className="text-muted">{t("cn.act.more", { n: grants.more })}</span>}
        </p>
      )}
      <p className={row}>
        {updates.shown.length > 0 && <span className={head}>{t("cn.act.updates")}:</span>}
        {updates.shown.map((u) => (
          <span key={u.id} className="text-muted">
            {date(u.date)} {u.title.slice(0, 60)}
          </span>
        ))}
        {updates.more > 0 && <span className="text-muted">{t("cn.act.more", { n: updates.more })}</span>}
        <Link href={`/progress/results?project=${p}&update=${encodeURIComponent(r.code)}`} className="font-semibold text-forest hover:underline">
          {t("cn.act.addUpdate")}
        </Link>
        {r.results.length > 0 && (
          <Link href={resultHref(project, { indicator: r.results[0].indicator, from: r.code, note: "" })} className="font-semibold text-forest hover:underline">
            {t("cn.act.record")}
          </Link>
        )}
      </p>
    </div>
  );
}

function ActivityRow({ r, v, act, project, focus }: { r: Row; v: ActivitiesView; act: (a: ActivityAction) => Promise<void>; project: string; focus: boolean }) {
  const { t, date } = useT();
  const [open, setOpen] = useState<"status" | "task" | "owner" | null>(null);
  const [status, setStatus] = useState<ActivityStatus>(r.status === "not_started" ? "in_progress" : r.status);
  const [on, setOn] = useState(v.today);
  const [blocker, setBlocker] = useState(r.blocker);
  const [task, setTask] = useState({ title: "", date: "", assignee: r.owner ?? "" });
  const may = v.can.manage || r.mine;
  const tm = TIMING[r.timing];
  return (
    <li id={`act-${r.code}`} className={`scroll-mt-24 py-3 ${focus ? "-mx-2 rounded-xl px-2 ring-2 ring-forest" : ""}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className="font-mono text-xs text-muted">{r.code}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{r.title}</p>
          <p className="text-xs text-muted">
            {r.active.length ? r.active.map(quarterLabel).join(", ") : t("act.noQuarter")}
            {r.target > 0 && r.unit ? ` · ${t("act.target", { n: r.target.toLocaleString(), unit: r.unit })}` : ""}
            {r.startedOn ? ` · ${t("act.started", { date: date(r.startedOn) })}` : ""}
            {r.doneOn ? ` · ${t("act.doneOn", { date: date(r.doneOn) })}` : ""}
          </p>
          {r.blocker && <p className="mt-0.5 text-xs text-clay">{r.blocker}</p>}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className={r.ownerName ? "text-ink" : "text-clay"}>{r.ownerName ? t("act.owner", { name: r.ownerName }) : t("act.noOwner")}</span>
            {r.results.map((x) => (
              <span key={x.code} className="tabular-nums text-muted" title={x.name}>
                {r.results.length > 1 ? `${x.code}: ` : ""}
                {t("act.result", { achieved: x.achieved.toLocaleString(), target: x.target.toLocaleString(), unit: x.unit })}
              </span>
            ))}
          </p>
          {/* Work recorded as done in results but not here: offer to close it. */}
          {r.allMet && r.status !== "done" && r.status !== "cancelled" && (
            <p className="mt-1 text-xs text-forest">
              {t("act.targetMet")}{" "}
              {may && (
                <button type="button" className="font-semibold underline" onClick={() => void act({ action: "status", code: r.code, status: "done", on: v.today, blocker: "" })}>
                  {t("act.markDone")}
                </button>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {r.status !== "done" && r.status !== "not_started" && <Pill tone="muted">{t(`act.s.${r.status}` as ActKey)}</Pill>}
          <Pill tone={tm.tone}>{t(tm.text)}</Pill>
        </div>
      </div>
      {may && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {v.can.manage && (
            <button type="button" className="font-semibold text-forest hover:underline" onClick={() => setOpen(open === "owner" ? null : "owner")}>
              {r.owner ? t("act.changeOwner") : t("act.assign")}
            </button>
          )}
          <button type="button" className="font-semibold text-forest hover:underline" onClick={() => setOpen(open === "status" ? null : "status")}>
            {t("act.update")}
          </button>
          <button type="button" className="font-semibold text-forest hover:underline" onClick={() => setOpen(open === "task" ? null : "task")}>
            {t("act.addTask")}
          </button>
        </div>
      )}
      {open === "owner" && (
        <select
          autoFocus
          aria-label={t("act.ownerOf", { code: r.code })}
          value={r.owner ?? ""}
          onChange={(e) => void act({ action: "assign", code: r.code, owner: e.target.value || null }).then(() => setOpen(null))}
          className={`${field} mt-2`}
        >
          <option value="">{t("act.noOwnerOption")}</option>
          {v.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {open === "status" && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act({ action: "status", code: r.code, status, on, blocker }).then(() => setOpen(null));
          }}
        >
          <select aria-label={t("act.status")} value={status} onChange={(e) => setStatus(e.target.value as ActivityStatus)} className={field}>
            {ACTIVITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`act.s.${s}` as ActKey)}
              </option>
            ))}
          </select>
          <input type="date" aria-label={t("act.from")} value={on} max={v.today} onChange={(e) => setOn(e.target.value)} className={field} />
          <input placeholder={status === "on_hold" || status === "cancelled" ? t("act.blockerRequired") : t("act.noteOptional")} value={blocker} onChange={(e) => setBlocker(e.target.value)} className={`${field} min-w-0 flex-1`} />
          <button type="submit" className={primaryBtn}>
            {t("act.save")}
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
          <input placeholder={t("act.taskWhat")} value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} className={`${field} min-w-0 flex-1`} />
          <input type="date" aria-label={t("act.due")} value={task.date} onChange={(e) => setTask({ ...task, date: e.target.value })} className={field} />
          <select aria-label={t("act.for")} value={task.assignee} onChange={(e) => setTask({ ...task, assignee: e.target.value })} className={field}>
            <option value="">{t("act.anyone")}</option>
            {v.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" className={primaryBtn}>
            {t("act.addTaskBtn")}
          </button>
        </form>
      )}
      <Linked r={r} v={v} project={project} />
      {r.tasks.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {r.tasks.map((x) => (
            <li key={x.id} className={x.done ? "text-muted line-through" : ""}>
              {x.title.replace(`${r.code} · `, "")}
              {x.date ? ` · ${t("act.taskDue", { date: date(x.date) })}` : ""}
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
  const { t } = useT();
  const [v, setV] = useState<ActivitiesView | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter | null>(null);
  // `?open=1.2.1.3` (from a grant, a procurement or a result): show everything and go to that activity.
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get("open");
    if (open) {
      setFocus(open);
      setFilter("all");
    }
  }, []);
  useEffect(() => {
    if (focus && v) document.getElementById(`act-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus, v]);
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
  // Opens on your own work, else this quarter's, else everything.
  const shown: Filter = filter ?? (v?.rows.some((r) => r.mine && r.timing !== "done") ? "mine" : v?.summary.dueNow ? "due_now" : "all");
  const groups = useMemo(() => {
    if (!v) return [];
    const keep = v.rows.filter((r) => (shown === "all" ? true : shown === "mine" ? r.mine : shown === "unowned" ? !r.owner && r.timing !== "done" && r.timing !== "cancelled" : r.timing === shown));
    const by = new Map<string, Row[]>();
    for (const r of keep) {
      const k = r.activityCode ? `${r.activityCode} ${r.activity ?? ""}`.trim() : t("act.other");
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    return [...by.entries()];
  }, [v, shown, t]);
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
        ["all", t("act.f.all"), v.summary.total],
        ["mine", t("act.f.mine"), v.rows.filter((r) => r.mine).length],
        ["late", t("act.f.late"), v.summary.late],
        ["due_now", t("act.f.due"), v.summary.dueNow],
        ["unowned", t("act.f.unowned"), v.summary.unowned],
      ]
    : [];

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <Link href="/work" className="text-sm text-muted hover:text-ink">
          {t("act.back")}
        </Link>
        <h1 className="mt-2 font-display text-4xl tracking-tight">{t("act.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("act.intro", { project: project.name })}</p>
        {!project.saved && <p className="mt-6 text-sm text-muted">{t("act.noPlan")}</p>}
        {v && (
          <p className="mt-4 text-lg">
            {t("act.summary", { done: v.summary.done, total: v.summary.total, late: v.summary.late, due: v.summary.dueNow })}
            {v.summary.unowned ? t("act.unowned", { n: v.summary.unowned }) : ""}
          </p>
        )}
        {v && (v.unlinked.procurements > 0 || v.unlinked.grants > 0) && (
          <p className="mt-2 text-xs text-muted" title={t("cn.act.unlinkedHelp")}>
            {t("cn.act.unlinked", { p: v.unlinked.procurements, g: v.unlinked.grants })}{" "}
            {v.unlinked.grants > 0 && (
              <Link href="/work/grants" className="text-forest hover:underline">
                {t("gr.title")}
              </Link>
            )}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {v && (
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t("act.show")}>
            {chips.map(([k, label, n]) => (
              <button key={k} type="button" aria-pressed={shown === k} onClick={() => setFilter(k)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${shown === k ? "bg-forest text-paper" : "bg-mist text-forest hover:bg-sunken"}`}>
                {label} {n !== undefined && <span className="tabular-nums opacity-80">{n}</span>}
              </button>
            ))}
          </div>
        )}
        {!v && project.saved && !error && <p className="mt-6 text-sm text-muted">{t("act.loading")}</p>}
        {v && groups.length === 0 && <p className="mt-6 text-sm text-muted">{t("act.nothing")}</p>}
        {groups.map(([g, rows]) => (
          <section key={g} className="mt-6 rounded-2xl border border-line bg-surface px-4">
            <h2 className="border-b border-line py-3 text-sm font-semibold">{g}</h2>
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <ActivityRow key={r.code} r={r} v={v!} act={act} project={project.id} focus={focus === r.code} />
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
