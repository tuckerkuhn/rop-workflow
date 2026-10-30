"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRequireUser, useSession } from "@/components/app/session";
import { useFieldData } from "@/components/app/use-project-data";
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
  QueueHeader,
  QueueItem,
  StepCard,
  TODAY,
  Tracker,
  dangerBtn,
  primaryBtn,
  quietBtn,
} from "@/components/workspace/ui";
import { holderOf, type AppUser } from "@/lib/demo";
import { NoAccess } from "@/components/workspace/ui";
import {
  ISSUE_FOOTNOTE,
  PACKAGE,
  PACKAGE_USD,
  SEASON,
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
  historyBasis,
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
  if (status === "loading") return <p className="mx-3 mt-4 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted sm:mx-4">Loading field records…</p>;
  if (!error) return null;
  return (
    <p role="alert" className="mx-3 mt-4 rounded-xl border border-clay/40 bg-clay-soft px-3 py-2 text-sm text-clay sm:mx-4">
      {error}
    </p>
  );
}

const ENDS: Record<string, { title: string; body: string; tone: "forest" | "clay" }> = {
  complete: { title: "Season record complete", body: "Trained, verified, supplied and planted. Follow-up visits continue through harvest.", tone: "forest" },
  removed: { title: "Removed from the project", body: "The decision and its reason are on the record below.", tone: "clay" },
  closed: { title: "Closed", body: "The decision and any action feed the next seasonal plan.", tone: "forest" },
};

export const stageOf = (i: FieldItem) =>
  i.step in ENDS ? (i.kind === "farmer" ? (i.step === "removed" ? 2 : farmerStages.length) : findingStages.length) : fieldSteps[i.step].stage;

/** Items that will reach `role` later, with the projected arrival date. */
export function comingTo(items: FieldItem[], role: string, viewer?: AppUser | null) {
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
          step: fieldSteps[hit.step].title,
          eta: hit.start,
          via: `${fieldSteps[path[0].step].title.toLowerCase()} with ${holderOf("field", path[0].owner)?.name ?? fieldRoleLabel(path[0].owner)}`,
          basis: path.slice(0, path.indexOf(hit)).map((p) => `${fieldSteps[p.step].title}: ${historyBasis(p.step)}`).join(" · "),
        },
      ];
    })
    .sort((a, b) => a.eta.localeCompare(b.eta));
}

/* ---------- forms ---------- */

function ActionForm({ onSave }: { onSave: (a: { text: string; owner: FieldRole; due: string }) => void }) {
  const [text, setText] = useState("");
  const [owner, setOwner] = useState<FieldRole>("extension");
  const [due, setDue] = useState(addDays(TODAY, 7));
  const field = "rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSave({ text: text.trim(), owner, due });
      }}
      className="space-y-3"
    >
      <p className="text-sm font-medium">Assign an action</p>
      <input id="action-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="What should change?" className={`w-full ${field}`} />
      <div className="flex flex-wrap gap-2">
        <select id="action-owner" value={owner} onChange={(e) => setOwner(e.target.value as FieldRole)} className={field} aria-label="Owner">
          {fieldRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {fieldPerson(r.id)}
            </option>
          ))}
        </select>
        <input id="action-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className={field} aria-label="Due date" />
        <button type="submit" disabled={!text.trim()} className={primaryBtn}>
          Assign action →
        </button>
      </div>
    </form>
  );
}

