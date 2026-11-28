"use client";

import { APP_FORM_KINDS, APP_FORM_TEXT, mayFillForms, mayOpenForms, mayRegister } from "@/lib/app-forms";

import { Arrow } from "@/components/app/arrow";
import { plainSources } from "@/components/status-tag";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRequireUser, useSession } from "@/components/app/session";
import { useT } from "@/components/app/i18n";
import { msg, translateText } from "@/lib/i18n/text";
import { useFieldData } from "@/components/app/use-project-data";
import { useDefaultRole } from "@/components/app/use-default-role";
import { useCurrentProject } from "@/components/app/current-project";
import { FarmerImport, PackageSetup } from "@/components/field/setup";
import { today } from "@/lib/clock";
import { canEditProject, stepHistory } from "@/lib/demo";
import { packageUsd, qtyItem, type FieldSetup } from "@/lib/package";
import {
  AppShell,
  BackLink,
  CheckRow,
  ComingUp,
  EmptyQueue,
  History,
  IssueForm,
  IssueList,
  Pill,
  QueueFooter,
  QueueItem,
  Tracker,
  primaryBtn,
  StatusPill,
} from "@/components/workspace/ui";
import { holderOf, type AppUser } from "@/lib/demo";
import { NoAccess } from "@/components/workspace/ui";
import { inFieldQueue, noSelectionRule, outcomeLabel, STARTS_WITHOUT_RULE, type Shown } from "@/lib/selection";
import {
  ISSUE_FOOTNOTE,
  addDays,
  allChecksPass,
  farmerStages,
  fieldCheck,
  fieldPerson,
  fieldRoleLabel,
  fieldRoles,
  farmerLabel,
  farmerName,
  fieldSteps,
  findingStages,
  issueHelp,
  issueTypes,
  openBlocking,
  ownerOfItem,
  projectItem,
  type Ctx,
  type Farmer,
  type FieldItem,
  type FieldRole,
  type Finding,
  type Outcome,
  type Stock,
} from "@/lib/field";


/** Shown when Field activities cannot reach the database. */
export function DataBanner({ status, error }: { status: string; error: string }) {
  const { tx } = useT();
  if (status === "loading") return <p className="mx-3 mt-4 bg-sunken px-3 py-2 font-bands text-sm font-bold text-muted sm:mx-4">{tx("Loading field records…")}</p>;
  if (!error) return null;
  return (
    <p role="alert" className="mx-3 mt-4 bg-[#7a5230] px-3 py-3 font-bands text-sm font-bold text-white sm:mx-4">
      {error}
    </p>
  );
}

const ENDS: Record<string, { title: string; body: string; tone: "forest" | "clay" }> = {
  complete: { title: msg("Season record complete"), body: msg("Trained, verified, supplied and planted. Follow-up visits continue through harvest."), tone: "forest" },
  removed: { title: msg("Removed from the project"), body: msg("The decision and its reason are on the record below."), tone: "clay" },
  closed: { title: msg("Closed"), body: msg("The decision and any action feed the next seasonal plan."), tone: "forest" },
};

type Tx = (text: string, vars?: Record<string, string | number>) => string;
/** English with {name} filled in: what comingTo shows when the caller has no tx (outside a component). */
const english: Tx = (text, vars) => translateText("en", text, vars);

/** "Farida Noori (Extension agent)" for a role, in the interface language. */
const personIn = (tx: Tx, r: string) => {
  const u = holderOf("field", r);
  return u ? tx("{name} ({role})", { name: u.name, role: tx(fieldRoleLabel(r)) }) : tx(fieldRoleLabel(r));
};

export const stageOf = (i: FieldItem) =>
  i.step in ENDS ? (i.kind === "farmer" ? (i.step === "removed" ? 2 : farmerStages.length) : findingStages.length) : fieldSteps[i.step].stage;

/** Items that will reach `role` later, with the projected arrival date. Pass `tx` from a component for the interface language. */
export function comingTo(items: FieldItem[], role: string, viewer?: AppUser | null, tx: Tx = english) {
  const basisOf = (step: string) => {
    const h = stepHistory[step];
    return h ? tx("Median {median} days across {n} past cases", { median: h.median, n: h.n }) : "";
  };
  return items
    .filter((i) => ownerOfItem(i) && ownerOfItem(i) !== role)
    .flatMap((i) => {
      const path = projectItem(i);
      const hit = path.find((p, k) => k > 0 && p.owner === role);
      if (!hit) return [];
      return [
        {
          id: i.id,
          title: i.kind === "farmer" ? farmerLabel(i, viewer) : i.title,
          step: tx(fieldSteps[hit.step].title),
          eta: hit.start,
          via: tx("{step} with {person}", { step: tx(fieldSteps[path[0].step].title).toLowerCase(), person: holderOf("field", path[0].owner)?.name ?? tx(fieldRoleLabel(path[0].owner)) }),
          basis: path.slice(0, path.indexOf(hit)).map((p) => tx("{step}: {basis}", { step: tx(fieldSteps[p.step].title), basis: basisOf(p.step) })).join(" · "),
        },
      ];
    })
    .sort((a, b) => a.eta.localeCompare(b.eta));
}

/* ---------- forms ---------- */

function ActionForm({ onSave }: { onSave: (a: { text: string; owner: FieldRole; due: string }) => void }) {
  const [text, setText] = useState("");
  const [owner, setOwner] = useState<FieldRole>("extension");
  const [due, setDue] = useState(addDays(today(), 7));
  const { tx } = useT();
  const field = "rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSave({ text: text.trim(), owner, due });
      }}
      className="space-y-3"
    >
      <p className="text-sm font-medium">{tx("Assign an action")}</p>
      <input id="action-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("What should change?")} className={`w-full ${field}`} />
      <div className="flex flex-wrap gap-2">
        <select id="action-owner" value={owner} onChange={(e) => setOwner(e.target.value as FieldRole)} className={field} aria-label={tx("Owner")}>
          {fieldRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {personIn(tx, r.id)}
            </option>
          ))}
        </select>
        <input id="action-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className={field} aria-label={tx("Due date")} />
        <button type="submit" disabled={!text.trim()} className={primaryBtn}>
          {tx("Assign action")} <Arrow />
        </button>
      </div>
    </form>
  );
}

