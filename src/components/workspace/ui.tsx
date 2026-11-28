"use client";

import { NewMenu } from "@/components/app/new-menu";
import { OPEN_ASSISTANT, Sparkle } from "@/components/app/assistant-button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { Arrow } from "@/components/app/arrow";
import { msg } from "@/lib/i18n/text";
import { timeOf } from "@/lib/history";
import type { MessageKey } from "@/lib/i18n";
import { CurrencyToggle, Initials, useSession } from "@/components/app/session";
import { TaskSourceSwitch } from "@/components/tasks/sources";
import { LogoMark } from "@/components/logo";
import { canEditProject, langLabel, users } from "@/lib/demo";
import { LANGS, isLang, localeOf } from "@/lib/i18n";
import { plainSources } from "@/components/status-tag";
import { perUsd } from "@/lib/fx";

/** Shared building blocks for the Field activities and Procurement workspaces. */

export { TODAY } from "@/lib/demo";

/* ---------- state ---------- */

/** State kept in this browser's localStorage; falls back to `initial` when storage is unavailable. */
export function usePersistentState<T>(key: string, initial: () => T) {
  const [value, setValue] = useState<T>(initial);
  // The key whose saved value has been read. Until the current key is read, nothing is written:
  // otherwise a new key (another person signed in on this computer) was given the last one's value.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const first = useRef(initial);
  useEffect(() => {
    let next = first.current();
    try {
      const saved = localStorage.getItem(key);
      if (saved) next = JSON.parse(saved);
    } catch {}
    setValue(next);
    setLoadedKey(key);
  }, [key]);
  useEffect(() => {
    if (loadedKey !== key) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value, loadedKey]);
  return [value, setValue] as const;
}

/* ---------- small pieces ---------- */

export type Tone = "forest" | "ochre" | "clay" | "muted" | "sky" | "plum";

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const t = {
    forest: "bg-mist text-leaf",
    ochre: "bg-ochre-soft text-warn",
    clay: "bg-clay-soft text-clay",
    muted: "bg-sunken text-muted",
    sky: "bg-sky-soft text-sky",
    plum: "bg-plum-soft text-plum",
  }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}

/**
 * One look for a status everywhere in the app, by what it means for the person reading it:
 * amber ◷ waiting for someone, green ✓ done or approved, red ! needs fixing or sent back,
 * blue → moving along, grey – not active. The mark means colour is never the only signal.
 */
const STATUS_MARK: Record<Tone, string> = { ochre: "◷", forest: "✓", clay: "!", sky: "→", muted: "–", plum: "•" };
export function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <Pill tone={tone}>
      <span aria-hidden>{STATUS_MARK[tone]}</span>
      {children}
    </Pill>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  // A section's name with a gold tick: "look here", the same mark as on Home.
  return <h4 className="border-s-[6px] border-ochre ps-2 font-ledger text-lg font-bold leading-tight text-ink">{children}</h4>;
}

