"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CurrencyToggle, Initials, useSession } from "@/components/app/session";
import { LogoMark } from "@/components/logo";
import { langLabel } from "@/lib/demo";
import { Tagged } from "@/components/status-tag";

/** Shared building blocks for the Field activities and Procurement workspaces. */

export const TODAY = "2027-03-04";

/* ---------- state ---------- */

/** State kept in this browser's localStorage; falls back to `initial` when storage is unavailable. */
export function usePersistentState<T>(key: string, initial: () => T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) setValue(JSON.parse(saved));
    } catch {}
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value, loaded]);
  return [value, setValue] as const;
}

/* ---------- small pieces ---------- */

export type Tone = "forest" | "ochre" | "clay" | "muted" | "sky" | "plum";

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const t = {
    forest: "bg-mist text-leaf",
    ochre: "bg-ochre-soft text-ochre",
    clay: "bg-clay-soft text-clay",
    muted: "bg-sunken text-muted",
    sky: "bg-sky-soft text-sky",
    plum: "bg-plum-soft text-plum",
  }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${t}`}>{children}</span>;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{children}</h4>;
}

/** Horizontal progress: done, current, upcoming. `marks` labels a stage (e.g. a gate). */
export function Tracker({ labels, current, marks = {}, warn = false }: { labels: string[]; current: number; marks?: Record<number, string>; warn?: boolean }) {
  return (
    <ol className="flex items-start" aria-label="Progress">
      {labels.map((label, i) => {
        const done = i < current;
        const now = i === current;
        const nowTone = warn ? "border-clay text-clay ring-clay/15" : "border-forest text-forest ring-forest/15";
        return (
          <li key={label} className="relative flex flex-1 flex-col items-center text-center">
            {i > 0 && <span aria-hidden className={`absolute right-1/2 top-[11px] h-0.5 w-full ${i <= current ? "bg-forest" : "bg-line"}`} />}
            <span
              className={`relative z-10 grid h-6 w-6 place-items-center rounded-full border-2 text-[10px] font-bold ${
                done ? "border-forest bg-forest text-forest-ink" : now ? `bg-surface ring-4 ${nowTone}` : "border-line bg-surface text-muted"
              }`}
            >
              {done ? "✓" : now && warn ? "!" : i + 1}
            </span>
            <span className={`mt-1.5 hidden text-[11px] leading-tight sm:block ${now ? "font-semibold text-ink" : "text-muted"}`}>{label}</span>
            {marks[i] && <span className={`mt-0.5 hidden font-mono text-[9px] sm:block ${done ? "text-forest" : "text-ochre"}`}>{marks[i]}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- checklist ---------- */

export type CheckView = {
  key: string;
  label: string;
  why: string;
  tag?: string;
  ok: boolean;
  auto: boolean;
  detail?: string;
  findings?: string[];
  fix?: string;
  resolve?: string;
};

export function CheckRow({
  c,
  canEdit,
  onToggle,
  onRaise,
  onResolve,
}: {
  c: CheckView;
  canEdit: boolean;
  onToggle: () => void;
  onRaise: (note: string) => void;
  onResolve: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        {c.auto ? (
          <span
            title="Checked by the system"
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ${c.ok ? "bg-leaf" : "bg-clay"}`}
          >
            {c.ok ? "✓" : "!"}
          </span>
        ) : (
          <input
            id={c.key}
            type="checkbox"
            checked={c.ok}
            disabled={!canEdit}
            onChange={onToggle}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[var(--forest)] disabled:cursor-not-allowed"
          />
        )}
        <div className="min-w-0 flex-1">
          <label htmlFor={c.key} className={`block leading-snug ${!c.auto && canEdit ? "cursor-pointer" : ""}`}>
            {c.label}
            {c.auto && <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-muted">auto</span>}
            {c.findings && <span className="ml-2 rounded bg-plum-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-plum">AI pre-check</span>}
          </label>
          {c.detail && <p className={`mt-0.5 text-sm ${c.ok ? "text-muted" : "font-medium text-clay"}`}>{c.detail}</p>}
          {c.findings && (
            <ul className="mt-2 space-y-1.5 rounded-lg border border-plum/25 bg-plum-soft/50 p-3 text-sm">
              {c.findings.map((f) => (
                <li key={f} className="flex gap-2">
                  <span aria-hidden className="text-plum">◆</span>
                  <span className="min-w-0 flex-1">{f}</span>
                  {canEdit && (
                    <button type="button" onClick={() => onRaise(f)} className="shrink-0 text-xs font-semibold text-plum underline-offset-2 hover:underline">
                      Raise issue
                    </button>
                  )}
                </li>
              ))}
              <li className="pt-1 text-xs text-muted">Suggested by AI. Check each against the source, raise what needs fixing, then tick the box.</li>
            </ul>
          )}
          {!c.ok && c.auto && canEdit && (c.resolve || c.fix) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {c.resolve && (
                <button type="button" onClick={onResolve} className="rounded-full bg-clay px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90">
                  {c.resolve}
                </button>
              )}
              {c.fix && (
                <button type="button" onClick={() => onRaise(c.fix!)} className="rounded-full border border-clay/40 px-3 py-1 text-xs font-semibold text-clay hover:border-clay">
                  Raise as an issue
                </button>
              )}
            </div>
          )}
          {open && (
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              {c.why} {c.tag && <Tagged text={`[${c.tag}]`} />}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="Why is this required?"
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-semibold transition ${
            open ? "border-forest bg-forest text-forest-ink" : "border-line text-muted hover:border-forest/50 hover:text-forest"
          }`}
        >
          ?
        </button>
      </div>
    </li>
  );
}

/* ---------- issues ---------- */

export type Issue = {
  id: string;
  type: string;
  note: string;
  by: string;
  blocking: boolean;
  status: "open" | "resolved";
  resolution?: string;
};

export function IssueForm({
  types,
  help,
  footnote,
  initial,
  onCancel,
  onSave,
}: {
  types: string[];
  help: Record<string, string>;
  footnote: string;
  initial: string;
  onCancel: () => void;
  onSave: (i: { type: string; note: string; blocking: boolean }) => void;
}) {
  const [type, setType] = useState(types[0]);
  const [note, setNote] = useState(initial);
  const [blocking, setBlocking] = useState(true);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (note.trim()) onSave({ type, note: note.trim(), blocking });
      }}
      className="space-y-3 rounded-xl border border-line bg-paper p-4"
    >
      <div className="flex flex-wrap gap-1.5">
        {types.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            aria-pressed={type === t}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${type === t ? "border-forest bg-forest text-forest-ink" : "border-line bg-surface hover:border-forest/40"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{help[type]}</p>
      <textarea
        id="issue-note"
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="What happened, and what is needed?"
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input id="issue-blocking" type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} className="h-4 w-4 accent-[var(--forest)]" />
          Hold this step until resolved
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-ink">
            Cancel
          </button>
          <button type="submit" className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-paper">
            Add issue
          </button>
        </div>
      </div>
      <p className="border-t border-line pt-3 text-xs leading-relaxed text-muted">{footnote}</p>
    </form>
  );
}

export function IssueList({
  issues,
  roleLabel,
  canResolve,
  onResolve,
}: {
  issues: Issue[];
  roleLabel: (r: string) => string;
  canResolve: (i: Issue) => boolean;
  onResolve: (id: string, note: string) => void;
}) {
  if (issues.length === 0) return null;
  return (
    <section>
      <SectionLabel>Issues</SectionLabel>
      <ul className="mt-1 divide-y divide-line">
        {issues.map((i) => (
          <IssueRow key={i.id} issue={i} roleLabel={roleLabel} canResolve={canResolve(i)} onResolve={(n) => onResolve(i.id, n)} />
        ))}
      </ul>
    </section>
  );
}

function IssueRow({ issue, roleLabel, canResolve, onResolve }: { issue: Issue; roleLabel: (r: string) => string; canResolve: boolean; onResolve: (note: string) => void }) {
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");
  const open = issue.status === "open";
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={open ? (issue.blocking ? "clay" : "ochre") : "forest"}>{open ? (issue.blocking ? "Holding step" : "Open") : "Resolved"}</Pill>
        <span className="text-xs font-semibold text-muted">{issue.type}</span>
        <span className="text-xs text-muted">· raised by {roleLabel(issue.by)}</span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed">{issue.note}</p>
      {issue.resolution && <p className="mt-1 text-sm text-muted">Resolution: {issue.resolution}</p>}
      {open && canResolve && !resolving && (
        <button type="button" onClick={() => setResolving(true)} className="mt-2 text-sm font-semibold text-forest hover:underline">
          Resolve
        </button>
      )}
      {resolving && open && (
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) onResolve(note.trim());
          }}
        >
          <input
            id={`resolve-${issue.id}`}
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="How was it resolved?"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm focus:border-forest focus:outline-none"
          />
          <button type="submit" className="rounded-full bg-forest px-4 py-1.5 text-sm font-medium text-forest-ink">
            Save
          </button>
        </form>
      )}
    </li>
  );
}

/* ---------- history ---------- */

export type TimelineEvent = { date: string; who: string; what: string };

export function History({ events, roleLabel }: { events: TimelineEvent[]; roleLabel: (r: string) => string }) {
  return (
    <section>
      <SectionLabel>History</SectionLabel>
      {events.length === 0 && <p className="mt-2 text-sm text-muted">Nothing recorded yet.</p>}
      <ol className="mt-2 space-y-2 border-l border-line pl-4">
        {[...events].reverse().map((e, k) => (
          <li key={k} className="relative text-sm">
            <span aria-hidden className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-forest" />
            <p className="leading-snug">{e.what}</p>
            <p className="text-xs text-muted">
              {e.date} · {roleLabel(e.who)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- step card ---------- */

/** The one card that says whose turn it is and what the step needs. */
export function StepCard({
  mine,
  ownerLabel,
  eyebrow,
  title,
  note,
  onViewAs,
  switchLabel,
  children,
  footer,
}: {
  mine: boolean;
  ownerLabel: string;
  eyebrow?: string;
  title: string;
  note?: string;
  /** Demo shortcut: sign in as the person whose turn it is. */
  onViewAs?: () => void;
  switchLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className={`rounded-2xl border-2 bg-surface ${mine ? "border-forest" : "border-line"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${mine ? "text-forest" : "text-muted"}`}>
            {mine ? "Your turn" : `Waiting on ${ownerLabel}`}
            {eyebrow && <span className="ml-2 text-ochre">· {eyebrow}</span>}
          </p>
          <h3 className="mt-1 font-display text-2xl tracking-tight">{title}</h3>
          {note && <p className="mt-1 text-sm text-muted">{note}</p>}
        </div>
        {!mine && onViewAs && (
          <button
            type="button"
            onClick={onViewAs}
            title="Demo only: sign in as this person to try their step"
            className="rounded-full border border-dashed border-line px-3 py-1.5 text-sm text-muted transition hover:border-forest hover:text-forest"
          >
            {switchLabel ?? "Switch person"}
          </button>
        )}
      </div>
      {children}
      {footer}
    </section>
  );
}

export const primaryBtn =
  "rounded-full bg-forest px-6 py-3 text-sm font-semibold text-forest-ink shadow-[0_12px_24px_-14px_rgb(31_77_54/0.8)] transition enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none";
export const dangerBtn =
  "rounded-full bg-clay px-6 py-3 text-sm font-semibold text-white transition enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-35";
export const quietBtn =
  "rounded-full border border-line px-4 py-3 text-sm font-medium transition enabled:hover:border-forest enabled:hover:text-forest disabled:cursor-not-allowed disabled:opacity-35";

/* ---------- shell ---------- */

export type RoleTab = { id: string; short: string };

/** Top bar used on every signed-in page: home, workflows you can open, currency, and who you are. */
export function TopBar({ active, children }: { active?: "design" | "project" | "field" | "procurement"; children?: React.ReactNode }) {
  const { user, signOut } = useSession();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const spaces = [
    { id: "design", label: "Project design", href: "/design", access: user?.kind === "employee" ? "view" : "none" },
    { id: "project", label: "Project", href: "/projects/A-2027", access: user ? "view" : "none" },
    { id: "field", label: "Field activities", href: "/field", access: user?.fieldAccess },
    { id: "procurement", label: "Procurement", href: "/procurement", access: user?.procurementAccess },
  ].filter((w) => w.access && w.access !== "none");
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/home" aria-label="Your dashboard" className="flex items-center gap-2">
            <LogoMark className="h-7 w-7" />
            <span className={`font-display text-sm ${active ? "hidden xl:inline" : ""}`}>Home</span>
          </Link>
          {spaces.length > 0 && (
            <nav aria-label="Workflows" className="flex rounded-full bg-sunken p-0.5 text-sm">
              {spaces.map((w) => (
                <Link
                  key={w.id}
                  href={w.href}
                  aria-current={active === w.id ? "page" : undefined}
                  className={`whitespace-nowrap rounded-full px-3 py-1 font-display transition ${active === w.id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                >
                  {w.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
        {children}
        <div className="ml-auto flex items-center gap-3">
          <CurrencyToggle />
          {user && (
            <div className="relative">
              <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3 text-sm">
                <Initials name={user.name} className="h-7 w-7 text-xs" />
                <span className="hidden sm:inline">{user.name.split(" ")[0]}</span>
              </button>
              {menu && (
                <div className="absolute right-0 top-11 z-50 w-60 rounded-xl border border-line bg-surface p-2 shadow-[0_20px_40px_-20px_rgb(19_32_26/0.5)]">
                  <p className="px-2 pt-1 text-sm font-semibold">{user.name}</p>
                  <p className="px-2 text-xs text-muted">
                    {user.title} · {user.org}
                  </p>
                  <p className="px-2 pt-1 text-xs text-muted">
                    Language: {langLabel[user.lang]}
                    {user.lang !== "en" && " · pilot screens are in English"}
                  </p>
                  <div className="mt-2 border-t border-line pt-2">
                    <Link href="/home" className="block rounded-lg px-2 py-1.5 text-sm hover:bg-sunken">
                      Your dashboard
                    </Link>
                    <Link href="/about" className="block rounded-lg px-2 py-1.5 text-sm hover:bg-sunken">
                      About this prototype
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        signOut();
                        router.push("/");
                      }}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-sunken"
                    >
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * App frame shared by both workspaces: your roles in this workflow, then the queue on the
 * left and one item on the right. People without a role here see everything, read-only.
 */
export function AppShell({
  active,
  roles,
  role,
  counts,
  onRole,
  primary,
  queue,
  detail,
  mobileDetail,
}: {
  active: "field" | "procurement";
  roles: RoleTab[];
  role: string | null;
  counts: Record<string, number>;
  onRole: (r: string) => void;
  primary?: { label: string; onClick: () => void };
  queue: React.ReactNode;
  detail: React.ReactNode;
  mobileDetail: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar active={active}>
        <div className="order-last -mx-4 flex w-[calc(100%+2rem)] items-center gap-3 overflow-x-auto px-4 sm:mx-0 sm:w-auto sm:px-0 lg:order-none">
          {roles.length === 0 ? (
            <span className="whitespace-nowrap rounded-full border border-line px-3 py-1.5 text-sm text-muted">View only</span>
          ) : (
            <div role="tablist" aria-label="Your role" className="flex w-max gap-1 rounded-full border border-line bg-surface p-1">
              {roles.map((r) => (
                <button
                  key={r.id}
                  role="tab"
                  type="button"
                  aria-selected={role === r.id}
                  onClick={() => onRole(r.id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition ${role === r.id ? "bg-forest text-forest-ink" : "text-muted hover:text-ink"}`}
                >
                  {r.short}
                  {counts[r.id] > 0 && (
                    <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold tabular-nums ${role === r.id ? "bg-forest-ink/20" : "bg-ochre-soft text-ochre"}`}>
                      {counts[r.id]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {primary && (
            <button type="button" onClick={primary.onClick} className="whitespace-nowrap rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:opacity-85">
              {primary.label}
            </button>
          )}
        </div>
      </TopBar>
      <div className="mx-auto grid w-full max-w-[1400px] flex-1 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className={`border-line lg:border-r ${mobileDetail ? "hidden lg:block" : ""}`}>{queue}</aside>
        <main className={`min-w-0 px-4 py-6 sm:px-8 lg:py-8 ${mobileDetail ? "" : "hidden lg:block"}`}>{detail}</main>
      </div>
    </div>
  );
}

/** Upcoming work projected from past step times. */
export function ComingUp({
  items,
  onOpen,
}: {
  items: { id: string; title: string; step: string; eta: string; via: string; basis: string }[];
  onOpen?: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="border-t border-line px-4 py-4 sm:px-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Coming to you · projected</p>
      <ul className="mt-2 space-y-2">
        {items.map((c) => (
          <li key={c.id + c.step}>
            <button type="button" onClick={() => onOpen?.(c.id)} className="w-full text-left text-sm hover:text-forest" title={c.basis}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{c.title}</span>
                <span className="shrink-0 font-mono text-[11px] text-ochre">~{c.eta.slice(5)}</span>
              </span>
              <span className="block truncate text-xs text-muted">
                {c.step} · now {c.via}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted">Estimated from how long each step took in past cases.</p>
    </div>
  );
}

export function NoAccess({ what }: { what: string }) {
  return (
    <div className="min-h-screen">
      <TopBar />
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <p className="font-display text-3xl">{what} is not available to you</p>
        <p className="mt-2 text-sm text-muted">Your role does not include this workflow. Ask your manager if you need access.</p>
        <Link href="/home" className="mt-6 inline-block rounded-full bg-forest px-5 py-2.5 text-sm font-medium text-forest-ink">
          Back to your dashboard
        </Link>
      </div>
    </div>
  );
}

export function QueueHeader({ title, toggleLabel, onToggle }: { title: string; toggleLabel: string; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 pb-2 pt-5 sm:px-6">
      <h1 className="font-display text-xl tracking-tight">{title}</h1>
      {toggleLabel && (
        <button type="button" onClick={onToggle} className="text-sm text-muted hover:text-ink">
          {toggleLabel}
        </button>
      )}
    </div>
  );
}

export function QueueItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full rounded-xl border px-3 py-3 text-left transition ${
          active ? "border-forest bg-surface shadow-[0_10px_24px_-18px_rgb(19_32_26/0.6)]" : "border-transparent hover:border-line hover:bg-surface"
        }`}
      >
        {children}
      </button>
    </li>
  );
}

export function QueueFooter({ onReset }: { onReset: () => void }) {
  return (
    <div className="border-t border-line px-4 py-4 text-xs text-muted sm:px-6">
      Fictional records, saved in this browser only.{" "}
      <button type="button" onClick={onReset} className="font-semibold underline-offset-2 hover:underline">
        Reset sample data
      </button>
    </div>
  );
}

export function EmptyQueue({ onShowAll }: { onShowAll: () => void }) {
  return (
    <div className="px-4 py-10 text-center sm:px-6">
      <p className="text-sm text-muted">You are all caught up.</p>
      <button type="button" onClick={onShowAll} className="mt-2 text-sm font-semibold text-forest hover:underline">
        See everything in progress
      </button>
    </div>
  );
}

export function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-sm text-muted hover:text-ink lg:hidden">
      ← Back to queue
    </button>
  );
}