function NewFinding({ farmers, onCancel, onCreate }: { farmers: Farmer[]; onCancel: () => void; onCreate: (f: Finding) => void }) {
  const { user } = useSession();
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
          timeline: [{ date: TODAY, who: "mel", what: "Finding drafted" }],
        });
      }}
      className="mx-auto max-w-2xl space-y-6"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">New finding</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight">What did you see in the field?</h2>
      </div>
      <label className="block">
        <span className="text-sm font-medium">Finding</span>
        <input id="nf-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Late planting on the hillside plots" className={`mt-1 ${field}`} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">What the evidence shows</span>
        <textarea id="nf-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} className={`mt-1 ${field}`} />
      </label>
      <fieldset>
        <legend className="text-sm font-medium">Source records</legend>
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
          Create finding
        </button>
        <button type="button" onClick={onCancel} className="rounded-full px-4 py-3 text-sm text-muted hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
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
}: {
  item: FieldItem;
  role: FieldRole | null;
  ctx: Ctx;
  apply: (fn: (i: FieldItem) => FieldItem, stock?: Stock) => void;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const { signIn, money, user } = useSession();
  const [raising, setRaising] = useState<string | null>(null);
  const [pending, setPending] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const step = fieldSteps[item.step];
  const owner = ownerOfItem(item);
  const ownerUser = owner ? holderOf("field", owner) : undefined;
  const mine = !!role && owner === role;
  const blocks = openBlocking(item);
  const checksOk = allChecksPass(item, ctx);

  const log = (i: FieldItem, what: string): FieldItem => ({ ...i, timeline: [...i.timeline, { date: TODAY, who: role ?? "manager", what }] });

  const run = (o: Outcome, n: string) => {
    const r = o.effect?.(item, n, ctx);
    const base = r?.item ?? item;
    apply(() => log({ ...base, step: o.to }, n ? `${o.done}: ${n}` : o.done), r?.stock);
    setPending(null);
    setNote("");
  };

  const canRun = (o: Outcome) => blocks.length === 0 && (o.requiresChecks === false || checksOk);
  const end = ENDS[item.step];

  return (
    <div className="space-y-6">
      <BackLink onClick={onBack} />

      {item.kind === "farmer" ? (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted">{item.id}</span>
            <Pill tone="muted">{SEASON.name}</Pill>
            {item.step === "correct" && <Pill tone="clay">Correcting</Pill>}
          </div>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-3xl leading-tight tracking-tight">{farmerName(item, user)}</h2>
            <Link href={`/field/farmers/${item.id}`} className="text-sm font-semibold text-forest hover:underline">
              Open profile →
            </Link>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            {[
              ["Village", SEASON.village],
              ["Plot", `${item.hectares} ha ${SEASON.crop.toLowerCase()}`],
              ["Contribution", item.contributionPaid ? "Paid" : "Not paid"],
              ["Input package", money(PACKAGE_USD)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
                <dd className={`mt-0.5 tabular-nums ${v === "Not paid" ? "font-medium text-clay" : ""}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted">{item.id}</span>
            <Pill tone="plum">MEL finding</Pill>
          </div>
          <h2 className="mt-2 font-display text-3xl leading-tight tracking-tight">{item.title}</h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-muted">{item.summary}</p>
          {item.sources.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Sources</span>
              {item.sources.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onOpen(s)}
                  className="rounded-md border border-line bg-paper px-2 py-0.5 font-mono text-[11px] text-muted transition hover:border-forest hover:text-forest"
                >
                  {s} →
                </button>
              ))}
            </div>
          )}
          {item.action && (
            <p className="mt-3 text-sm">
              <span className="font-semibold">Action:</span> {item.action.text} · {fieldPerson(item.action.owner)} · due {item.action.due}
            </p>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-line bg-surface px-4 py-4">
        <Tracker
          labels={item.kind === "farmer" ? farmerStages : findingStages}
          current={stageOf(item)}
          marks={item.kind === "farmer" ? { 2: "Yes / No" } : {}}
          warn={["correct", "removal", "removed"].includes(item.step)}
        />
      </div>

      {end ? (
        <div className={`rounded-2xl border p-6 ${end.tone === "forest" ? "border-forest/30 bg-mist" : "border-clay/30 bg-clay-soft"}`}>
          <p className={`font-display text-2xl ${end.tone === "forest" ? "text-forest" : "text-clay"}`}>{end.title}</p>
          <p className="mt-1 text-sm text-muted">{end.body}</p>
        </div>
      ) : (
        <StepCard
          mine={mine}
          ownerLabel={fieldPerson(owner!)}
          eyebrow={item.step === "verify" ? "Yes / No gate" : undefined}
          title={step.title}
          note={step.note?.(item)}
          onViewAs={ownerUser ? () => signIn(ownerUser.id) : undefined}
          switchLabel={ownerUser ? `Sign in as ${ownerUser.name.split(" ")[0]} (demo)` : undefined}
          footer={
            <>
              {mine && (
                <div className="space-y-3 border-t border-line px-5 py-4">
                  {blocks.length > 0 && <p className="text-sm font-medium text-clay">An open issue is holding this step.</p>}
                  {item.step === "decide" && checksOk && blocks.length === 0 && (
                    <div className="rounded-xl border border-line bg-paper p-4">
                      <ActionForm
                        onSave={(a) => {
                          apply((i) => log({ ...(i as Finding), action: a, step: "act" }, `Action assigned to ${fieldPerson(a.owner)}: ${a.text}`));
                        }}
                      />
                    </div>
                  )}
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
                        placeholder={pending.note}
                        className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none"
                      />
                      <button type="submit" disabled={!note.trim()} className={pending.tone === "danger" ? dangerBtn : primaryBtn}>
                        {pending.label}
                      </button>
                      <button type="button" onClick={() => setPending(null)} className="px-2 text-sm text-muted">
                        Cancel
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
                          className={o.tone === "primary" ? primaryBtn : o.tone === "danger" ? dangerBtn : quietBtn}
                        >
                          {o.label}
                          {o.tone === "primary" && " →"}
                        </button>
                      ))}
                      {raising === null && (
                        <button type="button" onClick={() => setRaising("")} className="rounded-full px-4 py-3 text-sm font-medium text-muted hover:text-ink">
                          + Raise issue
                        </button>
                      )}
                    </div>
                  )}
                  {!checksOk && blocks.length === 0 && <p className="text-xs text-muted">Complete every item above to continue.</p>}
                </div>
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
                  canEdit={mine}
                  onToggle={() => apply((i) => ({ ...i, checks: { ...i.checks, [`${i.step}.${c.id}`]: !i.checks[`${i.step}.${c.id}`] } }))}
                  onRaise={(n) => setRaising(n)}
                  onResolve={() =>
                    apply((i) => log(c.resolveEffect ? c.resolveEffect(i) : { ...i, checks: { ...i.checks, [`fix.${i.step}.${c.id}`]: true } }, c.resolve!))
                  }
                />
              );
            })}
          </ul>
        </StepCard>
      )}

      <IssueList
        issues={item.issues}
        roleLabel={fieldPerson}
        canResolve={(i) => mine || i.by === role}
        onResolve={(id, n) =>
          apply((x) => log({ ...x, issues: x.issues.map((y) => (y.id === id ? { ...y, status: "resolved", resolution: n } : y)) }, "Issue resolved"))
        }
      />

      <History events={item.timeline} roleLabel={fieldPerson} />
    </div>
  );
}

/* ---------- workspace ---------- */

export function FieldWorkspace() {
  const { user } = useRequireUser();
  const myRoles = (user?.field ?? []) as FieldRole[];
  const { items, setItems, stock, setStock, status, error, reset } = useFieldData();
  const [pickedRole, setPickedRole] = useState<FieldRole | null>(null);
  const role = pickedRole && myRoles.includes(pickedRole) ? pickedRole : (myRoles[0] ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const ctx: Ctx = { stock };

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

  const counts = useMemo(() => Object.fromEntries(fieldRoles.map((r) => [r.id, items.filter((i) => ownerOfItem(i) === r.id).length])), [items]);
  const farmers = items.filter((i): i is Farmer => i.kind === "farmer");
  const pipeline = farmerStages.map((label, k) => ({
    label,
    n: farmers.filter((f) => f.step !== "removed" && stageOf(f) === k).length + (k === farmerStages.length - 1 ? farmers.filter((f) => f.step === "complete").length : 0),
  }));
  const readOnly = !role;
  const mineList = role ? items.filter((i) => ownerOfItem(i) === role) : items;
  const list = showAll || readOnly ? items : mineList;
  const current = items.find((i) => i.id === selected) ?? list[0] ?? null;
  const upcoming = role ? comingTo(items, role, user).slice(0, 5) : [];

  const apply = (id: string) => (fn: (i: FieldItem) => FieldItem, next?: Stock) => {
    setSelected(id);
    setItems((all) => all.map((i) => (i.id === id ? fn(i) : i)));
    if (next) setStock(next);
  };

  if (!user) return null;
  if (user.fieldAccess === "none") return <NoAccess what="Field activities" />;

  return (
    <AppShell
      active="field"
      roles={fieldRoles.filter((r) => myRoles.includes(r.id))}
      role={role}
      counts={counts}
      onRole={(r) => {
        setPickedRole(r as FieldRole);
        setSelected(null);
        setShowAll(false);
        setMobileDetail(false);
      }}
      primary={
        myRoles.includes("mel")
          ? {
              label: "+ New finding",
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
          <DataBanner status={status} error={error} />
          <div className="mx-3 mt-4 rounded-xl border border-line bg-surface px-3 py-3 sm:mx-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              {SEASON.name} · {SEASON.village} · {farmers.length} farmers
            </p>
            <ol className="mt-2 grid grid-cols-6 gap-1 text-center">
              {pipeline.map((s) => (
                <li key={s.label}>
                  <p className="font-display text-xl tabular-nums">{s.n}</p>
                  <p className="text-[10px] leading-tight text-muted">{s.label}</p>
                </li>
              ))}
            </ol>
            <p className="mt-2 border-t border-line pt-2 text-[11px] text-muted">
              Store: {PACKAGE.map((p) => `${stock[p.key]} ${p.unit} ${p.key === "seed" ? "seed" : "NPK"}`).join(" · ")}
            </p>
          </div>
          <QueueHeader
            title={readOnly ? "Everything this season" : showAll ? "Everything this season" : mineList.length ? `${mineList.length} waiting on you` : "Nothing waiting on you"}
            toggleLabel={readOnly ? "" : showAll ? "Mine" : "Show all"}
            onToggle={() => setShowAll(!showAll)}
          />
          {list.length === 0 ? (
            <EmptyQueue onShowAll={() => setShowAll(true)} />
          ) : (
            <ul className="space-y-1.5 px-2 pb-6 sm:px-3">
              {list.map((i) => {
                const s = fieldSteps[i.step];
                const end = ENDS[i.step];
                const left = i.kind === "farmer" && i.step === "correct" && i.deadline ? Math.round((Date.parse(i.deadline) - Date.parse(TODAY)) / 86400000) : null;
                const o = ownerOfItem(i);
                return (
                  <QueueItem
                    key={i.id}
                    active={!creating && current?.id === i.id}
                    onClick={() => {
                      setSelected(i.id);
                      setCreating(false);
                      setMobileDetail(true);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-muted">{i.id}</span>
                      <span className="text-xs text-muted">{i.kind === "farmer" ? `${i.hectares} ha` : "Finding"}</span>
                    </div>
                    <p className="mt-1 font-medium leading-snug">{i.kind === "farmer" ? farmerName(i, user) : i.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {end ? (
                        <Pill tone={end.tone}>{end.title}</Pill>
                      ) : (
                        <Pill tone={o === role ? (["correct", "removal"].includes(i.step) ? "clay" : "forest") : "muted"}>{s.title}</Pill>
                      )}
                      {left !== null && <Pill tone={left < 0 ? "clay" : "ochre"}>{left < 0 ? "Deadline passed" : `${left} days to fix`}</Pill>}
                      {openBlocking(i).length > 0 && <Pill tone="clay">Issue</Pill>}
                      {(showAll || readOnly) && o && o !== role && <span className="text-[11px] text-muted">{holderOf("field", o)?.name}</span>}
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
          <QueueFooter
            note="Fictional records, saved in the project database. Resetting keeps real Kobo submissions."
            onReset={() => {
              void reset();
              setSelected(null);
            }}
          />
        </>
      }
      detail={
        creating ? (
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
              <p className="font-display text-2xl">Nothing selected</p>
              <p className="mt-1 text-sm text-muted">Pick a farmer or finding from the list.</p>
            </div>
          </div>
        )
      }
    />
  );
}