/** Horizontal progress: done, current, upcoming. `marks` labels a stage (e.g. a gate). */
export function Tracker({ labels, current, marks = {}, warn = false, skipped = [] }: { labels: string[]; current: number; marks?: Record<number, string>; warn?: boolean; skipped?: number[] }) {
  // On a phone the step names do not fit under the circles: the current one is written out below.
  const at = Math.min(Math.max(current, 0), labels.length - 1);
  const { tx } = useT();
  return (
    <div>
    <ol className="flex items-start" aria-label={tx("Progress")}>
      {labels.map((label, i) => {
        // A stage this record does not go through (a micro purchase has no award or contract): shown as not needed, never as done.
        if (skipped.includes(i))
          return (
            <li key={label} className="relative flex flex-1 flex-col items-center text-center" title={tx("{step}: not needed for this one", { step: tx(label) })}>
              {i > 0 && <span aria-hidden className={`absolute end-1/2 top-[13px] h-0.5 w-full ${i <= current ? "bg-forest" : "bg-line"}`} />}
              <span className="relative z-10 grid h-7 w-7 place-items-center rounded-full border-2 border-dashed border-line bg-surface text-xs text-muted">–</span>
              <span className="mt-1.5 hidden text-xs leading-tight text-muted line-through sm:block">{tx(label)}</span>
              <span className="mt-0.5 hidden text-xs text-muted sm:block">{tx("not needed")}</span>
            </li>
          );
        const done = i < current;
        const now = i === current;
        const nowTone = warn ? "border-clay text-clay ring-clay/15" : "border-forest text-forest ring-forest/15";
        return (
          <li key={label} className="relative flex flex-1 flex-col items-center text-center">
            {i > 0 && <span aria-hidden className={`absolute end-1/2 top-[13px] h-0.5 w-full ${i <= current ? "bg-forest" : "bg-line"}`} />}
            <span
              className={`relative z-10 grid h-7 w-7 place-items-center rounded-full border-2 text-xs font-bold ${
                done ? "border-forest bg-forest text-forest-ink" : now ? `bg-surface ring-4 ${nowTone}` : "border-line bg-surface text-muted"
              }`}
            >
              {done ? "✓" : now && warn ? "!" : i + 1}
            </span>
            <span className={`mt-1.5 hidden text-xs leading-tight sm:block ${now ? "font-semibold text-ink" : "text-muted"}`}>{tx(label)}</span>
            {marks[i] && <span className={`mt-0.5 hidden font-mono text-xs sm:block ${done ? "text-forest" : "text-warn"}`}>{marks[i]}</span>}
          </li>
        );
      })}
    </ol>
    {labels.length > 0 && current >= 0 && current < labels.length && (
      <p className={`mt-3 text-center text-sm sm:hidden ${warn ? "text-clay" : "text-ink"}`}>
        <span className="text-muted">{tx("Step {n} of {total}:", { n: at + 1, total: labels.length })}</span>{" "}
        <span className="font-semibold">{tx(labels[at])}</span>
      </p>
    )}
    {current >= labels.length && <p className="mt-3 text-center text-sm font-semibold text-forest sm:hidden">{tx("All steps done")}</p>}
    </div>
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
  const { tx } = useT();
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        {c.auto ? (
          <span
            title={tx("Checked by the app")}
            // Not done yet is amber (something to do), not the red used for errors and things sent back.
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold ${c.ok ? "bg-leaf text-white" : "bg-ochre text-ink"}`}
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
            {tx(c.label)}
            {c.auto && <span className="ms-2 text-xs text-muted">· {tx("checked by the app")}</span>}
            {c.findings && <span className="ms-2 rounded bg-plum-soft px-1.5 py-0.5 text-xs font-semibold text-plum">{tx("AI suggestions")}</span>}
          </label>
          {c.detail && <p className={`mt-0.5 text-sm ${c.ok ? "text-muted" : "font-medium text-warn"}`}>{tx(c.detail)}</p>}
          {c.findings && (
            <ul className="mt-2 space-y-1.5 rounded-lg border border-plum/25 bg-plum-soft/50 p-3 text-sm">
              {c.findings.map((f) => (
                <li key={f} className="flex gap-2">
                  <span aria-hidden className="text-plum">◆</span>
                  <span className="min-w-0 flex-1">{f}</span>
                  {canEdit && (
                    <button type="button" onClick={() => onRaise(f)} className="shrink-0 text-xs font-semibold text-plum underline-offset-2 hover:underline">
                      {tx("Raise issue")}
                    </button>
                  )}
                </li>
              ))}
              <li className="pt-1 text-xs text-muted">{tx("Suggested by AI. Check each against the source, raise what needs fixing, then tick the box.")}</li>
            </ul>
          )}
          {!c.ok && c.auto && canEdit && (c.resolve || c.fix) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {c.resolve && (
                <button type="button" onClick={onResolve} className="rounded-full bg-forest px-3 py-1.5 text-xs font-semibold text-forest-ink transition hover:bg-forest-hover">
                  {tx(c.resolve)}
                </button>
              )}
              {c.fix && (
                <button type="button" onClick={() => onRaise(c.fix!)} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:border-forest hover:text-forest">
                  {tx("Raise as an issue")}
                </button>
              )}
            </div>
          )}
          {open && (
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              {tx(c.why)}
              {c.tag && <span className="mt-1 block text-xs">{tx("Where this comes from: {source}", { source: plainSources(c.tag) })}</span>}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={tx("Why is this required?")}
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
  const { tx } = useT();
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
            {tx(t)}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{help[type] ? tx(help[type]) : ""}</p>
      <textarea
        id="issue-note"
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={tx("What happened, and what is needed?")}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input id="issue-blocking" type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} className="h-4 w-4 accent-[var(--forest)]" />
          {tx("Hold this step until resolved")}
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-ink">
            {tx("Cancel")}
          </button>
          <button type="submit" className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-paper">
            {tx("Add issue")}
          </button>
        </div>
      </div>
      <p className="border-t border-line pt-3 text-xs leading-relaxed text-muted">{tx(footnote)}</p>
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
  const { tx } = useT();
  if (issues.length === 0) return null;
  return (
    <section>
      <SectionLabel>{tx("Issues")}</SectionLabel>
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
  const { tx } = useT();
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={open ? (issue.blocking ? "clay" : "ochre") : "forest"}>{open ? (issue.blocking ? tx("Holding step") : tx("Open")) : tx("Resolved")}</Pill>
        <span className="text-xs font-semibold text-muted">{tx(issue.type)}</span>
        <span className="text-xs text-muted">· {tx("raised by {who}", { who: roleLabel(issue.by) })}</span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed">{issue.note}</p>
      {issue.resolution && <p className="mt-1 text-sm text-muted">{tx("Resolution: {text}", { text: issue.resolution })}</p>}
      {open && canResolve && !resolving && (
        <button type="button" onClick={() => setResolving(true)} className="mt-2 text-sm font-semibold text-forest hover:underline">
          {tx("Resolve")}
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
            placeholder={tx("How was it resolved?")}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm focus:border-forest focus:outline-none"
          />
          <button type="submit" className="rounded-full bg-forest px-4 py-1.5 text-sm font-medium text-forest-ink">
            {tx("Save")}
          </button>
        </form>
      )}
    </li>
  );
}

/* ---------- history ---------- */

export type TimelineEvent = { date: string; who: string; what: string; by?: string; at?: string };

export function History({ events, roleLabel }: { events: TimelineEvent[]; roleLabel: (r: string) => string }) {
  const { tx } = useT();
  return (
    <section>
      <SectionLabel>{tx("History")}</SectionLabel>
      {events.length === 0 && <p className="mt-2 text-sm text-muted">{tx("Nothing recorded yet.")}</p>}
      <ol className="mt-2 space-y-2 border-s border-line ps-4">
        {[...events].reverse().map((e, k) => (
          <li key={k} className="relative text-sm">
            <span aria-hidden className="absolute -start-[21px] top-1.5 h-2 w-2 rounded-full bg-forest" />
            <p className="leading-snug">{e.what}</p>
            <p className="text-xs text-muted">
              {/* The person who did it, with their role; older entries name the role's holder. */}
              {/* The time it was saved, where the record has it, so same-day steps show their order. */}
              {e.date}
              {e.at && ` ${timeOf(e.at)}`} · {e.by ? `${e.by}${roleLabel(e.who).match(/ \(.*\)$/)?.[0] ?? ""}` : roleLabel(e.who)}
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
  info,
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
  /** Background for the step (e.g. which policy sign-off point it is), behind a "?" beside the title. */
  info?: string;
  /** Demo shortcut: sign in as the person whose turn it is. */
  onViewAs?: () => void;
  switchLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const { tx } = useT();
  return (
    <section className={`rounded-2xl border-2 bg-surface ${mine ? "border-forest" : "border-line"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${mine ? "text-forest" : "text-muted"}`}>
            {mine ? tx("Your turn") : tx("Waiting on {who}", { who: ownerLabel })}
            {eyebrow && <span className="ms-2 text-warn">· {tx(eyebrow)}</span>}
          </p>
          <h3 className="mt-1 font-display text-2xl tracking-tight">
            {tx(title)}
            {info && (
              <button type="button" onClick={() => setShowInfo(!showInfo)} aria-expanded={showInfo} aria-label={tx("About this step")} className="ms-2 inline-grid h-6 w-6 place-items-center rounded-full border border-line align-middle font-sans text-xs font-semibold text-muted hover:border-forest hover:text-forest">
                ?
              </button>
            )}
          </h3>
          {info && showInfo && <p className="mt-1 text-sm text-muted">{tx(info)}</p>}
          {note && <p className="mt-1 text-sm text-muted">{tx(note)}</p>}
        </div>
        {!mine && onViewAs && (
          <button
            type="button"
            onClick={onViewAs}
            title={tx("Demo only: sign in as this person to try their step")}
            className="rounded-full border border-dashed border-line px-3 py-1.5 text-sm text-muted transition hover:border-forest hover:text-forest"
          >
            {switchLabel ?? tx("Switch person")}
          </button>
        )}
      </div>
      {children}
      {footer}
    </section>
  );
}

/**
 * The step's action buttons: on a phone they stay at the bottom of the screen, above the tab bar,
 * while the step's checks scroll past, so the next action is always in reach. Put it as the step
 * card's own last block (a direct child), after the checks.
 */
export const stickyActions =
  "sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 space-y-1.5 rounded-b-2xl border-t border-line bg-surface/95 px-4 py-2.5 backdrop-blur sm:px-5 lg:static lg:space-y-2 lg:bg-surface lg:py-4 lg:backdrop-blur-none";

// Square, flat buttons: green does the work, a gold wash answers the pointer, red is for removing.
export const primaryBtn =
  "rounded-sm bg-forest px-6 py-3 text-sm font-semibold text-forest-ink transition enabled:hover:bg-forest-hover enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35";
export const dangerBtn =
  "rounded-sm bg-clay px-6 py-3 text-sm font-semibold text-white transition enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35";
export const quietBtn =
  "rounded-sm border border-line-strong px-4 py-3 text-sm font-medium transition enabled:hover:border-forest enabled:hover:bg-ochre-soft disabled:cursor-not-allowed disabled:opacity-35";

/** The small label over each figure when a table row is shown as a stacked block on a phone. */
export const cardLabel = "text-xs uppercase tracking-wide text-muted";

/* ---------- shell ---------- */

export type RoleTab = { id: string; short: string };

const NEW = "__new__";

/** Whether a project's country (a code, or its name in the reader's language) is Afghanistan. */
function inAfghanistan(country: string | undefined, locale: string) {
  const c = (country ?? "").trim().toLowerCase();
  if (c === "af" || c === "afghanistan") return true;
  try {
    return c === (new Intl.DisplayNames([locale], { type: "region" }).of("AF") ?? "").toLowerCase();
  } catch {
    return false;
  }
}

/**
 * The USD/Afs switch is for Afghanistan projects only. Elsewhere it is not shown and amounts are in
 * USD, so nobody sees afghanis on a project in another country.
 */
function ProjectCurrency() {
  const { project } = useCurrentProject();
  const { currency, setCurrency } = useSession();
  const { lang } = useT();
  const afghan = inAfghanistan(project.country, localeOf(lang));
  // MF-11: quetzales on a Guatemala project, once finance has entered a quetzal rate.
  const guatemala = ["gt", "guatemala"].includes((project.country ?? "").trim().toLowerCase()) && !!perUsd("GTQ");
  const local = afghan ? "AFN" : guatemala ? "GTQ" : null;
  useEffect(() => {
    if (currency !== "USD" && currency !== local) setCurrency("USD");
  }, [local, currency, setCurrency]);
  return local ? <CurrencyToggle local={local} /> : null;
}

/** Which project Home, Tasks and Progress show; managers can also start a new one. */
function ProjectSwitcher() {
  const { project, setProject, projects } = useCurrentProject();
  const { user } = useSession();
  const { t } = useT();
  const router = useRouter();
  return (
    <label className="flex min-w-0 items-center gap-2">
      {/* Named on a wide screen, so a new person knows what the picker changes; a phone keeps the room. */}
      <span className="sr-only text-sm font-semibold text-muted lg:not-sr-only">{t("project.label")}</span>
      <select
        value={project.id}
        onChange={(e) => (e.target.value === NEW ? router.push("/setup?new=1") : setProject(e.target.value))}
        className="max-w-[11rem] truncate rounded-full sm:max-w-[14rem] border border-line bg-surface py-1.5 ps-3 pe-8 text-sm font-semibold"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        {canEditProject(user) && <option value={NEW}>+ {t("setup.newProject")}</option>}
      </select>
    </label>
  );
}

function LanguagePicker() {
  const { lang, setLang, t } = useT();
  return (
    <label className="block px-2 py-1.5 text-sm">
      <span className="text-xs text-muted">{t("menu.language")}</span>
      <select value={lang} onChange={(e) => isLang(e.target.value) && setLang(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm">
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {langLabel[l]}
          </option>
        ))}
      </select>
      {lang !== "en" && <span className="mt-1 block text-xs text-muted">{t("menu.untranslated")}</span>}
    </label>
  );
}

/** Top bar used on every signed-in page: current project, the page's own controls, currency, and who you are. */
/** A person's own pages, from the person menu: not hidden behind Home cards. */
export const MY_WORK: { href: string; label: MessageKey }[] = [
  { href: "/people/me", label: "home.myDetails" },
  { href: "/timesheets", label: "ts.title" },
  { href: "/leave", label: "lv.title" },
  { href: "/expenses", label: "exp.title" },
  { href: "/settings#you", label: "menu.settings" },
];

export function TopBar({ active, children }: { active?: "design" | "project" | "tasks" | "field" | "procurement"; children?: React.ReactNode }) {
  const { user, actor, viewingAs, viewAs, mode, signOut, trialEndsAt } = useSession();
  const { t, tx, date } = useT();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [switchError, setSwitchError] = useState("");
  // On a phone the header slides away while scrolling down and comes back on any scroll up, so
  // the work has the screen. On a wide screen it always stays.
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 8) return;
      setTucked(y > last && y > 120);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const switchTo = (id: string | null) => {
    setSwitchError("");
    viewAs(id)
      .then(() => {
        setMenu(false);
        router.push("/home");
      })
      .catch((e: Error) => setSwitchError(e.message));
  };
  return (
    <header className={`sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur-xl transition-transform duration-200 lg:translate-y-0 ${tucked && !menu ? "-translate-y-full" : ""}`}>
      {viewingAs && user && actor && (
        <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-ochre-soft px-4 py-2 text-center text-sm">
          <span>{t("banner.viewingAs", { name: user.name, actor: actor.name.split(" ")[0] })}</span>
          <button type="button" onClick={() => switchTo(null)} className="font-semibold underline underline-offset-2">
            {t("banner.back")}
          </button>
        </div>
      )}
      <SampleBanner />
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <Link href="/home" aria-label={t("nav.home")} className="lg:hidden">
            <LogoMark className="h-7 w-7" />
          </Link>
          {active !== "design" && <ProjectSwitcher />}
          {(active === "tasks" || active === "field" || active === "procurement") && <TaskSourceSwitch active={active === "tasks" ? "all" : active} />}
        </div>
        {children}
        <div className="ms-auto flex items-center gap-3">
          {/* On a phone "+" is in the tab bar, under the thumb, and the assistant takes its place here. */}
          {user?.kind === "employee" && (
            <div className="hidden lg:block">
              <NewMenu />
            </div>
          )}
          {user?.kind === "employee" && (
            <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_ASSISTANT))} aria-label={t("assistant.open")} title={t("assistant.name")} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-forest text-forest-ink lg:hidden">
              <Sparkle className="h-5 w-5" />
            </button>
          )}
          <ProjectCurrency />
          {user && (
            <div className="relative">
              <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 ps-1 pe-3 text-sm">
                <Initials name={user.name} className="h-7 w-7 text-xs" />
                <span className="hidden sm:inline">{user.name.split(" ")[0]}</span>
              </button>
              {menu && (
                <div className="absolute end-0 top-11 z-50 w-60 rounded-xl border border-line bg-surface p-2 shadow-[0_20px_40px_-20px_rgb(19_32_26/0.5)]">
                  <p className="px-2 pt-1 text-sm font-semibold">{user.name}</p>
                  <p className="px-2 text-xs text-muted">
                    {user.title} · {user.org}
                  </p>
                  {trialEndsAt && user.kind === "employee" && (
                    <p className="mx-2 mt-2 rounded-lg bg-mist px-2 py-1.5 text-xs text-forest">{tx("Premium free trial until {date}", { date: date(trialEndsAt, { day: "numeric", month: "long", year: "numeric" }) })}</p>
                  )}
                  {user.kind === "employee" && (
                    <nav aria-label={t("menu.myWork")} className="mt-2 border-t border-line pt-2">
                      <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t("menu.myWork")}</p>
                      {MY_WORK.map((l) => (
                        <Link key={l.href} href={l.href} onClick={() => setMenu(false)} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-sunken">
                          {t(l.label)}
                        </Link>
                      ))}
                    </nav>
                  )}
                  {/* An administrator's settings are where people look for them: under their own name, on every screen. */}
                  {user.kind === "employee" && user.admin && (
                    <div className="mt-2 border-t border-line pt-2">
                      <Link href="/settings/organization" onClick={() => setMenu(false)} className="block rounded-lg px-2 py-1.5 text-sm font-semibold text-forest hover:bg-sunken">
                        {tx("Organization settings")}
                      </Link>
                    </div>
                  )}
                  <div className="mt-2 border-t border-line pt-2">
                    <LanguagePicker />
                    <Link href="/about" className="block rounded-lg px-2 py-1.5 text-sm hover:bg-sunken">
                      {t("menu.about")}
                    </Link>
                    {mode === "live" && actor?.admin && (
                      <label className="block px-2 py-1.5 text-sm">
                        <span className="text-xs text-muted">{t("menu.viewAs")}</span>
                        <select
                          value={viewingAs ? user.id : ""}
                          onChange={(e) => switchTo(e.target.value || null)}
                          className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                        >
                          <option value="">{t("menu.myself", { name: actor.name })}</option>
                          {users
                            .filter((p) => p.id !== actor.id)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} · {p.title}
                              </option>
                            ))}
                        </select>
                        {switchError && <span className="mt-1 block text-xs text-clay">{switchError}</span>}
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        void signOut().then(() => router.push("/"));
                      }}
                      className="block w-full rounded-lg px-2 py-1.5 text-start text-sm hover:bg-sunken"
                    >
                      {t("menu.signOut")}
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
  const { tx } = useT();
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar active={active}>
        <div className="order-last -mx-4 flex w-[calc(100%+2rem)] items-center gap-3 overflow-x-auto px-4 sm:mx-0 sm:w-auto sm:px-0 lg:order-none">
          {roles.length === 0 ? (
            <span title={tx("You can read everything here; your role signs nothing in this workflow.")} className="whitespace-nowrap rounded-full border border-line px-3 py-1.5 text-sm text-muted">
              {tx("View only")}
              <span className="ms-1.5 hidden text-xs sm:inline">· {tx("you can read everything here; your role signs nothing in this workflow")}</span>
            </span>
          ) : (
            <div role="tablist" aria-label={tx("Your role")} className="flex w-max gap-1 rounded-full border border-line bg-surface p-1">
              {roles.map((r) => (
                <button
                  key={r.id}
                  role="tab"
                  type="button"
                  aria-selected={role === r.id}
                  onClick={() => onRole(r.id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition ${role === r.id ? "bg-forest text-forest-ink" : "text-muted hover:text-ink"}`}
                >
                  {tx(r.short)}
                  {counts[r.id] > 0 && (
                    <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-xs font-bold tabular-nums ${role === r.id ? "bg-forest-ink/20" : "bg-ochre-soft text-warn"}`}>
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
      <div className="mx-auto grid w-full max-w-[1400px] flex-1 grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className={`border-line lg:border-e ${mobileDetail ? "hidden lg:block" : ""}`}>{queue}</aside>
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
  const { tx } = useT();
  if (items.length === 0) return null;
  return (
    <div className="border-t border-line px-4 py-4 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{tx("Coming to you · projected")}</p>
      <ul className="mt-2 space-y-2">
        {items.map((c) => (
          <li key={c.id + c.step}>
            <button type="button" onClick={() => onOpen?.(c.id)} className="w-full text-start text-sm hover:text-forest" title={c.basis}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{c.title}</span>
                <span className="shrink-0 font-mono text-xs text-warn">~{c.eta.slice(5)}</span>
              </span>
              <span className="block truncate text-xs text-muted">
                {c.step} · now {c.via}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">{tx("Estimated from how long each step took in past cases.")}</p>
    </div>
  );
}

export function NoAccess({ what }: { what: string }) {
  const { tx } = useT();
  return (
    <div className="min-h-screen">
      <TopBar />
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <p className="font-display text-3xl">{what} is not available to you</p>
        <p className="mt-2 text-sm text-muted">{tx("Your role does not include this workflow. Ask your manager if you need access.")}</p>
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
      <h1 className="text-xl tracking-tight font-semibold">{title}</h1>
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
        className={`w-full rounded-xl border px-3 py-3 text-start transition ${
          active ? "border-forest bg-surface shadow-[0_10px_24px_-18px_rgb(19_32_26/0.6)]" : "border-transparent hover:border-line hover:bg-surface"
        }`}
      >
        {children}
      </button>
    </li>
  );
}

export function QueueFooter({ onReset, note = msg("Fictional records, saved in this browser only.") }: { onReset?: () => void; note?: string }) {
  const { tx } = useT();
  return (
    <div className="border-t border-line px-4 py-4 text-xs text-muted sm:px-6">
      {tx(note)}{" "}
      {onReset && (
        <button type="button" onClick={onReset} className="font-semibold underline-offset-2 hover:underline">
          {tx("Reset sample data")}
        </button>
      )}
    </div>
  );
}

/**
 * What a page shows while its data is on the way: a visible "Loading…", never a blank screen that
 * looks broken on a slow connection.
 */
export function Loading({ what, className = "" }: { what?: string; className?: string }) {
  const { t } = useT();
  return (
    <div role="status" aria-live="polite" className={`flex items-center gap-3 border-y border-line px-3 py-4 text-sm text-muted ${className}`}>
      <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-forest" />
      {what ?? t("load.wait")}
    </div>
  );
}

/** An empty list: "all caught up" only once the list has loaded, never while it is still on its way. */
export function EmptyQueue({ onShowAll, loading = false }: { onShowAll: () => void; loading?: boolean }) {
  const { tx } = useT();
  if (loading)
    return (
      <div className="px-3 py-6 sm:px-4">
        <Loading />
      </div>
    );
  return (
    <div className="px-4 py-10 text-center sm:px-6">
      <p className="text-sm text-muted">{tx("You are all caught up.")}</p>
      <button type="button" onClick={onShowAll} className="mt-2 text-sm font-semibold text-forest hover:underline">
        {tx("See everything in progress")}
      </button>
    </div>
  );
}

export function BackLink({ onClick }: { onClick: () => void }) {
  const { tx } = useT();
  return (
    <button type="button" onClick={onClick} className="text-sm text-muted hover:text-ink lg:hidden">
      <Arrow back /> {tx("Back to queue")}
    </button>
  );
}

/** On every page of the sample project (C5): what it is, and that it cannot be changed. */
function SampleBanner() {
  const { project } = useCurrentProject();
  const { t } = useT();
  if (project.kind !== "sample") return null;
  return (
    <div role="status" className="bg-sky-soft px-4 py-2 text-center text-sm">
      {t("sample.banner")}
    </div>
  );
}