function NewFinding({ farmers, onCancel, onCreate }: { farmers: Farmer[]; onCancel: () => void; onCreate: (f: Finding) => void }) {
  const { user } = useSession();
  const { tx } = useT();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none";
  const valid = title.trim() && summary.trim();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onCreate({
          kind: "finding",
          id: `MF-${String(Math.floor(Math.random() * 90) + 10)}`,
          title: title.trim(),
          summary: summary.trim(),
          sources,
          step: "validate",
          checks: {},
          issues: [],
          timeline: [{ date: today(), who: "mel", what: "Finding drafted" }],
        });
      }}
      className="mx-auto max-w-2xl space-y-6"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warn">{tx("New finding")}</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight">{tx("What did you see in the field?")}</h2>
      </div>
      <label className="block">
        <span className="text-sm font-medium">{tx("Finding")}</span>
        <input id="nf-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tx("e.g. Late planting on the hillside plots")} className={`mt-1 ${field}`} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">{tx("What the evidence shows")}</span>
        <textarea id="nf-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} className={`mt-1 ${field}`} />
      </label>
      <fieldset>
        <legend className="text-sm font-medium">{tx("Source records")}</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {farmers.map((f) => {
            const on = sources.includes(f.id);
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                onClick={() => setSources(on ? sources.filter((s) => s !== f.id) : [...sources, f.id])}
                className={`rounded-full border px-3 py-1 text-xs transition ${on ? "border-forest bg-forest text-forest-ink" : "border-line bg-surface hover:border-forest/40"}`}
              >
                {farmerLabel(f, user)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex gap-3">
        <button type="submit" disabled={!valid} className={primaryBtn}>
          {tx("Create finding")}
        </button>
        <button type="button" onClick={onCancel} className="rounded-full px-4 py-3 text-sm text-muted hover:text-ink">
          {tx("Cancel")}
        </button>
      </div>
    </form>
  );
}

/* ---------- Bands pieces ---------- */

// Bands (as on Home's Summary): solid square blocks, heavy type, green for the work, gold for
// waiting or fixing, walnut for sent back, pale for information.
const INK = "text-[#1c211b]";
const focusRing = "focus-visible:outline focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-forest";
const onGreenFocus = "focus-visible:outline focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-ochre";
// The step's action bar: on a phone it stays at the bottom of the screen, above the tab bar, while the checks scroll past.
const greenActions = "sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 space-y-2 bg-deep px-4 py-3 text-deep-ink sm:px-5 lg:static lg:py-4";
// The main action inside the green block: white and full width, like Home's Start.
const startBtn = `flex min-h-14 w-full items-center justify-between gap-3 bg-white px-4 text-start text-lg font-extrabold text-[#314d2f] transition enabled:hover:bg-ochre enabled:hover:text-[#1c211b] enabled:active:bg-ochre disabled:cursor-not-allowed disabled:opacity-40 ${onGreenFocus}`;
const onGreenQuiet = `inline-flex min-h-12 items-center border-2 border-white/70 px-4 text-base font-bold text-white transition enabled:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 ${onGreenFocus}`;
const onGreenDanger = `inline-flex min-h-12 items-center bg-[#7a5230] px-4 text-base font-bold text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${onGreenFocus}`;
const bandLink = `inline-flex min-h-12 items-center gap-1.5 font-bold text-forest underline-offset-4 hover:underline ${focusRing}`;

/**
 * The step a record is at, as a band: green when it is your turn, gold while it waits on someone
 * else. The same contents as the shared step card, in the Bands look.
 */
function FieldStep({
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
  onViewAs?: () => void;
  switchLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { tx } = useT();
  return (
    <section className="bg-surface font-bands">
      <div className={`flex flex-wrap items-start justify-between gap-3 px-5 pb-6 pt-5 ${mine ? "bg-deep text-deep-ink" : `bg-ochre ${INK}`}`}>
        <div className="min-w-0">
          <p className="text-lg font-extrabold leading-tight">
            {mine ? tx("Your turn") : tx("Waiting on {who}", { who: ownerLabel })}
            {eyebrow && <span className="ms-2 font-bold opacity-90">· {tx(eyebrow)}</span>}
          </p>
          <h3 className="mt-2 break-words text-4xl font-extrabold leading-[1.05] tracking-tight">{tx(title)}</h3>
          {note && <p className="mt-2 text-base font-medium">{tx(note)}</p>}
        </div>
        {!mine && onViewAs && (
          <button
            type="button"
            onClick={onViewAs}
            title={tx("Demo only: sign in as this person to try their step")}
            className={`inline-flex min-h-12 items-center border-2 border-dashed border-current px-4 text-sm font-bold transition hover:bg-white/30 ${focusRing}`}
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
 * A check KoboCollect fills in: Field activities only shows it, so it is drawn as a state with a
 * mark and words, never as a box to tick.
 */
function KoboCheck({ label, why, tag, ok }: { label: string; why: string; tag?: string; ok: boolean }) {
  const { tx } = useT();
  const [open, setOpen] = useState(false);
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        {ok ? (
          <span aria-hidden className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-deep text-sm font-extrabold text-deep-ink">
            ✓
          </span>
        ) : (
          <span aria-hidden className="mt-0.5 h-7 w-7 shrink-0 rounded-full border-[3px] border-muted" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-bold leading-snug">{tx(label)}</p>
          <p className={`mt-0.5 text-sm font-bold ${ok ? "text-forest" : "text-muted"}`}>{ok ? tx("From a field form") : tx("From a field form: not yet")}</p>
          {open && (
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              {tx(why)}
              {tag && <span className="mt-1 block text-xs">{tx("Where this comes from: {source}", { source: plainSources(tag) })}</span>}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={tx("Why is this required?")}
          className={`-me-2 -mt-2 grid h-12 w-12 shrink-0 place-items-center ${focusRing}`}
        >
          <span className={`grid h-7 w-7 place-items-center rounded-full border-2 text-sm font-bold transition ${open ? "border-forest bg-forest text-forest-ink" : "border-line-strong text-muted hover:border-forest hover:text-forest"}`}>?</span>
        </button>
      </div>
    </li>
  );
}

/* ---------- detail ---------- */

function Detail({
  item,
  role,
  ctx,
  apply,
  onBack,
  onOpen,
  outcome,
  noRule,
}: {
  item: FieldItem;
  role: FieldRole | null;
  ctx: Ctx;
  /** The farmer's selection outcome, when the project uses selection. */
  outcome?: Shown;
  /** ISS-18: no selection rule is saved for the project. */
  noRule?: boolean;
  apply: (fn: (i: FieldItem) => FieldItem, stock?: Stock) => void;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const { signIn, money, user, mode } = useSession();
  const { tx } = useT();
  const person = (r: string) => personIn(tx, r);
  const projectCode = useCurrentProject().project.id;
  const [raising, setRaising] = useState<string | null>(null);
  const [pending, setPending] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const step = fieldSteps[item.step];
  const owner = ownerOfItem(item);
  const ownerUser = owner ? holderOf("field", owner) : undefined;
  const mine = !!role && owner === role;
  const blocks = openBlocking(item);
  const checksOk = allChecksPass(item, ctx);
  const awaiting = item.kind === "farmer" && item.step === "distribute" ? item.awaiting : undefined;

  const log = (i: FieldItem, what: string): FieldItem => ({ ...i, timeline: [...i.timeline, { date: today(), who: role ?? "manager", what, ...(user ? { by: user.name } : {}) }] });

  const run = (o: Outcome, n: string) => {
    const r = o.effect?.(item, n, ctx);
    const base = r?.item ?? item;
    apply(() => log({ ...base, step: o.to }, n ? `${o.done}: ${n}` : o.done), r?.stock);
    setPending(null);
    setNote("");
  };

  // Field steps come from KoboCollect (lib/field handRecordProblem): the app shows them. The
  // project manager's remove-or-extend decision, and MEL findings, are still made here.
  const fromKobo = item.kind === "farmer" && item.step !== "removal";
  const canRun = (o: Outcome) => blocks.length === 0 && (o.requiresChecks === false || checksOk);
  const end = ENDS[item.step];

  return (
    <div className="space-y-6">
      <BackLink onClick={onBack} />

      {item.kind === "farmer" ? (
        <div className="font-bands">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted">{item.id}</span>
            {ctx.setup.season && <Pill tone="muted">{ctx.setup.season}</Pill>}
            {item.step === "correct" && <StatusPill tone="clay">{tx("Correcting")}</StatusPill>}
            {outcome && <Pill tone={outcome === "selected" ? "forest" : "ochre"}>{tx(outcomeLabel[outcome])}</Pill>}
          </div>
          {noRule && STARTS_WITHOUT_RULE.has(item.step) && (
            <p role="note" className="mt-3 border-s-[6px] border-ochre bg-ochre-soft px-3 py-2 text-sm font-medium">
              {tx("No farmer selection rule is saved for this project, so nothing written says why this farmer takes part.")}{" "}
              <Link href="/work/selection" className="font-bold underline">
                {tx("Farmer selection")}
              </Link>
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3">
            <h2 className="break-words text-3xl font-extrabold leading-tight tracking-tight">{farmerName(item, user)}</h2>
            <Link href={`/field/farmers/${item.id}`} className={bandLink}>
              {tx("Open profile")} <Arrow />
            </Link>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-1 sm:grid-cols-4">
            {[
              { k: "village", label: tx("Village"), v: item.community, warn: false },
              { k: "plot", label: tx("Plot"), v: ctx.setup.crop ? tx("{n} ha {crop}", { n: item.hectares, crop: ctx.setup.crop.toLowerCase() }) : tx("{n} ha", { n: item.hectares }), warn: false },
              { k: "contribution", label: tx("Contribution"), v: item.contributionPaid ? tx("Paid") : tx("Not paid"), warn: !item.contributionPaid },
              { k: "package", label: tx("Input package"), v: packageUsd(ctx.setup, item.hectares) ? money(packageUsd(ctx.setup, item.hectares)) : ctx.setup.items.length === 1 ? tx("1 item") : tx("{n} items", { n: ctx.setup.items.length }), warn: false },
            ].map(({ k, label, v, warn }) => (
              <div key={k} className={`min-w-0 px-3 py-2.5 ${warn ? `bg-ochre ${INK}` : "bg-sunken"}`}>
                <dt className={`text-sm font-bold ${warn ? "" : "text-muted"}`}>{label}</dt>
                <dd className="mt-0.5 break-words text-lg font-extrabold leading-tight tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <div className="font-bands">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted">{item.id}</span>
            <Pill tone="plum">{tx("MEL finding")}</Pill>
          </div>
          <h2 className="mt-2 break-words text-3xl font-extrabold leading-tight tracking-tight">{item.title}</h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-muted">{item.summary}</p>
          {item.sources.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">{tx("Sources")}</span>
              {item.sources.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onOpen(s)}
                  className="rounded-md border border-line bg-paper px-2 py-0.5 font-mono text-xs text-muted transition hover:border-forest hover:text-forest"
                >
                  {s} <Arrow />
                </button>
              ))}
            </div>
          )}
          {item.action && (
            <p className="mt-3 text-sm">
              <span className="font-semibold">{tx("Action:")}</span> {item.action.text} · {person(item.action.owner)} · {tx("due {date}", { date: item.action.due })}
            </p>
          )}
        </div>
      )}

      <div className="bg-sunken px-4 py-4">
        <Tracker
          labels={item.kind === "farmer" ? farmerStages : findingStages}
          current={stageOf(item)}
          marks={item.kind === "farmer" ? { 2: tx("Yes / No") } : {}}
          warn={["correct", "removal", "removed"].includes(item.step)}
        />
      </div>

      {end ? (
        <div className={`px-5 pb-6 pt-5 font-bands ${end.tone === "forest" ? "bg-deep text-deep-ink" : "bg-[#7a5230] text-white"}`}>
          <p className="text-3xl font-extrabold leading-tight">{tx(end.title)}</p>
          <p className="mt-2 text-base font-medium">{tx(end.body)}</p>
        </div>
      ) : (
        <FieldStep
          mine={mine}
          ownerLabel={person(owner!)}
          eyebrow={item.step === "verify" ? msg("Yes or no decision") : undefined}
          title={step.title}
          note={step.note?.(item)}
          onViewAs={ownerUser && mode === "demo" ? () => signIn(ownerUser.id) : undefined}
          switchLabel={ownerUser ? tx("Sign in as {name} (demo)", { name: ownerUser.name.split(" ")[0] }) : undefined}
          footer={
            <>
              {awaiting && (
                <div className={`px-5 py-4 text-base ${awaiting.status === "pending" ? `bg-ochre ${INK}` : "bg-[#7a5230] text-white"}`}>
                  {awaiting.status === "pending" ? (
                    <p>
                      <span className="font-extrabold">{tx("Distribution recorded.")}</span> {tx("Waiting for {person} to approve it; the farmer moves on to planting once approved.", { person: person("manager") })}
                    </p>
                  ) : (
                    <p>
                      <span className="font-extrabold">{tx("Sent back by the project manager:")}</span> {awaiting.note}
                    </p>
                  )}
                  {awaiting.id ? (
                    <Link
                      href={`/approve/${encodeURIComponent(projectCode)}/${awaiting.id}`}
                      className={`mt-3 flex min-h-14 w-full items-center justify-between gap-3 bg-white px-4 text-lg font-extrabold text-[#314d2f] hover:bg-sunken ${focusRing}`}
                    >
                      {awaiting.status === "pending" ? tx("See the distribution record") : tx("Fix it and send it again")}
                      <span className="text-2xl leading-none">
                        <Arrow />
                      </span>
                    </Link>
                  ) : (
                    <p className="mt-2 text-sm font-medium opacity-90">{tx("Saving the record…")}</p>
                  )}
                </div>
              )}
              {fromKobo && <KoboPanel farmer={item as Farmer} ctx={ctx} canRaise={!!role && raising === null} onRaise={() => setRaising("")} />}
              {mine && !awaiting && !fromKobo && (
                <>
                <div className="space-y-3 border-t border-line px-5 py-4 empty:hidden">
                  {blocks.length > 0 && <p className="text-base font-bold text-clay">{tx("An open issue is holding this step.")}</p>}
                  {item.step === "decide" && checksOk && blocks.length === 0 && (
                    <div className="bg-sunken p-4">
                      <ActionForm
                        onSave={(a) => {
                          apply((i) => log({ ...(i as Finding), action: a, step: "act" }, `Action assigned to ${fieldPerson(a.owner)}: ${a.text}`));
                        }}
                      />
                    </div>
                  )}
                </div>
                <div className={greenActions}>
                  {pending ? (
                    <form
                      className="flex flex-wrap gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (note.trim()) run(pending, note.trim());
                      }}
                    >
                      <input
                        id="outcome-note"
                        autoFocus
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={pending.note ? tx(pending.note) : undefined}
                        className="min-h-12 w-full min-w-0 border-2 border-white bg-surface px-3 text-base text-ink focus:border-ochre focus:outline-none"
                      />
                      <button type="submit" disabled={!note.trim()} className={pending.tone === "danger" ? onGreenDanger : startBtn}>
                        {tx(pending.label)}
                      </button>
                      <button type="button" onClick={() => setPending(null)} className={`min-h-12 px-3 text-base font-bold text-deep-ink/85 hover:text-deep-ink ${onGreenFocus}`}>
                        {tx("Cancel")}
                      </button>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {step.outcomes.map((o) => (
                        <button
                          key={o.label}
                          type="button"
                          disabled={!canRun(o)}
                          onClick={() => (o.note ? setPending(o) : run(o, ""))}
                          className={o.tone === "primary" ? startBtn : o.tone === "danger" ? onGreenDanger : onGreenQuiet}
                        >
                          {tx(o.label)}
                          {o.tone === "primary" && <span className="text-2xl leading-none"><Arrow /></span>}
                        </button>
                      ))}
                      {raising === null && (
                        <button type="button" onClick={() => setRaising("")} className={`min-h-12 px-3 text-base font-bold text-deep-ink/85 hover:text-deep-ink ${onGreenFocus}`}>
                          {tx("+ Raise issue")}
                        </button>
                      )}
                    </div>
                  )}
                  {!checksOk && blocks.length === 0 && <p className="text-sm font-medium text-deep-ink/85">{tx("Complete every item above to continue.")}</p>}
                </div>
                </>
              )}
              {raising !== null && role && (
                <div className="border-t border-line px-5 py-4">
                  <IssueForm
                    types={issueTypes}
                    help={issueHelp}
                    footnote={ISSUE_FOOTNOTE}
                    initial={raising}
                    onCancel={() => setRaising(null)}
                    onSave={(i) => {
                      apply((x) => log({ ...x, issues: [...x.issues, { ...i, id: `I-${x.issues.length + 1}`, by: role, status: "open" }] }, `Issue raised: ${i.type}`));
                      setRaising(null);
                    }}
                  />
                </div>
              )}
            </>
          }
        >
          <ul className="divide-y divide-line px-5">
            {step.checks.map((c) => {
              const s = fieldCheck(item, c, ctx);
              // Filled from KoboCollect and not editable here: shown as a state, never as a box to tick.
              if (fromKobo && !s.auto && !c.resolveEffect) return <KoboCheck key={c.id} label={c.label} why={c.why} tag={c.tag} ok={s.ok} />;
              return (
                <CheckRow
                  key={c.id}
                  c={{
                    key: `${item.id}-${item.step}-${c.id}`,
                    label: c.label,
                    why: c.why,
                    tag: c.tag,
                    ...s,
                    findings: c.ai && item.kind === "finding" ? item.ai : undefined,
                    fix: c.fix,
                    resolve: c.resolve,
                  }}
                  // Steps are KoboCollect's, but a record no form asks (the contribution received) is still made here.
                  canEdit={mine && (!fromKobo || !!c.resolveEffect)}
                  onToggle={() => apply((i) => ({ ...i, checks: { ...i.checks, [`${i.step}.${c.id}`]: !i.checks[`${i.step}.${c.id}`] } }))}
                  onRaise={(n) => setRaising(n)}
                  onResolve={() =>
                    apply((i) => log(c.resolveEffect ? c.resolveEffect(i) : { ...i, checks: { ...i.checks, [`fix.${i.step}.${c.id}`]: true } }, c.resolveDone ?? c.resolve!))
                  }
                />
              );
            })}
          </ul>
        </FieldStep>
      )}

      <IssueList
        issues={item.issues}
        roleLabel={person}
        canResolve={(i) => mine || i.by === role}
        onResolve={(id, n) =>
          apply((x) => log({ ...x, issues: x.issues.map((y) => (y.id === id ? { ...y, status: "resolved", resolution: n } : y)) }, "Issue resolved"))
        }
      />

      <History events={item.timeline} roleLabel={person} />
    </div>
  );
}

/* ---------- what KoboCollect records ---------- */

/** The KoboCollect form that records each farmer step; MEL accepts it, or the project manager approves a distribution, and the farmer moves on. */
const KOBO_FORM: Record<string, string> = {
  train: msg("Training attendance form"),
  prepare: msg("Readiness visit form, at the joint visit with MEL"),
  verify: msg("Readiness visit form"),
  correct: msg("Readiness visit form, at the recheck"),
  distribute: msg("Distribution form, with the photo of the signed distribution receipt; then the project manager approves it"),
  plant: msg("Farm visit form after planting"),
};

/**
 * Read-only: where the farmer stands, which KoboCollect form moves them on, and what the accepted
 * forms say (the history lines they wrote). Nothing here records a visit.
 */
function KoboPanel({ farmer, ctx, canRaise, onRaise }: { farmer: Farmer; ctx: Ctx; canRaise: boolean; onRaise: () => void }) {
  const { tx } = useT();
  const form = KOBO_FORM[farmer.step];
  const fromKobo = farmer.timeline.filter((t) => /Kobo/i.test(t.what)).slice(-3).reverse();
  const p = farmer.planting;
  return (
    <div className="space-y-2 bg-sunken px-5 py-4 text-base">
      <p>
        <span className="font-extrabold">{tx("Recorded on a field form.")}</span>
        {form && (
          <>
            {" "}
            {tx("Next form: {form}.", { form: tx(form) })} {farmer.step === "distribute" ? "" : tx("MEL accepts it, and the farmer moves on.")}
          </>
        )}
      </p>
      {p && (
        <p className="text-muted">
          {p.count !== undefined
            ? tx("Planted {date} · {count} {unit}, {ha} of {total} ha", { date: p.date, count: p.count.toLocaleString("en-US"), unit: ctx.setup.plan?.unit ?? tx("plants"), ha: p.hectares, total: farmer.hectares })
            : tx("Planted {date} · {ha} of {total} ha", { date: p.date, ha: p.hectares, total: farmer.hectares })}
        </p>
      )}
      {fromKobo.length > 0 ? (
        <ul className="space-y-1 text-muted">
          {fromKobo.map((t, k) => (
            <li key={k}>
              <span className="font-mono text-xs">{t.date}</span> · {t.what}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">{tx("No field form accepted for this farmer yet.")}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-5">
        <Link href="/progress/results#field-records" className={bandLink}>
          {tx("Forms waiting for MEL")} <Arrow />
        </Link>
        {canRaise && (
          <button type="button" onClick={onRaise} className={`min-h-12 font-bold text-muted hover:text-ink ${focusRing}`}>
            {tx("+ Raise issue")}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- workspace ---------- */

/**
 * The farmer table as a spreadsheet (lib/field-data): one row per farmer, by number, with each
 * step's date, how readiness went and what they received. For analysis outside the app.
 */
function FarmerTableLink({ code, userId }: { code: string; userId: string }) {
  const { tx } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const download = async (table: "farmers" | "records" = "farmers") => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(code)}/field/export${table === "records" ? "?table=records" : ""}`, { cache: "no-store", headers: { "x-demo-user": userId } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? tx("Could not make the file ({status}).", { status: res.status }));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${code}-${table === "records" ? "field-records" : "farmers"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-3 mt-4 bg-sunken px-4 py-3 font-bands text-sm sm:mx-4">
      <button type="button" onClick={() => download("farmers")} disabled={busy} className={`${bandLink} text-start disabled:opacity-60`}>
        {busy ? tx("Making the file…") : tx("Download the farmer table (spreadsheet) ↓")}
      </button>
      <p className="mt-1 text-xs text-muted">{tx("One row per farmer, by number, never by name: each step’s date, how the readiness check went, what they received and the days between steps.")}</p>
      <button type="button" onClick={() => download("records")} disabled={busy} className={`mt-2 ${bandLink} text-start disabled:opacity-60`}>
        {busy ? tx("Making the file…") : tx("Download the field records table (spreadsheet) ↓")}
      </button>
      <p className="mt-1 text-xs text-muted">{tx("One row per record: every training attendance, readiness check, farm visit and distribution, with who collected it, the decision and how long it waited. Join it to the farmer table by farmer number.")}</p>
      {error && <p role="alert" className="mt-1 text-xs text-clay">{error}</p>}
    </div>
  );
}

/** The field forms this person may fill in, each one tap away (components/field/form-runner). */
function FormLinks({ hasPackage }: { hasPackage: boolean }) {
  const { user } = useSession();
  const { tx } = useT();
  if (!user || !mayOpenForms(user)) return null;
  const kinds = APP_FORM_KINDS.filter((k) => (k === "register" ? mayRegister(user) : mayFillForms(user)) && (k !== "distribution" || hasPackage));
  return (
    <nav id="fill-in-a-form" aria-labelledby="fill-in" className="mx-3 mt-4 font-bands sm:mx-4">
      <h2 id="fill-in" className="text-base font-extrabold">{tx("Fill in a form")}</h2>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {kinds.map((k) => (
          <li key={k}>
            <Link href={`/field/forms/${k}`} className={`inline-flex min-h-12 items-center border-2 border-forest bg-surface px-3 text-sm font-bold text-forest hover:bg-ochre-soft ${focusRing}`}>
              {tx(APP_FORM_TEXT[k].title)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function FieldWorkspace() {
  const { user, mode } = useRequireUser();
  const { tx } = useT();
  const myRoles = (user?.field ?? []) as FieldRole[];
  const { project } = useCurrentProject();
  const { items: all, setItems, stock, stockNote, setStock, setup, selection, status, error, reload, reset } = useFieldData(project.id);
  // Farmers waitlisted or who did not qualify (Farmer selection) are not trained or served: they
  // stay out of the queue. Without selection rules on the project, everyone stays in.
  const outcomeOfItem = (i: FieldItem) => (i.kind === "farmer" ? selection?.[i.id] : undefined);
  const items = all.filter((i) => inFieldQueue(outcomeOfItem(i)));
  const heldBack = all.length - items.length;
  const ruleFlag = status === "ready" ? noSelectionRule(selection, all.filter((i) => i.kind === "farmer")) : null;
  const [panel, setPanel] = useState<"" | "package" | "farmers">("");
  const [pickedRole, setPickedRole] = useState<FieldRole | null>(null);
  const counts = Object.fromEntries(fieldRoles.map((r) => [r.id, items.filter((i) => ownerOfItem(i) === r.id).length]));
  // Open on the first of the person's roles with something waiting, chosen once when the list loads.
  const role = useDefaultRole(myRoles, counts, status === "ready", project.id, pickedRole);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Search (farmer number, village, and the name for people who may see names) and a tapped season count.
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const ctx: Ctx = { stock, stockNote, setup: setup ?? { items: [] }, today: today() };
  const mayManage = !!user && user.kind === "employee" && (canEditProject(user) || user.field.includes("manager"));
  // The demo project's sample records are the only ones a reset restores.
  const isDemo = project.id === "A-2027";

  // Links such as /field?open=F-0009 open that record.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const open = q.get("open");
    if (open) {
      setSelected(open);
      setShowAll(true);
      setMobileDetail(true);
    }
    if (q.get("new")) {
      setCreating(true);
      setMobileDetail(true);
    }
  }, []);

  const farmers = items.filter((i): i is Farmer => i.kind === "farmer");
  // A farmer counts at their stage; a finished season record counts in the last one.
  const inStage = (f: Farmer, k: number) => f.step !== "removed" && (stageOf(f) === k || (k === farmerStages.length - 1 && f.step === "complete"));
  const pipeline = farmerStages.map((label, k) => ({ label, n: farmers.filter((f) => inStage(f, k)).length }));
  const readOnly = !role;
  const mineList = role ? items.filter((i) => ownerOfItem(i) === role) : items;
  const q = query.trim().toLowerCase();
  const filtering = !!q || stageFilter !== null;
  const matches = (i: FieldItem) => {
    if (stageFilter !== null && (i.kind !== "farmer" || !inStage(i, stageFilter))) return false;
    if (!q) return true;
    // Names are searched only for people allowed to see them, so a search never reveals one.
    const hay = i.kind === "farmer" ? [i.id, i.community, user?.pii ? i.name : ""] : [i.id, i.title];
    return hay.some((h) => h && h.toLowerCase().includes(q));
  };
  // A search or a tapped count looks across everything this season, not only what waits on you.
  const list = filtering ? items.filter(matches) : showAll || readOnly ? items : mineList;
  const clearFilters = () => {
    setQuery("");
    setStageFilter(null);
    setShowAll(true);
  };
  // A link can still open a farmer who is not in the queue (waitlisted, say), to see their record.
  const current = all.find((i) => i.id === selected) ?? list[0] ?? null;
  const upcoming = role ? comingTo(items, role, user, tx).slice(0, 5) : [];

  const apply = (id: string) => (fn: (i: FieldItem) => FieldItem, next?: Stock) => {
    setSelected(id);
    setItems((all) => all.map((i) => (i.id === id ? fn(i) : i)));
    if (next) setStock(next);
  };

  if (!user) return null;
  if (user.fieldAccess === "none") return <NoAccess what={tx("Field activities")} />;
  // A project without an input package has no field workflow yet: its manager sets it up first.
  if (status === "ready" && !setup)
    return <SetupOnly code={project.id} mayManage={mayManage} onSaved={() => void reload()} />;

  return (
    <AppShell
      active="field"
      roles={fieldRoles.filter((r) => myRoles.includes(r.id)).map((r) => ({ ...r, label: tx(r.label), short: tx(r.short) }))}
      role={role}
      counts={counts}
      onRole={(r) => {
        setPickedRole(r as FieldRole);
        setSelected(null);
        setShowAll(false);
        setQuery("");
        setStageFilter(null);
        setMobileDetail(false);
      }}
      primary={
        myRoles.includes("mel")
          ? {
              label: tx("+ New finding"),
              onClick: () => {
                setPickedRole("mel");
                setCreating(true);
                setMobileDetail(true);
              },
            }
          : undefined
      }
      mobileDetail={mobileDetail}
      queue={
        <>
          <FormLinks hasPackage={!!setup?.items.length} />
          <p className="mx-3 mt-3 font-bands text-base font-medium sm:mx-4">{tx("This page shows where each farmer stands and what needs approving.")}</p>
          <DataBanner status={status} error={error} />
          {/* Season counts as bands: one big number per stage. Three across in a narrow column, six when there is room; labels may take two lines. */}
          <section aria-labelledby="season-counts" className="@container mx-3 mt-4 font-bands sm:mx-4">
            <h2 id="season-counts" className="bg-sunken px-3 pb-1 pt-3 text-base font-extrabold leading-snug">
              {[ctx.setup.season, ctx.setup.village, status === "loading" ? "" : farmers.length === 1 ? tx("1 farmer") : tx("{n} farmers", { n: farmers.length })].filter(Boolean).join(" · ")}
            </h2>
            <ol className="grid grid-cols-3 gap-1 bg-sunken p-1 @md:grid-cols-6">
              {pipeline.map((s, k) => (
                <li key={s.label} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={stageFilter === k}
                    title={tx("Show only farmers at {stage}", { stage: tx(s.label) })}
                    onClick={() => setStageFilter(stageFilter === k ? null : k)}
                    className={`flex h-full min-h-24 w-full flex-col items-start justify-between gap-1 px-2.5 pb-2.5 pt-2 text-start transition ${focusRing} ${stageFilter === k ? "bg-deep text-deep-ink" : "bg-surface text-ink hover:bg-ochre-soft"}`}
                  >
                    <span className="block text-4xl font-extrabold leading-none tracking-tighter tabular-nums">{status === "loading" ? "–" : s.n}</span>
                    <span className="block w-full break-words text-sm font-bold leading-tight [hyphens:auto]">{tx(s.label)}</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="space-y-2 bg-sunken px-3 pb-3 pt-1 text-sm">
              <p className="font-bold text-muted">{tx("Tap a count to see those farmers.")}</p>
              <p className="border-t border-line pt-2 font-bold">
                {tx("Store: {items}", { items: status === "loading" ? "…" : ctx.setup.items.map((p) => qtyItem(stock[p.key] ?? 0, p.unit, p.item)).join(" · ") })}
              </p>
              {ruleFlag && (
                <p role="note" className="border-s-[6px] border-ochre bg-ochre-soft px-3 py-2 font-medium">
                  {ruleFlag}{" "}
                  <Link href="/work/selection" className="font-bold underline">
                    {tx("Write the rule")}
                  </Link>
                </p>
              )}
              {heldBack > 0 && (
                <p className="border-t border-line pt-2 font-medium text-muted">
                  {heldBack === 1 ? tx("1 farmer waitlisted or not qualified is not in this queue.") : tx("{n} farmers waitlisted or not qualified are not in this queue.", { n: heldBack })}
                </p>
              )}
              <div className="flex flex-wrap gap-x-5 border-t border-line">
                {mayManage && (
                  <>
                    <button type="button" className={bandLink} onClick={() => { setPanel("farmers"); setCreating(false); setMobileDetail(true); }}>
                      {tx("Load farmer list")}
                    </button>
                    <button type="button" className={bandLink} onClick={() => { setPanel("package"); setCreating(false); setMobileDetail(true); }}>
                      {tx("Input package")}
                    </button>
                  </>
                )}
                <Link href="/work/selection" className={bandLink}>
                  {tx("Farmer selection")}
                </Link>
              </div>
            </div>
          </section>
          <div className="mx-3 mt-4 font-bands sm:mx-4">
            <label className="block">
              <span className="sr-only">{tx("Search farmers")}</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={user?.pii ? tx("Search by farmer number, name or village") : tx("Search by farmer number or village")}
                className="min-h-12 w-full border-2 border-line-strong bg-surface px-3 text-base font-medium placeholder:text-muted focus:border-forest focus:outline-none"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 px-4 pb-2 pt-5 font-bands sm:px-6">
            <h1 className="min-w-0 break-words text-2xl font-extrabold leading-tight tracking-tight">
              {status === "loading"
                ? tx("Loading…")
                : filtering
                  ? [stageFilter !== null ? tx(farmerStages[stageFilter]) : "", q ? `“${query.trim()}”` : "", list.length === 1 ? tx("1 match") : tx("{n} matches", { n: list.length })].filter(Boolean).join(" · ")
                  : readOnly ? tx("Everything this season") : showAll ? tx("Everything this season") : mineList.length ? tx("{n} waiting on you", { n: mineList.length }) : tx("Nothing waiting on you")}
            </h1>
            {(filtering || !readOnly) && (
              <button type="button" onClick={() => (filtering ? clearFilters() : setShowAll(!showAll))} className={`min-h-12 text-base font-bold text-muted hover:text-ink ${focusRing}`}>
                {filtering ? tx("Everything this season") : showAll ? tx("Mine") : tx("Show all")}
              </button>
            )}
          </div>
          {list.length === 0 && filtering && status !== "loading" ? (
            <div className="px-4 py-10 text-center font-bands sm:px-6">
              <p className="text-base font-bold text-muted">{tx("No farmer matches.")}</p>
              <button type="button" onClick={clearFilters} className={`mt-1 ${bandLink}`}>
                {tx("Back to everything this season")}
              </button>
            </div>
          ) : list.length === 0 ? (
            <EmptyQueue loading={status === "loading"} onShowAll={() => setShowAll(true)} />
          ) : (
            <ul className="space-y-1.5 px-2 pb-6 font-bands sm:px-3">
              {list.map((i) => {
                const s = fieldSteps[i.step];
                const end = ENDS[i.step];
                const left = i.kind === "farmer" && i.step === "correct" && i.deadline ? Math.round((Date.parse(i.deadline) - Date.parse(today())) / 86400000) : null;
                const o = ownerOfItem(i);
                return (
                  <QueueItem
                    key={i.id}
                    active={!creating && current?.id === i.id}
                    onClick={() => {
                      setSelected(i.id);
                      setCreating(false);
                      setPanel("");
                      setMobileDetail(true);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-muted">{i.id}</span>
                      <span className="text-xs text-muted">{i.kind === "farmer" ? tx("{n} ha", { n: i.hectares }) : tx("Finding")}</span>
                    </div>
                    <p className="mt-1 text-lg font-bold leading-snug">{i.kind === "farmer" ? farmerName(i, user) : i.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {end ? (
                        <Pill tone={end.tone}>{tx(end.title)}</Pill>
                      ) : (
                        <Pill tone={o === role ? (["correct", "removal"].includes(i.step) ? "clay" : "forest") : "muted"}>{tx(s.title)}</Pill>
                      )}
                      {left !== null && <Pill tone={left < 0 ? "clay" : "ochre"}>{left < 0 ? tx("Deadline passed") : left === 1 ? tx("1 day to fix") : tx("{n} days to fix", { n: left })}</Pill>}
                      {openBlocking(i).length > 0 && <Pill tone="clay">{tx("Issue")}</Pill>}
                      {outcomeOfItem(i) === "selected" && <Pill tone="muted">{tx("Selected")}</Pill>}
                      {(showAll || readOnly || filtering) && o && o !== role && <span className="text-xs text-muted">{holderOf("field", o)?.name}</span>}
                    </div>
                  </QueueItem>
                );
              })}
            </ul>
          )}
          <ComingUp
            items={upcoming}
            onOpen={(id) => {
              setSelected(id);
              setShowAll(true);
              setMobileDetail(true);
            }}
          />
          <FarmerTableLink code={project.id} userId={user?.id ?? ""} />
          <QueueFooter
            note={mode === "demo" && isDemo ? tx("Fictional records, saved in the project database. Resetting keeps real field records.") : tx("Saved in the project database.")}
            onReset={
              mode === "demo" && isDemo
                ? () => {
                    void reset();
                    setSelected(null);
                  }
                : undefined
            }
          />
        </>
      }
      detail={
        panel === "package" ? (
          <PackageSetup code={project.id} onSaved={() => { setPanel(""); void reload(); }} onCancel={() => setPanel("")} />
        ) : panel === "farmers" || (!all.some((i) => i.kind === "farmer") && mayManage && !creating) ? (
          <FarmerImport code={project.id} onDone={() => { setPanel(""); void reload(); }} onCancel={panel ? () => setPanel("") : undefined} />
        ) : creating ? (
          <NewFinding
            farmers={farmers}
            onCancel={() => {
              setCreating(false);
              setMobileDetail(false);
            }}
            onCreate={(f) => {
              setItems((all) => [f, ...all]);
              setSelected(f.id);
              setCreating(false);
            }}
          />
        ) : current ? (
          <div className="mx-auto max-w-3xl">
            <Detail
              key={current.id}
              item={current}
              role={role}
              ctx={ctx}
              apply={apply(current.id)}
              outcome={outcomeOfItem(current)}
              noRule={!!ruleFlag}
              onBack={() => setMobileDetail(false)}
              onOpen={(id) => {
                setSelected(id);
                setShowAll(true);
              }}
            />
          </div>
        ) : (
          <div className="grid h-full place-items-center py-24 text-center">
            <div>
              <p className="font-bands text-3xl font-extrabold">{status === "loading" ? tx("Loading…") : tx("Nothing selected")}</p>
              {status !== "loading" && <p className="mt-1 font-bands text-base font-medium text-muted">{tx("Pick a farmer or finding from the list.")}</p>}
            </div>
          </div>
        )
      }
    />
  );
}

/** Field activities on a project whose input package is not set up yet. */
function SetupOnly({ code, mayManage, onSaved }: { code: string; mayManage: boolean; onSaved: (s: FieldSetup) => void }) {
  const { tx } = useT();
  return (
    <AppShell
      active="field"
      roles={[]}
      role={null}
      counts={{}}
      onRole={() => {}}
      mobileDetail
      queue={
        <div className="mx-3 mt-4 rounded-xl border border-line bg-surface px-4 py-4 text-sm sm:mx-4">
          <p className="font-medium">{tx("Not set up yet")}</p>
          <p className="mt-1 text-muted">
            {mayManage
              ? tx("Say what one farmer receives and the budget line each item is bought on. Then load the farmer list.")
              : tx("The project manager sets up the input package and loads the farmer list before field work starts here.")}
          </p>
        </div>
      }
      detail={mayManage ? <PackageSetup code={code} onSaved={onSaved} /> : <div className="grid h-full place-items-center py-24 text-center text-sm text-muted">{tx("Nothing to do here yet.")}</div>}
    />
  );
}
