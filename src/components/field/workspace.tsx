"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useFeature, useRequireUser, useSession } from "@/components/app/session";
import { shrinkPhoto } from "@/components/field/profile";
import { PHOTO_QUALITY } from "@/lib/plans";
import { useFieldData } from "@/components/app/use-project-data";
import { useCurrentProject } from "@/components/app/current-project";
import { FarmerImport, PackageSetup } from "@/components/field/setup";
import { today } from "@/lib/clock";
import { canEditProject } from "@/lib/demo";
import { itemsFor, packageUsd, qtyItem, type FieldSetup } from "@/lib/package";
import { densityOf, hectaresFor, plantedItem } from "@/lib/crops";
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
  Tracker,
  dangerBtn,
  primaryBtn,
  quietBtn,
  stickyActions,
  StatusPill,
} from "@/components/workspace/ui";
import { holderOf, type AppUser } from "@/lib/demo";
import { NoAccess } from "@/components/workspace/ui";
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
  hasSignedNotePhoto,
  handedOutOn,
  plantingProblem,
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
  type Planting,
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
  const [due, setDue] = useState(addDays(today(), 7));
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
          timeline: [{ date: today(), who: "mel", what: "Finding drafted" }],
        });
      }}
      className="mx-auto max-w-2xl space-y-6"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warn">New finding</p>
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
  const { signIn, money, user, mode } = useSession();
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

  // Handing out goods needs the document on file: a photo of the note the recipient signed.
  const fullPhotos = useFeature("full_photos");
  const [noteError, setNoteError] = useState("");
  const needsNote = item.kind === "farmer" && item.step === "distribute";
  const noteOnFile = item.kind === "farmer" && hasSignedNotePhoto(item);
  const addNote = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 25_000_000) return setNoteError("That file is too large to be a photo. Choose a photo from the phone.");
    void shrinkPhoto(file, fullPhotos ? PHOTO_QUALITY.full : PHOTO_QUALITY.small)
      .then((src) => {
        apply((i) => (i.kind === "farmer" ? { ...i, photos: [...i.photos, { id: `${i.id}-note-${Date.now()}`, activity: "distribution", date: today(), caption: `Signed goods received note · ${i.id}`, src, signedNote: true }] } : i));
        setNoteError("");
      })
      .catch(() => setNoteError("The app could not read that image. Try a JPEG or PNG photo."));
  };
  // Planting: the record and an optional photo of the planted plot.
  const [plantPhotoError, setPlantPhotoError] = useState("");
  const addPlantPhoto = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 25_000_000) return setPlantPhotoError("That file is too large to be a photo. Choose a photo from the phone.");
    void shrinkPhoto(file, fullPhotos ? PHOTO_QUALITY.full : PHOTO_QUALITY.small)
      .then((src) => {
        apply((i) => (i.kind === "farmer" ? { ...i, photos: [...i.photos, { id: `${i.id}-planting-${Date.now()}`, activity: "planting", date: today(), caption: `Planted plot · ${i.id}`, src }] } : i));
        setPlantPhotoError("");
      })
      .catch(() => setPlantPhotoError("The app could not read that image. Try a JPEG or PNG photo."));
  };
  const canRun = (o: Outcome) => blocks.length === 0 && (o.requiresChecks === false || (checksOk && (!needsNote || noteOnFile)));
  const end = ENDS[item.step];

  return (
    <div className="space-y-6">
      <BackLink onClick={onBack} />

      {item.kind === "farmer" ? (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted">{item.id}</span>
            {ctx.setup.season && <Pill tone="muted">{ctx.setup.season}</Pill>}
            {item.step === "correct" && <StatusPill tone="clay">Correcting</StatusPill>}
          </div>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-3xl leading-tight tracking-tight">{farmerName(item, user)}</h2>
            <Link href={`/field/farmers/${item.id}`} className="btn-link">
              Open profile →
            </Link>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            {[
              ["Village", item.community],
              ["Plot", `${item.hectares} ha${ctx.setup.crop ? ` ${ctx.setup.crop.toLowerCase()}` : ""}`],
              ["Contribution", item.contributionPaid ? "Paid" : "Not paid"],
              ["Input package", packageUsd(ctx.setup, item.hectares) ? money(packageUsd(ctx.setup, item.hectares)) : `${ctx.setup.items.length} items`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{k}</dt>
                <dd className={`mt-0.5 tabular-nums ${v === "Not paid" ? "font-medium text-warn" : ""}`}>{v}</dd>
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
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Sources</span>
              {item.sources.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onOpen(s)}
                  className="rounded-md border border-line bg-paper px-2 py-0.5 font-mono text-xs text-muted transition hover:border-forest hover:text-forest"
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
          eyebrow={item.step === "verify" ? "Yes or no decision" : undefined}
          title={step.title}
          note={step.note?.(item)}
          onViewAs={ownerUser && mode === "demo" ? () => signIn(ownerUser.id) : undefined}
          switchLabel={ownerUser ? `Sign in as ${ownerUser.name.split(" ")[0]} (demo)` : undefined}
          footer={
            <>
              {awaiting && (
                <div className={`border-t px-5 py-4 text-sm ${awaiting.status === "pending" ? "border-line bg-mist" : "border-clay/30 bg-clay-soft"}`}>
                  {awaiting.status === "pending" ? (
                    <p>
                      <span className="font-semibold">Distribution recorded.</span> Waiting for {fieldPerson("manager")} to approve it; the farmer moves on to planting once approved.
                    </p>
                  ) : (
                    <p>
                      <span className="font-semibold text-clay">Sent back by the project manager:</span> {awaiting.note}
                    </p>
                  )}
                  {awaiting.id ? (
                    <Link href={`/approve/${encodeURIComponent(projectCode)}/${awaiting.id}`} className="btn-link mt-3">
                      {awaiting.status === "pending" ? "See the distribution record →" : "Fix it and send it again →"}
                    </Link>
                  ) : (
                    <p className="mt-2 text-xs text-muted">Saving the record…</p>
                  )}
                </div>
              )}
              {mine && !awaiting && (
                <>
                <div className="space-y-3 border-t border-line px-5 py-4 empty:hidden">
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
                  {needsNote && (
                    <div className={`rounded-xl border px-4 py-3 text-sm ${noteOnFile ? "border-line bg-mist" : "border-clay/40 bg-clay-soft"}`}>
                      <p className="font-semibold">{noteOnFile ? "✓ Photo of the signed goods received note is on the record" : "Photo of the signed goods received note"}</p>
                      {!noteOnFile && (
                        <>
                          <p className="mt-1">The recipient signs or thumbprints a note saying they received the goods in acceptable condition and are responsible for them from then on. Take a photo of it. The distribution cannot be recorded or approved without it.</p>
                          <label className={`${primaryBtn} mt-3 inline-flex cursor-pointer`}>
                            Take or choose photo
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="sr-only"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                addNote(file);
                              }}
                            />
                          </label>
                          {noteError && <p className="mt-2 text-clay">{noteError}</p>}
                        </>
                      )}
                    </div>
                  )}
                  {item.kind === "farmer" && item.step === "plant" && (
                    <PlantingForm
                      farmer={item}
                      setup={ctx.setup}
                      today={ctx.today}
                      onSave={(p) => apply((i) => log({ ...(i as Farmer), planting: p }, `Planting record: planted ${p.date}, ${p.count !== undefined ? `${p.count} ${ctx.setup.plan?.unit ?? "plants"}, ` : ""}${p.hectares} ha`))}
                      onPhoto={addPlantPhoto}
                      photoError={plantPhotoError}
                    />
                  )}
                </div>
                <div className={stickyActions}>
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
                  {(!checksOk || (needsNote && !noteOnFile)) && blocks.length === 0 && <p className="text-xs text-muted">{checksOk ? "Add the photo of the signed note to continue." : "Complete every item above to continue."}</p>}
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
                    apply((i) => log(c.resolveEffect ? c.resolveEffect(i) : { ...i, checks: { ...i.checks, [`fix.${i.step}.${c.id}`]: true } }, c.resolveDone ?? c.resolve!))
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

/* ---------- planting record ---------- */

/**
 * What the extension agent records at "Plant and follow up": the day the farmer planted and the
 * area planted, saved once with a button, and an optional photo of the planted plot. The checks
 * above read it (lib/field plantingProblem), and the server refuses a record that breaks them.
 */
function PlantingForm({ farmer, setup, today: now, onSave, onPhoto, photoError }: { farmer: Farmer; setup: FieldSetup; today: string; onSave: (p: Planting) => void; onPhoto: (f: File | undefined) => void; photoError: string }) {
  const saved = farmer.planting;
  // A crop counted one by one (Set up → Crop): Field types how many went in; the hectares follow from the spacing.
  const plan = setup.plan;
  const density = densityOf(plan);
  const counted = !!density;
  const unit = plan?.unit ?? "plants";
  // Pre-filled with what the farmer was given, so usually only the date is typed.
  const givenItem = plantedItem(itemsFor(setup, farmer.hectares), plan);
  const [editing, setEditing] = useState(!saved);
  const [date, setDate] = useState(saved?.date ?? now);
  const [ha, setHa] = useState(String(saved?.hectares ?? farmer.hectares));
  const [count, setCount] = useState(String(saved?.count ?? (givenItem ? Math.round(givenItem.qty) : "")));
  const draft: Planting = counted ? { date, count: Number(count), hectares: hectaresFor(Number(count), plan) ?? 0 } : { date, hectares: Number(ha) };
  const problem = (counted ? count.trim() === "" : ha.trim() === "") ? (counted ? `Enter how many ${unit} were planted.` : "Enter the area planted.") : plantingProblem({ ...farmer, planting: draft }, now);
  const given = handedOutOn(farmer);
  const photo = farmer.photos.filter((p) => p.activity === "planting" && p.src).at(-1);
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${saved && !editing ? "border-line bg-mist" : "border-clay/40 bg-clay-soft"}`}>
      {saved && !editing ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">
            ✓ Planted {saved.date} · {saved.count !== undefined ? `${saved.count.toLocaleString("en-US")} ${unit}, ` : ""}
            {saved.hectares} of {farmer.hectares} ha
          </p>
          <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-forest underline">
            Change
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (problem) return;
            onSave(draft);
            setEditing(false);
          }}
        >
          <p className="font-semibold">Planting record</p>
          <p className="mt-1 text-muted">
            {counted ? `The day the farmer planted and how many ${unit} went in the ground. The area follows from the spacing (${density!.toLocaleString("en-US")} per ha).` : "The day the farmer planted and how much of the plot."} {given ? `Inputs were handed out ${given}.` : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold">
              Planted on
              <input type="date" value={date} max={now} min={given ?? undefined} onChange={(e) => setDate(e.target.value)} className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal" />
            </label>
            {counted ? (
              <>
                <label className="text-xs font-semibold">
                  {unit[0].toUpperCase() + unit.slice(1)} planted{givenItem ? ` (given ${Math.round(givenItem.qty).toLocaleString("en-US")})` : ""}
                  <input type="number" min={0} step={1} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} className="mt-1 block w-32 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal" />
                </label>
                <p className="pb-2 text-xs text-muted">
                  = {draft.hectares} ha of the {farmer.hectares} ha plot
                </p>
              </>
            ) : (
              <label className="text-xs font-semibold">
                Area planted (ha, plot is {farmer.hectares})
                <input type="number" min={0} max={farmer.hectares} step="any" inputMode="decimal" value={ha} onChange={(e) => setHa(e.target.value)} className="mt-1 block w-32 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal" />
              </label>
            )}
            <button type="submit" disabled={!!problem} className={primaryBtn}>
              Save planting record
            </button>
            {saved && (
              <button type="button" onClick={() => setEditing(false)} className="px-2 text-sm text-muted">
                Cancel
              </button>
            )}
          </div>
          {problem && <p className="mt-2 text-clay">{problem}</p>}
        </form>
      )}
      <div className="mt-3 border-t border-line/60 pt-3">
        {photo ? (
          <p className="text-muted">✓ Photo of the planted plot on the record ({photo.date}).</p>
        ) : (
          <label className="inline-flex cursor-pointer items-center gap-1 text-sm font-semibold text-forest underline">
            Add a photo of the planted plot (optional)
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                onPhoto(file);
              }}
            />
          </label>
        )}
        {photoError && <p className="mt-2 text-clay">{photoError}</p>}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const download = async (table: "farmers" | "records" = "farmers") => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(code)}/field/export${table === "records" ? "?table=records" : ""}`, { cache: "no-store", headers: { "x-demo-user": userId } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Could not make the file (${res.status}).`);
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
    <div className="mt-4 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
      <button type="button" onClick={() => download("farmers")} disabled={busy} className="font-semibold text-forest hover:underline disabled:opacity-60">
        {busy ? "Making the file…" : "Download the farmer table (spreadsheet) ↓"}
      </button>
      <p className="mt-1 text-xs text-muted">One row per farmer, by number, never by name: each step&rsquo;s date, how the readiness check went, what they received and the days between steps.</p>
      <button type="button" onClick={() => download("records")} disabled={busy} className="mt-3 font-semibold text-forest hover:underline disabled:opacity-60">
        {busy ? "Making the file…" : "Download the field records table (spreadsheet) ↓"}
      </button>
      <p className="mt-1 text-xs text-muted">One row per record: every training attendance, readiness check, farm visit and distribution, with who collected it, the decision and how long it waited. Join it to the farmer table by farmer number.</p>
      {error && <p role="alert" className="mt-1 text-xs text-clay">{error}</p>}
    </div>
  );
}

export function FieldWorkspace() {
  const { user, mode } = useRequireUser();
  const myRoles = (user?.field ?? []) as FieldRole[];
  const { project } = useCurrentProject();
  const { items, setItems, stock, stockNote, setStock, setup, status, error, reload, reset } = useFieldData(project.id);
  const [panel, setPanel] = useState<"" | "package" | "farmers">("");
  const [pickedRole, setPickedRole] = useState<FieldRole | null>(null);
  const role = pickedRole && myRoles.includes(pickedRole) ? pickedRole : (myRoles[0] ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
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
  // A project without an input package has no field workflow yet: its manager sets it up first.
  if (status === "ready" && !setup)
    return <SetupOnly code={project.id} mayManage={mayManage} onSaved={() => void reload()} />;

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
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              {[ctx.setup.season, ctx.setup.village, status === "loading" ? "" : `${farmers.length} ${farmers.length === 1 ? "farmer" : "farmers"}`].filter(Boolean).join(" · ")}
            </p>
            <ol className="mt-2 grid grid-cols-3 gap-x-1 gap-y-3 text-center sm:grid-cols-6">
              {pipeline.map((s) => (
                <li key={s.label}>
                  <p className="text-xl tabular-nums font-semibold">{status === "loading" ? "–" : s.n}</p>
                  <p className="text-xs leading-tight text-muted">{s.label}</p>
                </li>
              ))}
            </ol>
            <p className="mt-2 border-t border-line pt-2 text-xs text-muted">
              Store: {status === "loading" ? "…" : ctx.setup.items.map((p) => qtyItem(stock[p.key] ?? 0, p.unit, p.item)).join(" · ")}
            </p>
            {mayManage && (
              <div className="mt-2 flex flex-wrap gap-3 border-t border-line pt-2 text-xs font-semibold">
                <button type="button" className="text-forest hover:underline" onClick={() => { setPanel("farmers"); setCreating(false); setMobileDetail(true); }}>
                  Load farmer list
                </button>
                <button type="button" className="text-forest hover:underline" onClick={() => { setPanel("package"); setCreating(false); setMobileDetail(true); }}>
                  Input package
                </button>
              </div>
            )}
          </div>
          <QueueHeader
            title={status === "loading" ? "Loading…" : readOnly ? "Everything this season" : showAll ? "Everything this season" : mineList.length ? `${mineList.length} waiting on you` : "Nothing waiting on you"}
            toggleLabel={readOnly ? "" : showAll ? "Mine" : "Show all"}
            onToggle={() => setShowAll(!showAll)}
          />
          {list.length === 0 ? (
            <EmptyQueue loading={status === "loading"} onShowAll={() => setShowAll(true)} />
          ) : (
            <ul className="space-y-1.5 px-2 pb-6 sm:px-3">
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
                      {(showAll || readOnly) && o && o !== role && <span className="text-xs text-muted">{holderOf("field", o)?.name}</span>}
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
            note={mode === "demo" && isDemo ? "Fictional records, saved in the project database. Resetting keeps real Kobo submissions." : "Saved in the project database."}
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
        ) : panel === "farmers" || (farmers.length === 0 && mayManage && !creating) ? (
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
              <p className="font-display text-2xl">{status === "loading" ? "Loading…" : "Nothing selected"}</p>
              {status !== "loading" && <p className="mt-1 text-sm text-muted">Pick a farmer or finding from the list.</p>}
            </div>
          </div>
        )
      }
    />
  );
}

/** Field activities on a project whose input package is not set up yet. */
function SetupOnly({ code, mayManage, onSaved }: { code: string; mayManage: boolean; onSaved: (s: FieldSetup) => void }) {
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
          <p className="font-medium">Not set up yet</p>
          <p className="mt-1 text-muted">
            {mayManage
              ? "Say what one farmer receives and the budget line each item is bought on. Then load the farmer list."
              : "The project manager sets up the input package and loads the farmer list before field work starts here."}
          </p>
        </div>
      }
      detail={mayManage ? <PackageSetup code={code} onSaved={onSaved} /> : <div className="grid h-full place-items-center py-24 text-center text-sm text-muted">Nothing to do here yet.</div>}
    />
  );
}
